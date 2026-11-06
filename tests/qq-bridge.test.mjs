import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeQqBridgeConfig, QQ_BRIDGE_STATE } from '../tavern-plugin/lib/domain/qq-bridge-config.js'
import { createQqBridgeProcessor, privateQqText, splitQqReply } from '../tavern-plugin/lib/domain/qq-bridge.js'

export const binding = { name: '测试角色', sessionId: 'session-00000000-0000-4000-8000-000000000001', chatId: 'chat-test' }
const config = (extra = {}) => normalizeQqBridgeConfig({ version: 1, enabled: true, wsUrl: 'ws://127.0.0.1:3001/', token: 'test-secret', botQq: '123456789', allowedUserIds: ['987654321'], bindings: [binding], ...extra })
const event = (extra = {}) => ({ post_type: 'message', message_type: 'private', sub_type: 'friend', self_id: 123456789, user_id: 987654321, message_id: 42, time: 1000, message: [{ type: 'text', data: { text: '你好 [CQ:at,qq=10000]' } }], ...extra })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
// Only the processor is under test; persistence and delivery are in-memory ports.
async function fixture(_t, overrides = {}) {
  const values = new Map()
  const store = {
    readJson: async key => structuredClone(values.get(key)),
    updateJson: async (key, update) => {
      const value = update(structuredClone(values.get(key)))
      if (value !== undefined) values.set(key, structuredClone(value))
      return structuredClone(values.get(key))
    }
  }
  const sent = [], inputs = [], errors = []
  let enabled = true
  const client = { connected: true, async call(action, params) { sent.push({ action, params }) } }
  const messenger = { async send(target, text, options) { inputs.push({ target, text, options }); return { text: '你好' } } }
  const options = { config: config(), store, client, messenger, authorized: async () => enabled, now: () => 1000000, onError: error => errors.push(error), ...overrides }
  const processor = createQqBridgeProcessor(options)
  processor.ready(1000000)
  return { processor, options, store, client, inputs, sent, errors, disable() { enabled = false } }
}

test('QQ 配置默认关闭；启用必须有白名单、固定绑定和本机带 Token 的连接', () => {
  assert.equal(config({ enabled: false, allowedUserIds: [] }).enabled, false)
  for (const bad of [{ enabled: 'false' }, { allowedUserIds: [] }, { token: '' }, { token: 'header\ninjection' }, { botQq: '' }, { allowedUserIds: ['9999999999999999'] }, { wsUrl: 'ws://example.com:3001' }, { wsUrl: 'ws://localhost:3001/?token=x' }, { bindings: [{ ...binding, chatId: '' }] }, { allowedUserIds: ['123456789'] }]) assert.throws(() => config(bad))
})

test('QQ 仅接受指定账号的新好友文字私聊', () => {
  const accepted = privateQqText(event(), config(), 1000000, 1000000)
  assert.equal(accepted.userId, '987654321')
  for (const bad of [{ post_type: 'message_sent' }, { post_type: 'notice' }, { message_type: 'group' }, { group_id: 45678 }, { sub_type: 'group' }, { self_id: 99999 }, { user_id: 10000 }, { user_id: 123456789 }, { time: 999 }, { time: 9999 }, { time: undefined }, { message_id: undefined }, { message: '你好' }, { sender: { user_id: 10000 } }, { message: [{ type: 'image', data: { file: 'x' } }] }, { message: [...event().message, { type: 'reply', data: { id: 'x' } }] }]) assert.equal(privateQqText(event(bad), config(), 1000000, 1000000), null, JSON.stringify(bad))
})

test('QQ 去重跨处理器实例保留；收件人只能来自白名单事件，回复是纯文本段', async t => {
  const f = await fixture(t)
  await f.processor.handle(event())
  await f.processor.handle(event())
  const restarted = createQqBridgeProcessor(f.options); restarted.ready(1000000)
  await restarted.handle(event())
  assert.equal(f.inputs.length, 1, f.errors.map(error => error.stack).join('\n'))
  assert.deepEqual(f.inputs[0].target, binding)
  assert.equal(f.inputs[0].text, '你好 [CQ:at,qq=10000]')
  assert.equal(f.sent.length, 1)
  assert.deepEqual(f.sent[0], { action: 'send_private_msg', params: { user_id: 987654321, message: [{ type: 'text', data: { text: '你好' } }] } })
  assert.equal((await f.store.readJson(QQ_BRIDGE_STATE)).receipts['123456789:987654321:42'].status, 'replied')
})

test('生成中关闭开关，完成的回复也不投递', async t => {
  const started = deferred(), reply = deferred()
  const f = await fixture(t, { messenger: { async send() { started.resolve(); return reply.promise } } })
  const job = f.processor.handle(event()); await started.promise
  f.disable(); reply.resolve({ text: '不应发送' }); await job
  assert.equal(f.sent.length, 0)
  assert.equal((await f.store.readJson(QQ_BRIDGE_STATE)).receipts['123456789:987654321:42'].status, 'suppressed')
})

test('多条消息串行，失败的发送不会自动重试或再次生成', async t => {
  const started = deferred(), release = deferred(); let calls = 0
  const f = await fixture(t, { messenger: { async send() { calls++; if (calls === 1) { started.resolve(); await release.promise } return { text: '回复' } } } })
  const first = f.processor.handle(event()); await started.promise
  const second = f.processor.handle(event({ message_id: 43 }))
  assert.equal(calls, 1); release.resolve(); await Promise.all([first, second]); assert.equal(calls, 2)
  f.client.call = async () => { throw new Error('ack lost') }
  await f.processor.handle(event({ message_id: 44 })); await f.processor.handle(event({ message_id: 44 }))
  assert.equal(calls, 3); assert.equal(f.errors.length, 1)
})

test('角色切换持久化并绑定固定对话，指令不进入模型', async t => {
  const second = { name: '另一个角色', sessionId: 'session-00000000-0000-4000-8000-000000000002', chatId: 'chat-second' }
  const f = await fixture(t, { config: config({ bindings: [binding, second] }) })
  await f.processor.handle(event({ message: [{ type: 'text', data: { text: '/切换 另一个角色' } }] }))
  await f.processor.handle(event({ message_id: 43 }))
  assert.equal(f.inputs.length, 1); assert.deepEqual(f.inputs[0].target, second)
  const restarted = createQqBridgeProcessor(f.options); restarted.ready(1000000)
  await restarted.handle(event({ message_id: 44 }))
  assert.deepEqual(f.inputs[1].target, second)
  await restarted.handle(event({ message_id: 45, message: [{ type: 'text', data: { text: '/角色' } }] }))
  assert.equal(f.inputs.length, 2)
})

test('QQ 按段落及 Unicode 字符分条，保留段内换行并限制发送总量', () => {
  assert.deepEqual(splitQqReply('  第一条\r\n\r\n第二条\r\n  \t\r\n\r\n第三条\n段内换行\n\n  '), ['第一条', '第二条', '第三条\n段内换行'])
  assert.deepEqual(splitQqReply('\n \n\t\n'), [])
  assert.deepEqual(splitQqReply('短消息'), ['短消息'])
  assert.deepEqual(splitQqReply('😀😀😀\n\n好', 2), ['😀😀', '😀', '好'])
  assert.throws(() => splitQqReply('消息', 0), /正整数/)
  const long = '😀'.repeat(1501)
  const chunks = splitQqReply(long)
  assert.equal(chunks.length, 2)
  assert.equal(chunks.join(''), long)
  assert.equal(Array.from(chunks[0]).length, 1500)
  assert.equal(splitQqReply(Array(20).fill('短句').join('\n\n')).length, 20)
  assert.throws(() => splitQqReply(Array(21).fill('短句').join('\n\n')), /20 条/)
})
