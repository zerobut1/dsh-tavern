import { randomUUID } from 'node:crypto'
import { appendSessionEvent, sessionEvents } from './session-events.js'
import { isProducerSource, producerSource } from './message-source.js'
import { requestIdForTurn, turnStartIndex } from './session-turn-input.js'
import { STORY_SUBMIT_MAX_CORRECTIONS, STORY_SUBMIT_TOOL_NAME, storyToolCallEnabled } from './story-tool-submission.js'
import { markRequestHandled, requestHandledBy } from './request-lineage.js'

export const STORY_TEXT_REJECTED = 'DSH_TAVERN_STORY_TEXT_REJECTED'
export const UPSTREAM_PROMPT_REJECTED = 'DSH_TAVERN_UPSTREAM_PROMPT_REJECTED'
const STAGE = 'story-submission-stream'
const CORRECTION_PRODUCER = 'dsh-tavern-story-tool-correction'
const STREAM_STATE = Symbol('story-submission-stream-state')
const failures = new WeakMap()
const REJECTION_MESSAGE = '禁止直接输出普通文本：请求已中止。请调用 submit_story，将本轮完整正文放入 content 字符串参数，不得输出任何前后说明。'
const GEMINI_REJECTION_PREFIX = 'The prompt could not be submitted. The prompt contains sensitive words'
const UPSTREAM_REJECTION_MESSAGE = '上游返回了 Gemini 内容审核拒绝提示，请求未能提交。本轮没有生成正文，已停止自动纠正。'

function textOf(chunk) {
  if (chunk?.type === 'text-delta') return chunk.text || ''
  if (chunk?.type === 'block-end' && chunk.block?.type === 'text') return chunk.block.text || ''
  return null
}

// State follows request projections without appearing in provider JSON or logs.
export function storyStreamFailure(request) { return request?.[STREAM_STATE] && failures.get(request[STREAM_STATE]) }

/** Withhold text, distinguish the fixed upstream rejection, then stop the transport. */
export async function* guardStorySubmissionStream(request, openStream) {
  request.signal?.throwIfAborted()
  const controller = new AbortController()
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal
  const state = {}
  const guarded = markRequestHandled({ ...request, signal, [STREAM_STATE]: state }, STAGE)
  const iterator = openStream(guarded)[Symbol.asyncIterator]()
  let completed = false
  // Bounded to the known rejection prefix, even when a provider sends huge deltas.
  // Empty Responses message shells and whitespace are not evidence of story prose.
  let prefix = ''
  try {
    while (true) {
      const item = await iterator.next()
      request.signal?.throwIfAborted()
      const chunk = item.value
      let failure
      if (item.done) {
        if (!prefix) { completed = true; return }
        failure = { code: STORY_TEXT_REJECTED, message: REJECTION_MESSAGE }
      } else if (chunk?.type === 'block-start' && chunk.blockType === 'text') continue
      else {
        const text = textOf(chunk)
        if (text !== null) {
          const end = chunk.type === 'block-end'
          if (end) prefix = (text.trimStart() || prefix).slice(0, GEMINI_REJECTION_PREFIX.length)
          else if (prefix) prefix += text.slice(0, GEMINI_REJECTION_PREFIX.length - prefix.length)
          else prefix = text.trimStart().slice(0, GEMINI_REJECTION_PREFIX.length)
          if (!prefix) continue
          if (!end && prefix.length < GEMINI_REJECTION_PREFIX.length && GEMINI_REJECTION_PREFIX.startsWith(prefix)) continue
          failure = prefix === GEMINI_REJECTION_PREFIX
            ? { code: UPSTREAM_PROMPT_REJECTED, message: UPSTREAM_REJECTION_MESSAGE }
            : { code: STORY_TEXT_REJECTED, message: REJECTION_MESSAGE }
        } else if (chunk?.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) {
          prefix = ''
        } else if (chunk?.type === 'usage') {
          yield chunk
          continue
        } else if (prefix) {
          failure = { code: STORY_TEXT_REJECTED, message: REJECTION_MESSAGE }
        }
      }
      if (failure) {
        failures.set(state, failure)
        controller.abort(new Error(failure.message))
        // Closing a deliberately aborted transport may throw its abort error.
        // This attempt must end with our error chunk so the host can retry it.
        try { await iterator.return?.() } catch {}
        completed = true
        request.signal?.throwIfAborted()
        yield { type: 'finish', reason: { kind: 'error', failure } }
        return
      }
      yield chunk
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
    const code = payload.failure?.code
    if (![STORY_TEXT_REJECTED, UPSTREAM_PROMPT_REJECTED].includes(code) || isBackground(payload.agent?.session?.id)) return next()
    payload.signal?.throwIfAborted()
    const session = payload.agent.session
    if (code === UPSTREAM_PROMPT_REJECTED) {
      await recordFailure({ sessionId: session.id, turn: payload.turn, requestId: requestIdForTurn(session, payload.turn),
        code: 'upstream-prompt-rejected', message: payload.failure.message })
      return undefined
    }
    const events = sessionEvents(session)
    const start = turnStartIndex(events, payload.turn)
    const corrections = events.slice(start + 1).filter(event => event.type === 'user/message'
      && isProducerSource(event.data?.source, CORRECTION_PRODUCER)).length
    if (corrections >= STORY_SUBMIT_MAX_CORRECTIONS) {
      const message = `连续收到普通文本响应，已即时拦截；自动纠正 ${STORY_SUBMIT_MAX_CORRECTIONS} 次后仍未调用 submit_story，本轮正文未保存。`
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
