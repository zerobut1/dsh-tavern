import assert from 'node:assert/strict'
import test from 'node:test'
import { createMobileChatApi } from '../tavern-plugin/lib/http/mobile-chat.js'

function fixture() {
  const state = { id: 'chat', sessionId: 'session', _storageRevision: 3, messages: [] }
  const sessions = [
    { sessionId: 'card', chatId: 'other', mode: 'card', updatedAt: 100 },
    { sessionId: 'compat', chatId: 'other', requestMode: 'sillytavern', updatedAt: 100 },
    { sessionId: 'older', chatId: 'other', mode: 'script', updatedAt: 1 },
    { sessionId: 'session', chatId: 'chat', mode: 'story', lastOpenedAt: 10, title: '手机对话' }
  ]
  const calls = [], demands = [], view = { replyProjections: [] }
  const deps = {
    listSessions: async () => sessions, readState: async () => state,
    readHistory: async id => { calls.push(['history', id]); return { chat: state, view } },
    activity: () => ({ busy: false }), foreground: () => false,
    demand: id => demands.push(id), prompt: async (...args) => { calls.push(['prompt', ...args]) }
  }
  const api = createMobileChatApi(deps)
  const send = extra => api.call('send', { sessionId: 'session', chatId: 'chat', revision: 3,
    text: '  你好\n世界  ', requestId: 'e943fd76-1111-4444-aaaa-123456789abc', ...extra })
  return { api, send, state, sessions, calls, demands, view, deps }
}

test('手机默认选择最近的原生游玩会话，未变化时只返回修订号', async () => {
  const f = fixture()
  const result = await f.api.call('read', { revision: 3 })
  assert.deepEqual(result, { sessionId: 'session', chatId: 'chat', title: '手机对话', revision: 3, busy: false })
  assert.deepEqual(f.demands, ['session'])
  assert.equal(f.calls.length, 0)
  await assert.rejects(f.api.call('read', { sessionId: 'compat' }), /没有可用/)
  f.state.id = 'replaced-chat'
  await assert.rejects(f.api.call('read', { sessionId: 'session' }), /会话已变化/)
})

test('手机历史复用显示投影，排除隐藏正文、状态栏 HTML 和内部消息', async () => {
  const f = fixture()
  f.state.messages = [
    { role: 'assistant', greeting: true, text: '<html>面板</html>原始开场' },
    { role: 'user', text: '我的原话', turn: 2 },
    { role: 'assistant', text: '秘密思考和正文', turn: 2 },
    { role: 'tool', text: '内部回执' },
    { role: 'assistant', text: '普通 markdown', turn: 3 },
    { role: 'assistant', text: '仅面板', turn: 4 }
  ]
  f.view.replyProjections = [
    { turn: 1, parts: [{ kind: 'markdown', text: '可见开场' }, { kind: 'html', text: '<html>面板</html>' }] },
    { turn: 2, parts: [{ kind: 'markdown', text: '你好' }, { kind: 'markdown', text: '第二句' }] },
    { turn: 4, parts: [{ kind: 'html', text: '不应泄露' }] }
  ]
  const before = structuredClone(f.state)
  const result = await f.api.call('read')
  assert.deepEqual(result.messages, [
    { id: 'session:0', role: 'assistant', text: '可见开场' },
    { id: 'session:1', role: 'user', text: '我的原话' },
    { id: 'session:2', role: 'assistant', text: '你好\n第二句' },
    { id: 'session:4', role: 'assistant', text: '普通 markdown' }
  ])
  assert.deepEqual(f.state, before)
})

test('手机发送原文和请求编号交给原生 followup，不另起存档', async () => {
  const f = fixture()
  assert.deepEqual(await f.send(), { accepted: true })
  assert.equal(f.calls.length, 1)
  const [, input, signal] = f.calls[0]
  assert.deepEqual(input, { sessionId: 'session', requestId: 'e943fd76-1111-4444-aaaa-123456789abc',
    content: [{ type: 'text', text: '  你好\n世界  ' }], mode: 'followup' })
  assert.equal(signal.aborted, false)
})

test('过期存档、非法输入和忙碌状态都不能触发手机生成', async () => {
  const f = fixture()
  for (const extra of [{ chatId: 'old' }, { revision: 2 }, { text: '' }, { text: '   ' },
    { text: 'a'.repeat(1000001) }, { text: 1 }, { requestId: 'bad' }]) {
    await assert.rejects(f.send(extra))
  }
  for (const busy of ['foreground', 'activity', 'regen']) {
    const g = fixture()
    if (busy === 'foreground') g.deps.foreground = () => true
    if (busy === 'activity') g.deps.activity = () => ({ busy: true })
    if (busy === 'regen') g.state.regenInProgress = true
    await assert.rejects(createMobileChatApi(g.deps).call('send', {
      sessionId: 'session', chatId: 'chat', revision: 3, text: '你好', requestId: 'e943fd76-1111-4444-aaaa-123456789abc'
    }), /等待/)
    assert.equal(g.calls.length, 0)
  }
  await assert.rejects(f.api.call('unknown'), /未知手机接口/)
  assert.equal(f.calls.length, 0)
})

test('手机提交锁拦截并发发送，生成失败后释放锁以便重试', async () => {
  const f = fixture()
  let entered, fail, attempts = 0
  const started = new Promise(resolve => { entered = resolve })
  f.deps.prompt = async () => {
    if (attempts++ === 0) { entered(); await new Promise((_, reject) => { fail = reject }) }
  }
  const api = createMobileChatApi(f.deps)
  const args = { sessionId: 'session', chatId: 'chat', revision: 3, text: '你好', requestId: 'e943fd76-1111-4444-aaaa-123456789abc' }
  const pending = api.call('send', args)
  const rejected = assert.rejects(pending, /模拟失败/)
  await started
  assert.equal((await api.call('read', { revision: 3 })).busy, true)
  await assert.rejects(api.call('send', args), /等待/)
  fail(new Error('模拟失败'))
  await rejected
  assert.equal((await api.call('read', { revision: 3 })).busy, false)
  assert.deepEqual(await api.call('send', args), { accepted: true })
})
