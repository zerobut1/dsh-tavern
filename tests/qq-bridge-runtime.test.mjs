import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocketServer } from 'ws'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { startQqBridge } from '../tavern-plugin/lib/qq-bridge-runtime.js'
import { QQ_BRIDGE_CONFIG, QQ_BRIDGE_STATUS } from '../tavern-plugin/lib/domain/qq-bridge-config.js'

async function until(predicate) {
  const end = Date.now() + 5000
  while (Date.now() < end) { if (await predicate()) return; await delay(10) }
  throw new Error('模拟桥接状态等待超时')
}
async function fixture(t, { loggedInQq = 123456789 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qq-runtime-'))
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const actions = [], sockets = []
  server.on('connection', (socket, request) => {
    assert.equal(request.headers.authorization, 'Bearer dummy-token')
    sockets.push(socket)
    socket.on('message', raw => {
      const value = JSON.parse(String(raw)); actions.push(value)
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: value.echo, data: value.action === 'get_login_info' ? { user_id: loggedInQq } : { message_id: 123 } }))
    })
  })
  const store = createProfileDataStore({ dataRoot: root })
  const config = { version: 1, enabled: false, wsUrl: `ws://127.0.0.1:${server.address().port}/`, token: 'dummy-token', botQq: '123456789', allowedUserIds: ['987654321'], bindings: [{ name: '测试', sessionId: 'session-00000000-0000-4000-8000-000000000001', chatId: 'chat-test' }] }
  await store.writeJson(QQ_BRIDGE_CONFIG, config)
  let finish, inputs = 0
  const messenger = { async send() { inputs++; return new Promise(resolve => { finish = resolve }) } }
  const stop = await startQqBridge({ dataRoot: root, store, messenger, logger: { log() {}, warn() {} } })
  t.after(async () => { stop(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  function message(id) { sockets.at(-1).send(JSON.stringify({ post_type: 'message', message_type: 'private', sub_type: 'friend', self_id: 123456789, user_id: 987654321, message_id: id, time: Math.floor(Date.now() / 1000), message: [{ type: 'text', data: { text: '测试消息' } }] })) }
  return { store, config, actions, sockets, message, inputs: () => inputs, finish: () => finish({ text: '模拟回复 [CQ:at,qq=10000]' }) }
}

test('模拟 WebSocket 全链路：初始不连接，热启用后身份验证、接收、回复、热禁用', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  assert.equal(f.sockets.length, 0)
  await f.store.writeJson(QQ_BRIDGE_CONFIG, { ...f.config, enabled: true })
  await until(async () => (await f.store.readJson(QQ_BRIDGE_STATUS))?.ready)
  assert.deepEqual(f.actions.map(action => action.action), ['get_login_info'])
  f.message(1); await until(() => f.inputs() === 1); f.finish()
  await until(() => f.actions.length === 2)
  assert.equal(f.actions[1].action, 'send_private_msg')
  assert.deepEqual(f.actions[1].params, { user_id: 987654321, message: [{ type: 'text', data: { text: '模拟回复 [CQ:at,qq=10000]' } }] })
  await f.store.writeJson(QQ_BRIDGE_CONFIG, f.config)
  await until(async () => (await f.store.readJson(QQ_BRIDGE_STATUS))?.enabled === false)
  assert.equal((await f.store.readJson(QQ_BRIDGE_STATUS)).connected, false)
})

test('模拟 WebSocket：生成期间关开关立即拦截投递，无需等文件监听器', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  await f.store.writeJson(QQ_BRIDGE_CONFIG, { ...f.config, enabled: true })
  await until(async () => (await f.store.readJson(QQ_BRIDGE_STATUS))?.ready)
  f.message(1); await until(() => f.inputs() === 1)
  await f.store.writeJson(QQ_BRIDGE_CONFIG, f.config)
  f.finish(); await delay(100)
  assert.deepEqual(f.actions.map(action => action.action), ['get_login_info'])
})

test('模拟 WebSocket：实际登录账号不符时断开且不生成、不发送', { timeout: 10000 }, async t => {
  const f = await fixture(t, { loggedInQq: 999999999 })
  await f.store.writeJson(QQ_BRIDGE_CONFIG, { ...f.config, enabled: true })
  await until(async () => (await f.store.readJson(QQ_BRIDGE_STATUS))?.lastError?.includes('账号与配置不符'))
  const status = await f.store.readJson(QQ_BRIDGE_STATUS)
  assert.equal(status.ready, false); assert.equal(status.connected, false)
  assert.equal(f.inputs(), 0); assert.deepEqual(f.actions.map(action => action.action), ['get_login_info'])
})
