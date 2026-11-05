import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import test from 'node:test'
import { createOneBotClient } from '../tavern-plugin/lib/domain/onebot-client.js'
import { checkNapCat } from '../bin/qq-bridge.mjs'

class Socket extends EventEmitter {
  static sockets = []
  constructor(url, options) { super(); this.url = url; this.options = options; this.readyState = 0; this.sent = []; Socket.sockets.push(this) }
  open() { this.readyState = 1; this.emit('open') }
  send(raw, callback) { this.sent.push(JSON.parse(raw)); callback?.() }
  terminate() { this.readyState = 3; this.emit('close') }
  respond(index, data) { this.emit('message', Buffer.from(JSON.stringify({ status: 'ok', retcode: 0, echo: this.sent[index].echo, data }))) }
}
function fixture(t, options = {}) {
  const client = createOneBotClient({ wsUrl: 'ws://127.0.0.1:3001/', token: 'not-printed', WebSocketImpl: Socket, ...options })
  t.after(() => client.stop()); client.start()
  const socket = Socket.sockets.at(-1); socket.open()
  return { client, socket }
}

test('OneBot 使用 Bearer 鉴权和 echo 关联乱序响应，消息事件独立分发', async t => {
  const { client, socket } = fixture(t)
  assert.equal(client.connected, true)
  assert.equal(socket.options.headers.Authorization, 'Bearer not-printed')
  const first = client.call('get_login_info'), second = client.call('get_status')
  socket.respond(1, { online: true }); socket.respond(0, { user_id: 123456789 })
  assert.deepEqual(await first, { user_id: 123456789 }); assert.deepEqual(await second, { online: true })
  const received = once(client, 'event'); socket.emit('message', JSON.stringify({ post_type: 'message', message_id: 1 }))
  assert.equal((await received)[0].message_id, 1)
  socket.emit('message', '{malformed')
})

test('OneBot 默认只读，禁止群发、任意 API 及未授权私聊', async t => {
  const { client, socket } = fixture(t)
  for (const action of ['send_private_msg', 'send_group_msg', 'send_msg', 'set_friend_add_request']) await assert.rejects(client.call(action, { user_id: 12345 }))
  assert.equal(socket.sent.length, 0)
  const writable = fixture(t, { allowSend: async params => params.user_id === 12345 })
  await assert.rejects(writable.client.call('send_private_msg', { user_id: 54321 }))
  const send = writable.client.call('send_private_msg', { user_id: 12345, message: [{ type: 'text', data: { text: '[CQ:at,qq=99999]' } }] })
  await Promise.resolve(); await Promise.resolve()
  writable.socket.respond(0, { message_id: 99 }); assert.deepEqual(await send, { message_id: 99 })
})

test('OneBot 超时、失败和断线拒绝未确认操作，不重试发送', async t => {
  const timed = fixture(t, { actionTimeoutMs: 5 })
  await assert.rejects(timed.client.call('get_status'), /超时/)
  assert.equal(timed.socket.sent.length, 1)
  const { client, socket } = fixture(t)
  const rejected = client.call('get_status')
  socket.emit('message', JSON.stringify({ echo: socket.sent[0].echo, status: 'failed', retcode: 1401 }))
  await assert.rejects(rejected, /1401/)
  const interrupted = client.call('get_status'); client.stop()
  await assert.rejects(interrupted, /中断/); assert.equal(client.connected, false)
  await assert.rejects(client.call('get_status'), /尚未连接/)
})

test('checkNapCat 仅检查身份与在线状态，不授予发送权限、不订阅消息处理', async () => {
  const actions = []; let stopped = false
  const client = Object.assign(new EventEmitter(), {
    start() { this.emit('open') }, stop() { stopped = true },
    async call(action) { actions.push(action); return action === 'get_login_info' ? { user_id: 123456789 } : { online: true } },
  })
  await checkNapCat({ wsUrl: 'ws://localhost:3001', token: 'secret', botQq: '123456789' }, { createClient(options) { assert.equal(options.allowSend, undefined); return client } })
  assert.deepEqual(actions, ['get_login_info', 'get_status']); assert.equal(client.listenerCount('event'), 0); assert.equal(stopped, true)
})
