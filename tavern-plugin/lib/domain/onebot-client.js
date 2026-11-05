import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const READ_ACTIONS = new Set(['get_login_info', 'get_status', 'get_version_info'])

// One forward WebSocket carries events and correlated action responses. Never
// retry an action: after a lost acknowledgement, a send may already have arrived.
export function createOneBotClient({ wsUrl, token, allowSend = () => false, actionTimeoutMs = 15000, reconnectMs = 3000, WebSocketImpl = WebSocket }) {
  const events = new EventEmitter()
  const pending = new Map()
  let socket, reconnectTimer, stopped = true
  function rejectPending() {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('NapCat 连接中断，操作未重试')) }
    pending.clear()
  }
  function connect() {
    if (stopped) return
    socket = new WebSocketImpl(wsUrl, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 10000, maxPayload: 2 * 1024 * 1024 })
    socket.on('open', () => events.emit('open'))
    socket.on('message', data => {
      let value
      try { value = JSON.parse(String(data)) } catch { return }
      if (value && Object.hasOwn(value, 'echo')) {
        const entry = pending.get(value.echo)
        if (!entry) return
        clearTimeout(entry.timer); pending.delete(value.echo)
        if (value.status === 'ok' && value.retcode === 0) entry.resolve(value.data)
        else entry.reject(new Error('NapCat 操作失败（返回码 ' + String(value.retcode) + '）'))
      } else if (value?.post_type) events.emit('event', value)
    })
    // Avoid logging raw WebSocket errors: URLs and headers can contain secrets.
    socket.on('error', () => events.emit('warning', 'NapCat WebSocket 连接失败，请检查端口和 Token'))
    socket.on('close', () => {
      rejectPending(); events.emit('close')
      if (!stopped) { reconnectTimer = setTimeout(connect, reconnectMs); reconnectTimer.unref?.() }
    })
  }
  Object.defineProperty(events, 'connected', { get: () => socket?.readyState === WebSocket.OPEN })
  return Object.assign(events, {
    start() { if (!stopped) return; stopped = false; connect() },
    async call(action, params = {}) {
      if (!READ_ACTIONS.has(action) && (action !== 'send_private_msg' || !await allowSend(params))) throw new Error('QQ 消息发送未获启用或目标不在白名单')
      if (stopped || socket?.readyState !== WebSocket.OPEN) throw new Error('NapCat 尚未连接')
      const echo = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(echo); reject(new Error('NapCat 操作超时，未自动重试')) }, actionTimeoutMs)
        pending.set(echo, { resolve, reject, timer })
        try { socket.send(JSON.stringify({ action, params, echo }), error => {
          if (!error) return
          const entry = pending.get(echo)
          if (entry) { clearTimeout(entry.timer); pending.delete(echo); reject(new Error('NapCat 操作发送失败，未自动重试')) }
        }) } catch { clearTimeout(timer); pending.delete(echo); reject(new Error('NapCat 操作发送失败')) }
      })
    },
    stop() { stopped = true; clearTimeout(reconnectTimer); rejectPending(); socket?.terminate() },
  })
}
