import { readFile } from 'node:fs/promises'

// This adapter delegates all writes and generation to the existing Tavern/DSH services.
export function createMobileChatApi({ listSessions, readState, readHistory, activity, foreground, prompt, demand }) {
  const submitting = new Set()
  async function resolve(sessionId) {
    const sessions = (await listSessions()).filter(item => ['story', 'script'].includes(item.mode || 'story') && item.requestMode !== 'sillytavern')
    const selected = sessionId ? sessions.find(item => item.sessionId === sessionId)
      : sessions.sort((a, b) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0))[0]
    if (!selected) throw new Error('没有可用的游玩会话，请先在电脑上打开存档')
    return selected
  }
  function busy(state) { return submitting.has(state.sessionId) || foreground(state.sessionId) || activity(state).busy || Boolean(state.regenInProgress) }
  return { async call(method, args = {}) {
    const selected = await resolve(args.sessionId)
    const state = await readState(selected.sessionId)
    if (!state || state.id !== selected.chatId) throw new Error('会话已变化，请刷新后重试')
    demand(selected.sessionId)
    if (method === 'read') {
      const result = { sessionId: selected.sessionId, chatId: state.id, title: selected.title || selected.cardName || 'DSH Tavern', revision: state._storageRevision, busy: busy(state) }
      if (args.revision !== state._storageRevision) {
        const { chat, view } = await readHistory(selected.sessionId)
        result.revision = chat._storageRevision
        const projections = new Map((view?.replyProjections || []).map(row => [row.turn, row]))
        result.messages = (chat.messages || []).flatMap((row, index) => {
          if (!['user', 'assistant'].includes(row.role)) return []
          // Reuse the PC display projection; don't leak raw reasoning or card-panel HTML into the chat.
          // Ordinary markdown has no separate projection; its canonical text is already the displayed body.
          const projection = projections.get(Number(row.turn) || (row.greeting ? 1 : 0))
          const text = row.role === 'assistant' && projection
            ? (projection.parts || []).filter(part => part.kind === 'markdown').map(part => part.text).join('\n') : row.text
          return typeof text === 'string' && text.trim() ? [{ id: selected.sessionId + ':' + index, role: row.role, text }] : []
        })
      }
      return result
    }
    if (method !== 'send') throw new Error('未知手机接口')
    if (args.chatId !== state.id || args.revision !== state._storageRevision) throw new Error('会话已更新，请稍后重新发送')
    if (busy(state)) throw new Error('请等待当前生成和变量结算完成')
    if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 1000000) throw new Error('消息为空或过长')
    if (typeof args.requestId !== 'string' || !/^[\da-f-]{36}$/i.test(args.requestId)) throw new Error('无效的消息标识')
    submitting.add(selected.sessionId)
    try {
      await prompt({ sessionId: selected.sessionId, requestId: args.requestId, content: [{ type: 'text', text: args.text }], mode: 'followup' }, new AbortController().signal)
      return { accepted: true }
    } finally { submitting.delete(selected.sessionId) }
  } }
}

export function registerMobileChatRoutes(ctx) {
  const assets = { '/mobile': ['index.html', 'text/html; charset=utf-8'], '/mobile/': ['index.html', 'text/html; charset=utf-8'],
    '/mobile/mobile.js': ['mobile.js', 'text/javascript; charset=utf-8'], '/mobile/mobile.css': ['mobile.css', 'text/css; charset=utf-8'] }
  const webServer = ctx.get('webServer')
  if (!webServer) return
  ctx.effect(() => webServer.register({ kind: 'prefix', path: '/mobile', handler: async (req, res) => {
    const asset = assets[new URL(req.url, 'http://localhost').pathname]
    if (!asset || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return }
    try {
      const body = await readFile(new URL('../mobile-assets/' + asset[0], import.meta.url))
      res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch { res.writeHead(503); res.end('手机界面尚未构建，请运行 pnpm run build:mobile') }
  } }), 'dsh-tavern: mobile chat page')
}
