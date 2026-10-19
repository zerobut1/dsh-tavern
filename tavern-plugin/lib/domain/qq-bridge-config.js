import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'

export const QQ_BRIDGE_CONFIG = 'qq-bridge.json'
export const QQ_BRIDGE_STATE = 'qq-bridge-state.json'
export const QQ_BRIDGE_STATUS = 'qq-bridge-status.json'

function qq(value) {
  const id = String(value ?? '')
  if (!/^[1-9]\d{4,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('QQ 号格式不正确')
  return id
}

export function normalizeQqBridgeConfig(input) {
  if (!input || input.version !== 1) throw new Error('QQ 桥接配置需要 version: 1')
  if (typeof input.enabled !== 'boolean') throw new Error('QQ 桥接 enabled 必须是布尔值')
  const url = new URL(input.wsUrl)
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('无效的 NapCat WebSocket 地址')
  // This first version deliberately connects only to a local NapCat instance.
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('NapCat 地址必须是本机地址')
  if (typeof input.token !== 'string' || !input.token.trim() || /[\r\n]/.test(input.token)) throw new Error('请配置有效的 NapCat OneBot Access Token')
  const botQq = qq(input.botQq)
  if (!Array.isArray(input.allowedUserIds)) throw new Error('请配置 allowedUserIds 白名单')
  const allowedUserIds = [...new Set(input.allowedUserIds.map(qq))]
  if (allowedUserIds.includes(botQq)) throw new Error('白名单不能包含机器人自身')
  if (input.enabled && !allowedUserIds.length) throw new Error('启用前必须填写私聊 QQ 白名单')
  if (!Array.isArray(input.bindings) || !input.bindings.length) throw new Error('请绑定至少一个 Tavern 对话')
  const names = new Set()
  const bindings = input.bindings.map(binding => {
    const name = String(binding.name || '').trim()
    if (!name || name.length > 80 || names.has(name)) throw new Error('对话别名不能为空或重复，最多 80 字')
    names.add(name)
    if (!/^session-[a-f\d-]{36}$/i.test(binding.sessionId) || !/^chat-[\w-]+$/.test(binding.chatId)) throw new Error('对话绑定需要固定的 sessionId 和 chatId')
    return { name, sessionId: binding.sessionId, chatId: binding.chatId }
  })
  return { version: 1, enabled: input.enabled, wsUrl: url.href, token: input.token, botQq, allowedUserIds, bindings }
}

// Read NapCat's existing configuration; never write to its installation folder.
export async function readNapCatConnection(directory) {
  const root = path.join(directory, 'napcat', 'config')
  const connections = []
  for (const file of await readdir(root)) {
    const match = /^onebot11_(\d+)\.json$/.exec(file)
    if (!match) continue
    const config = JSON.parse(await readFile(path.join(root, file), 'utf8'))
    for (const server of config.network?.websocketServers || []) {
      if (!server.enable) continue
      const host = server.host === '::1' ? '[::1]' : server.host
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) continue
      connections.push({ wsUrl: `ws://${host}:${server.port}/`, token: server.token, botQq: match[1] })
    }
  }
  if (connections.length !== 1) throw new Error('需要 NapCat 恰好配置一个启用的本机正向 WebSocket 服务')
  return connections[0]
}

export async function resolveQqChat(dataRoot, title) {
  const index = JSON.parse(await readFile(path.join(dataRoot, 'index.json'), 'utf8'))
  const links = JSON.parse(await readFile(path.join(dataRoot, 'sessions.json'), 'utf8'))
  const matches = (index.chats || []).filter(chat => chat.title === title && ['story', 'script'].includes(chat.mode || 'story') && chat.requestMode !== 'sillytavern')
  if (matches.length !== 1) throw new Error('对话名称不存在、不唯一或不是原生 Tavern 游玩对话')
  const sessionIds = Object.keys(links).filter(id => links[id] === matches[0].id)
  if (sessionIds.length !== 1) throw new Error('对话需要唯一的已绑定 DSH 会话，请先在 Tavern 中打开它')
  return { name: title, sessionId: sessionIds[0], chatId: matches[0].id }
}
