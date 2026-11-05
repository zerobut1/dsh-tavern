import path from 'node:path'
import { watchFile, unwatchFile } from 'node:fs'
import { createOneBotClient } from './domain/onebot-client.js'
import { createQqBridgeProcessor } from './domain/qq-bridge.js'
import { normalizeQqBridgeConfig, QQ_BRIDGE_CONFIG, QQ_BRIDGE_STATUS } from './domain/qq-bridge-config.js'

export async function startQqBridge({ dataRoot, store, messenger, logger = console, createClient = createOneBotClient }) {
  const configFile = path.join(dataRoot, QQ_BRIDGE_CONFIG)
  let signature, client, processor, disposed = false, refreshing = Promise.resolve()
  const status = { enabled: false, connected: false, ready: false, lastError: null }
  const publish = async () => { if (!disposed) await store.writeJson(QQ_BRIDGE_STATUS, { ...status, updatedAt: Date.now(), pid: process.pid }) }
  function stop() {
    processor?.stop(); client?.stop(); processor = null; client = null
    status.connected = false; status.ready = false
  }
  async function refresh() {
    if (disposed) return
    let config, next
    try {
      const raw = await store.readJson(QQ_BRIDGE_CONFIG)
      config = raw === undefined ? null : normalizeQqBridgeConfig(raw)
      next = JSON.stringify(config)
    } catch {
      stop(); signature = undefined; status.enabled = false; status.lastError = 'QQ 桥接配置无效，已停止消息处理'
      await publish(); return
    }
    if (next === signature) return
    stop(); signature = next; status.enabled = Boolean(config?.enabled); status.lastError = null
    if (!config?.enabled) {
      if (config) logger.log('dsh-tavern: QQ 桥接已配置，当前禁用（不会连接 NapCat 或收发消息）')
      await publish(); return
    }
    const currentSignature = next
    async function authorized(userId) {
      if (disposed || currentSignature !== signature || !status.ready) return false
      // Re-read the kill switch immediately before each send, not just on the
      // one-second file watcher. A reply finishing during disable is suppressed.
      try {
        const current = normalizeQqBridgeConfig(await store.readJson(QQ_BRIDGE_CONFIG))
        return current.enabled && current.allowedUserIds.includes(String(userId)) && JSON.stringify(current) === currentSignature
      } catch { return false }
    }
    const connection = createClient({ ...config, allowSend: params => authorized(params.user_id) })
    client = connection
    const receiver = createQqBridgeProcessor({ config, store, messenger, client: connection, authorized,
      onError: () => { status.lastError = 'QQ 消息处理失败或发送结果未确认，请查看 Tavern 对话；不会自动重试'; void publish().catch(() => {}) } })
    processor = receiver
    connection.on('open', () => {
      status.connected = true; status.ready = false
      void connection.call('get_login_info').then(info => {
        if (disposed || connection !== client) return
        if (String(info?.user_id) !== config.botQq) {
          status.lastError = 'NapCat 登录账号与配置不符，已停止消息处理'; stop()
        } else { status.ready = true; status.lastError = null; receiver.ready() }
        return publish()
      }).catch(() => { if (connection === client) { status.lastError = '无法验证 NapCat 登录账号'; void publish().catch(() => {}) } })
    })
    connection.on('event', event => { if (connection === client && status.ready) void receiver.handle(event) })
    connection.on('close', () => { if (connection === client) { status.connected = false; status.ready = false; receiver.disconnected(); void publish().catch(() => {}) } })
    connection.on('warning', message => { if (connection === client) { status.lastError = message; void publish().catch(() => {}) } })
    connection.start()
    await publish()
  }
  function schedule() {
    refreshing = refreshing.then(refresh).catch(() => { stop(); logger.warn('dsh-tavern: QQ 桥接启动失败，已停止消息处理') })
    return refreshing
  }
  await schedule()
  watchFile(configFile, { interval: 1000, persistent: false }, schedule)
  return () => { disposed = true; unwatchFile(configFile, schedule); stop() }
}
