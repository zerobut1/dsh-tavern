#!/usr/bin/env node
import path from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DSH_ROOT } from './launcher-environment.mjs'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createOneBotClient } from '../tavern-plugin/lib/domain/onebot-client.js'
import { normalizeQqBridgeConfig, readNapCatConnection, resolveQqChat, QQ_BRIDGE_CONFIG, QQ_BRIDGE_STATUS } from '../tavern-plugin/lib/domain/qq-bridge-config.js'

export async function checkNapCat(config, { createClient = createOneBotClient, timeoutMs = 12000 } = {}) {
  // Default allowSend=false is intentional even when the saved bridge is enabled.
  const client = createClient({ wsUrl: config.wsUrl, token: config.token })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接 NapCat 超时，请先启动并登录 NapCat')), timeoutMs)
      client.once('open', () => { clearTimeout(timer); resolve() })
      client.once('warning', () => { clearTimeout(timer); reject(new Error('无法连接 NapCat，请检查端口、Token 和登录状态')) })
      client.start()
    })
    const info = await client.call('get_login_info')
    if (String(info?.user_id) !== config.botQq) throw new Error('NapCat 登录 QQ 与桥接配置不符')
    const status = await client.call('get_status')
    return { botQq: String(info.user_id), online: status?.online === true }
  } finally { client.stop() }
}

export async function qqBridgeCommand(args, { dataRoot = path.join(DSH_ROOT, 'profile-data', 'tavern', 'data'), log = console.log, check = checkNapCat } = {}) {
  const store = createProfileDataStore({ dataRoot })
  const action = args[0] || 'status'
  const options = {}
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]
    if (!['--napcat', '--chat', '--user'].includes(key) || !args[i + 1] || options[key] !== undefined) throw new Error('未知参数或缺少值：' + key)
    options[key] = args[i + 1]
  }
  if (action === 'setup') {
    if (!options['--napcat'] || !options['--chat']) throw new Error('用法：node bin/qq-bridge.mjs setup --napcat 安装目录 --chat 对话名称 [--user 你的QQ号]')
    if (await store.readJson(QQ_BRIDGE_CONFIG)) throw new Error('桥接配置已存在；修改数据目录中的 qq-bridge.json，避免覆盖现有绑定')
    const connection = await readNapCatConnection(path.resolve(options['--napcat']))
    const binding = await resolveQqChat(dataRoot, options['--chat'])
    const config = normalizeQqBridgeConfig({ version: 1, enabled: false, ...connection, allowedUserIds: options['--user'] ? [options['--user']] : [], bindings: [binding] })
    await store.writeJson(QQ_BRIDGE_CONFIG, config)
    log('QQ 桥接已配置，保持禁用。绑定对话：' + binding.name)
    log('配置文件：' + path.join(dataRoot, QQ_BRIDGE_CONFIG))
    return
  }
  const raw = await store.readJson(QQ_BRIDGE_CONFIG)
  if (!raw) throw new Error('尚未配置 QQ 桥接，请先运行 setup')
  // The kill switch must work even if another field was edited incorrectly.
  if (action === 'disable') {
    raw.enabled = false
    await store.writeJson(QQ_BRIDGE_CONFIG, raw)
    log('QQ 桥接已禁用，后台将在一秒内断开；后续回复会被发送前检查拦截。')
    return
  }
  const config = normalizeQqBridgeConfig(raw)
  if (action === 'status') {
    const status = await store.readJson(QQ_BRIDGE_STATUS)
    log('QQ 桥接：' + (config.enabled ? '已启用' : '禁用（不收发消息）'))
    log('NapCat：' + config.wsUrl + '；机器人 QQ：' + config.botQq)
    log('允许的私聊 QQ：' + (config.allowedUserIds.join('、') || '未配置，禁止启用'))
    for (const binding of config.bindings) log('绑定：' + binding.name + ' → ' + binding.sessionId + ' / ' + binding.chatId)
    log('后台状态：' + (status ? JSON.stringify(status) : '尚未加载此功能；首次配置后请重启 Tavern'))
    return
  }
  if (action === 'check') {
    const result = await check(config)
    log('NapCat 只读检查通过；登录 QQ：' + result.botQq + '；在线：' + result.online)
    log('仅调用 get_login_info / get_status；未调用任何消息发送接口，未启用桥接。')
    return result
  }
  if (action === 'enable') {
    const next = normalizeQqBridgeConfig({ ...config, enabled: true, ...(options['--user'] ? { allowedUserIds: [options['--user']] } : {}) })
    await check(next)
    await store.writeJson(QQ_BRIDGE_CONFIG, next)
    log('QQ 桥接已启用，只回复白名单好友的新私聊文字消息。')
    return
  }
  throw new Error('用法：node bin/qq-bridge.mjs setup|status|check|enable|disable')
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  qqBridgeCommand(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
