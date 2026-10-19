import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationMessenger } from '../tavern-plugin/lib/domain/conversation-messenger.js'

const binding = { sessionId: 'session-test', chatId: 'chat-test' }
function fixture(overrides = {}) {
  const state = { id: binding.chatId, sessionId: binding.sessionId, mode: 'story', requestMode: 'dsh' }
  const header = { nativeCommits: { 1: { turn: 1, requestId: 'unrelated' } } }
  const submitted = []; let ticks = 0, reads = 0
  const deps = {
    readState: async () => state, readHeader: async () => header,
    readHistory: async () => { reads++; return { chat: { ...state, messages: [{ role: 'assistant', turn: 1, text: '旧回复' }, { role: 'assistant', turn: 7, text: '本轮正文' }] }, view: { replyProjections: [{ turn: 7, parts: [{ kind: 'html', html: '不应发送的面板' }, { kind: 'markdown', text: '本轮显示正文<think>不应发送的思考</think>' }] }] } } },
    activity: () => ({ busy: false }), foreground: () => false,
    prompt: async request => { submitted.push(request) }, demand() {},
    now: () => ticks, wait: async () => { ticks++; header.nativeCommits[7] = { turn: 7, requestId: 'own' } }, timeoutMs: 4, pollMs: 1,
    ...overrides,
  }
  return { messenger: createConversationMessenger(deps), state, header, submitted, deps, reads: () => reads }
}

test('原生发送沿用 SessionController；按 requestId 定位正文，结算后只投递显示文字', async () => {
  let settlements = 0
  const f = fixture({ activity: () => ({ busy: settlements++ === 2 }) })
  const result = await f.messenger.send(binding, '你好', { requestId: 'own' })
  assert.equal(result.turn, 7); assert.equal(result.text, '本轮显示正文')
  assert.deepEqual(f.submitted[0], { sessionId: binding.sessionId, requestId: 'own', mode: 'followup', content: [{ type: 'text', text: '你好' }] })
  assert.equal(f.reads(), 1)
})

test('无匹配请求提交时超时，不能误取其他会话或旧回复', async () => {
  const f = fixture()
  await assert.rejects(f.messenger.send(binding, '你好', { requestId: 'never-committed' }), /超时/)
  assert.equal(f.reads(), 0)
})

test('固定绑定变更、生成失败、繁忙和不支持模式均停止而不投递旧正文', async () => {
  for (const patch of [{ id: 'chat-other' }, { sessionId: 'session-other' }, { requestMode: 'sillytavern' }, { mode: 'card' }, { regenInProgress: true }]) {
    const f = fixture(); Object.assign(f.state, patch)
    await assert.rejects(f.messenger.send(binding, '你好', { requestId: 'own' }))
    assert.equal(f.submitted.length, 0)
  }
  const f = fixture(); f.header.foregroundError = { requestId: 'own', message: 'private internal error' }
  await assert.rejects(f.messenger.send(binding, '你好', { requestId: 'own' }), /生成失败/)
  assert.equal(f.reads(), 0)
})

test('撤销请求能中止等待，纯 HTML 回复不会回退发送原始面板', async () => {
  const abort = new AbortController()
  const f = fixture({ wait: async () => { abort.abort(new Error('停用')) } })
  await assert.rejects(f.messenger.send(binding, '你好', { requestId: 'own', signal: abort.signal }), /停用/)
  const html = fixture({ readHistory: async () => ({ chat: { id: binding.chatId, sessionId: binding.sessionId, messages: [{ role: 'assistant', turn: 7, text: '<script>private()</script>' }] }, view: { replyProjections: [{ turn: 7, parts: [{ kind: 'html', html: '<script>private()</script>' }] }] } }) })
  await assert.rejects(html.messenger.send(binding, '你好', { requestId: 'own' }), /没有可发送/)
})
