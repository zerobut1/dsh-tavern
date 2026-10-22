import { randomUUID } from 'node:crypto'
import { appendSessionEvent, sessionEvents } from './session-events.js'
import { isProducerSource, producerSource } from './message-source.js'
import { requestIdForTurn, turnStartIndex } from './session-turn-input.js'
import { STORY_SUBMIT_MAX_CORRECTIONS, STORY_SUBMIT_TOOL_NAME, storyToolCallEnabled } from './story-tool-submission.js'
import { markRequestHandled, requestHandledBy } from './request-lineage.js'

export const STORY_TEXT_REJECTED = 'DSH_TAVERN_STORY_TEXT_REJECTED'
const STAGE = 'story-submission-stream'
const CORRECTION_PRODUCER = 'dsh-tavern-story-tool-correction'
const STREAM_STATE = Symbol('story-submission-stream-state')
const failures = new WeakMap()
const REJECTION_MESSAGE = '禁止直接输出普通文本：请求已中止。请调用 submit_story，将本轮完整正文放入 content 字符串参数，不得输出任何前后说明。'

function isText(chunk) {
  return chunk?.type === 'text-delta'
    || (chunk?.type === 'block-start' && chunk.blockType === 'text')
    || (chunk?.type === 'block-end' && chunk.block?.type === 'text')
}

// State follows request projections without appearing in provider JSON or logs.
export function storyStreamFailure(request) { return request?.[STREAM_STATE] && failures.get(request[STREAM_STATE]) }

/** Stop the transport before publishing the first text chunk to the Agent/UI. */
export async function* guardStorySubmissionStream(request, openStream) {
  request.signal?.throwIfAborted()
  const controller = new AbortController()
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal
  const state = {}
  const guarded = markRequestHandled({ ...request, signal, [STREAM_STATE]: state }, STAGE)
  const iterator = openStream(guarded)[Symbol.asyncIterator]()
  let completed = false
  try {
    while (true) {
      const item = await iterator.next()
      request.signal?.throwIfAborted()
      if (item.done) { completed = true; return }
      if (isText(item.value)) {
        const failure = { code: STORY_TEXT_REJECTED, message: REJECTION_MESSAGE }
        failures.set(state, failure)
        controller.abort(new Error(REJECTION_MESSAGE))
        // Closing a deliberately aborted transport may throw its abort error.
        // This attempt must end with our error chunk so the host can retry it.
        try { await iterator.return?.() } catch {}
        completed = true
        request.signal?.throwIfAborted()
        yield { type: 'finish', reason: { kind: 'error', failure } }
        return
      }
      yield item.value
    }
  } finally {
    if (!completed) {
      controller.abort()
      await iterator.return?.()
    }
  }
}

export function registerStorySubmissionStreamHooks({ ctx, chatForSession, enabled, isBackground, recordFailure }) {
  ctx.on('llm/stream', (request, next) => {
    if (requestHandledBy(request, STAGE) || request.purpose !== undefined
      || !request.tools?.some(tool => tool.name === STORY_SUBMIT_TOOL_NAME) || isBackground(request.sessionId)) return next()
    return (async function* () {
      const chat = await chatForSession(request.sessionId)
      if (chat?.requestMode === 'sillytavern' || !storyToolCallEnabled(chat, await enabled())) { yield* next(); return }
      yield* guardStorySubmissionStream(request, guarded => ctx.llm.stream(guarded))
    })()
  }, { global: true, prepend: true })

  ctx.on('agent/request-error', async (payload, next) => {
    if (payload.failure?.code !== STORY_TEXT_REJECTED || isBackground(payload.agent?.session?.id)) return next()
    payload.signal?.throwIfAborted()
    const session = payload.agent.session
    const events = sessionEvents(session)
    const start = turnStartIndex(events, payload.turn)
    const corrections = events.slice(start + 1).filter(event => event.type === 'user/message'
      && isProducerSource(event.data?.source, CORRECTION_PRODUCER)).length
    if (corrections >= STORY_SUBMIT_MAX_CORRECTIONS) {
      const message = '模型连续输出普通文本，已即时拦截；自动纠正 2 次后仍未调用 submit_story，本轮正文未保存。'
      payload.failure = { ...payload.failure, message }
      await recordFailure({ sessionId: session.id, turn: payload.turn, requestId: requestIdForTurn(session, payload.turn),
        code: 'story-tool-required', message })
      // Do not delegate: generic provider retries must not bypass this limit.
      return undefined
    }
    // The failed attempt is not an assistant message. A logged instruction joins
    // the rebuilt request on this same step, with no rejected prose in history.
    appendSessionEvent(session, 'user/message', {
      id: 'tavern-story-tool-correction:' + randomUUID(), role: 'user', source: producerSource(CORRECTION_PRODUCER),
      content: [{ type: 'text', text: REJECTION_MESSAGE }]
    }, { surfaceOp: 'append' })
    return { kind: 'retry' }
  }, { prepend: true })
}
