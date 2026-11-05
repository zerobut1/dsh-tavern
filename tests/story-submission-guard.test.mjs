import assert from 'node:assert/strict'
import test from 'node:test'
import { guardStorySubmissionStream, registerStorySubmissionStreamHooks, storyStreamFailure, STORY_TEXT_REJECTED, UPSTREAM_PROMPT_REJECTED } from '../tavern-plugin/lib/domain/story-submission-stream.js'
import { createStorySubmissionGuard } from '../tavern-plugin/lib/domain/story-tool-submission.js'

const tools = [{ name: 'submit_story' }]
const reasoning = [
  { type: 'block-start', index: 0, blockType: 'reasoning' },
  { type: 'reasoning-delta', index: 0, text: '思考过程' },
  { type: 'block-end', index: 0, block: { type: 'reasoning', text: '思考过程' } }
]
const submitted = [
  { type: 'block-start', index: 1, blockType: 'tool-call' },
  { type: 'tool-call-delta', index: 1, id: 'call', name: 'submit_story', arguments: '{"content":"正文"}' },
  { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call', name: 'submit_story', arguments: '{"content":"正文"}' } },
  { type: 'finish', reason: { kind: 'stop' } }
]
const collect = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks }

test('首个实际正文立即中止传输，任何正文及后续块都不会送到 Agent', async () => {
  for (const forbidden of [
    { type: 'text-delta', index: 1, text: '泄漏正文' },
    { type: 'block-end', index: 1, block: { type: 'text', text: '泄漏正文' } }
  ]) {
    const parent = new AbortController()
    const request = Object.freeze({ sessionId: 'game', signal: parent.signal, tools })
    let transport, closed = false, drained = false
    const chunks = await collect(guardStorySubmissionStream(request, async function* (guarded) {
      transport = guarded
      for (const symbol of Object.getOwnPropertySymbols(guarded)) Object.freeze(guarded[symbol])
      Object.freeze(guarded)
      try {
        yield* reasoning
        yield { type: 'block-start', index: 1, blockType: 'text' }
        yield { type: 'text-delta', index: 1, text: '' }
        assert.equal(guarded.signal.aborted, false, '文本块开始还没有实际内容')
        yield forbidden
        drained = true
        yield { type: 'text-delta', index: 1, text: '不应继续生成' }
      } finally { closed = true }
    }))
    assert.deepEqual(chunks.slice(0, -1), reasoning)
    assert.equal(chunks.at(-1).reason.failure.code, STORY_TEXT_REJECTED)
    assert.equal(transport.signal.aborted, true)
    assert.equal(parent.signal.aborted, false, '中止单次请求，不取消整个回合')
    assert.equal(closed, true)
    assert.equal(drained, false)
    assert.equal(storyStreamFailure(transport).code, STORY_TEXT_REJECTED)
    assert.equal(JSON.stringify(chunks).includes('泄漏正文'), false)
  }
})

test('合法思考与工具参数逐块通过，用户取消不会变成自动纠正', async () => {
  const controller = new AbortController()
  const valid = [...reasoning, ...submitted]
  const shells = [
    { type: 'block-start', index: 2, blockType: 'text' },
    { type: 'text-delta', index: 2, text: ' \n' },
    { type: 'block-end', index: 2, block: { type: 'text', text: '' } }
  ]
  assert.deepEqual(await collect(guardStorySubmissionStream({ signal: controller.signal }, async function* () { yield* shells; yield* valid })), valid)
  const nativeError = { type: 'finish', reason: { kind: 'error', failure: { code: 'CONTENT_FILTER', message: '上游错误' } } }
  const usage = { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
  assert.deepEqual(await collect(guardStorySubmissionStream({}, async function* () {
    yield { type: 'text-delta', text: 'The prompt' }
    yield usage
    yield nativeError
  })), [usage, nativeError], '保留真实接口错误，不改写为工具调用失败')
  let continued = false
  const chunks = []
  await assert.rejects(async () => {
    for await (const chunk of guardStorySubmissionStream({ signal: controller.signal }, async function* () {
      yield reasoning[0]
      controller.abort()
      yield { type: 'text-delta', text: '取消后输出' }
      continued = true
    })) chunks.push(chunk)
  }, { name: 'AbortError' })
  assert.deepEqual(chunks, [reasoning[0]])
  assert.equal(continued, false)
})

function fixture() {
  const handlers = {}, events = [], failures = []
  const session = { id: 'game', events, append(type, data, intent = {}) {
    const event = { seq: events.length, type, data, ...intent }; events.push(event); return event
  } }
  session.append('turn/start', { turn: 2 })
  session.append('user/message', { role: 'user', source: { kind: 'user', rpcId: 'request' }, content: [{ type: 'text', text: '继续' }] })
  const state = { chat: { mode: 'story' }, enabled: true, background: false, signal: new AbortController().signal }
  const ctx = { on: (name, fn) => { handlers[name] = fn }, llm: { stream: request => handlers['llm/stream'](request, async function* () {
    yield { type: 'text-delta', text: '普通正文' }
  }) } }
  registerStorySubmissionStreamHooks({ ctx, chatForSession: async () => state.chat, enabled: async () => state.enabled,
    isBackground: () => state.background, recordFailure: async value => failures.push(value) })
  const payload = () => ({ agent: { session }, turn: 2, step: 1, signal: state.signal,
    failure: { code: STORY_TEXT_REJECTED, message: 'blocked' }, retryPolicy: { mode: 'always' } })
  return { ctx, handlers, session, events, failures, state, payload }
}

test('流拦截仅作用于开启开关的原生前台，递归请求只包装一次', async () => {
  const run = fixture()
  const request = { sessionId: 'game', tools, signal: run.state.signal }
  assert.equal((await collect(run.ctx.llm.stream(request))).at(-1).reason.failure.code, STORY_TEXT_REJECTED)
  for (const patch of [
    { enabled: false }, { chat: { mode: 'card', storyToolCall: true } },
    { chat: { mode: 'story', storyToolCall: false } },
    { chat: { mode: 'script', requestMode: 'sillytavern' } }, { background: true }
  ]) {
    Object.assign(run.state, { chat: { mode: 'story' }, enabled: true, background: false }, patch)
    assert.deepEqual(await collect(run.ctx.llm.stream(request)), [{ type: 'text-delta', text: '普通正文' }])
  }
  Object.assign(run.state, { chat: { mode: 'story' }, enabled: true, background: false })
  for (const extra of [{ purpose: 'compaction' }, { purpose: 'session-title' }, { tools: [] }]) {
    assert.deepEqual(await collect(run.ctx.llm.stream({ ...request, ...extra })), [{ type: 'text-delta', text: '普通正文' }])
  }
})

test('Gemini 审核拒绝文本按固定前缀识别，分片也不作为正文送出', async () => {
  const rejected = "The prompt could not be submitted. The prompt contains sensitive words that violate Google's policy."
  for (const fragments of [[rejected], [...rejected]]) {
    let transport, consumed = 0
    const chunks = await collect(guardStorySubmissionStream({}, async function* (request) {
      transport = request
      yield { type: 'block-start', index: 0, blockType: 'text' }
      for (const text of fragments) { consumed++; yield { type: 'text-delta', index: 0, text } }
      assert.fail('识别前缀后不继续读取审核文本')
    }))
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].reason.failure.code, UPSTREAM_PROMPT_REJECTED)
    assert.match(chunks[0].reason.failure.message, /审核拒绝/)
    assert.equal(transport.signal.aborted, true)
    assert.ok(consumed <= 70, '只暂存有上限的识别前缀')
  }
  const chunks = await collect(guardStorySubmissionStream({}, async function* () {
    yield { type: 'text-delta', text: 'The protagonist walks away.' }
    assert.fail('偏离审核前缀后立即拒收普通正文')
  }))
  assert.equal(chunks[0].reason.failure.code, STORY_TEXT_REJECTED)
})

test('审核拒绝直接报上游错误，不追加纠正、不交给通用重试', async () => {
  const run = fixture()
  const count = run.events.length
  const payload = { ...run.payload(), failure: { code: UPSTREAM_PROMPT_REJECTED, message: '上游审核拒绝' } }
  const result = await run.handlers['agent/request-error'](payload, () => assert.fail('审核拒绝不重试'))
  assert.equal(result, undefined)
  assert.equal(run.events.length, count)
  assert.equal(run.failures[0].code, 'upstream-prompt-rejected')
  assert.equal(run.failures[0].requestId, 'request')
  assert.equal(run.failures[0].message, payload.failure.message)
})

test('即时拒收后记录纠正指令，同回合最多重试五次；取消或上限不交给通用重试', async () => {
  const run = fixture()
  let delegated = 0
  const handle = payload => run.handlers['agent/request-error'](payload, async () => { delegated++; return 'delegated' })
  for (let attempt = 0; attempt < 5; attempt++) assert.deepEqual(await handle(run.payload()), { kind: 'retry' })
  const corrections = run.events.filter(event => event.type === 'user/message' && event.data.source.kind.startsWith('plugin:'))
  assert.equal(corrections.length, 5)
  assert.match(corrections[0].data.content[0].text, /调用 submit_story/)
  assert.equal(run.events.some(event => event.type === 'assistant/message'), false)
  assert.equal(await handle(run.payload()), undefined)
  assert.equal(delegated, 0)
  assert.equal(run.failures[0].code, 'story-tool-required')
  assert.equal(run.failures[0].requestId, 'request')
  assert.match(run.failures[0].message, /自动纠正 5 次/)
  run.session.append('turn/end', { turn: 2, reason: { kind: 'error' } })
  run.session.append('turn/start', { turn: 3 })
  assert.deepEqual(await handle({ ...run.payload(), turn: 3 }), { kind: 'retry' })
  const abort = new AbortController(); abort.abort()
  await assert.rejects(handle({ ...run.payload(), turn: 3, signal: abort.signal }), { name: 'AbortError' })
  assert.equal(await handle({ ...run.payload(), failure: { code: 'TRANSPORT' } }), 'delegated')
})

test('结束校验仅保留拒收入档兜底，成功工具提交直接通过', async () => {
  const run = fixture()
  let visible = ['submit_story']
  const guard = createStorySubmissionGuard({ chatForSession: async () => run.state.chat, enabled: async () => run.state.enabled, visibleTools: async () => visible })
  await assert.rejects(guard(run.payload(), { text: '不应入档' }), /普通文本已被拒收/)
  assert.equal(await guard(run.payload(), { text: '工具正文', storyToolSubmission: true }), false)
  visible = []
  assert.equal(await guard(run.payload(), { text: '本局已关闭提交工具' }), false)
  run.state.enabled = false
  assert.equal(await guard(run.payload(), { text: '普通正文' }), false)
})
