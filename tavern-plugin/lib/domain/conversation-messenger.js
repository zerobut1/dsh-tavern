import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

// A headless input/output adapter. All generation, presets, scripts and settlement
// still run through the production SessionController and Tavern turn lifecycle.
export function createConversationMessenger({ readState, readHeader, readHistory, activity, foreground, prompt, demand, now = Date.now, wait = delay, timeoutMs = 600000, pollMs = 1000 }) {
  const locks = new Set()
  function assertBinding(state, binding) {
    if (!state || state.id !== binding.chatId || state.sessionId !== binding.sessionId) throw new Error('绑定的 Tavern 对话已变化，请重新配置桥接')
    if (!['story', 'script'].includes(state.mode || 'story') || state.requestMode === 'sillytavern') throw new Error('QQ 桥接仅支持原生 Tavern 游玩对话')
  }
  const busy = state => foreground(state.sessionId) || activity(state).busy || Boolean(state.regenInProgress)
  return { async send(binding, text, { signal, requestId = randomUUID() } = {}) {
    signal?.throwIfAborted()
    if (typeof text !== 'string' || !text.trim() || text.length > 10000) throw new Error('私聊消息为空或超过 10000 字')
    if (locks.has(binding.sessionId)) throw new Error('此 Tavern 对话正在处理另一条消息')
    locks.add(binding.sessionId)
    try {
      const state = await readState(binding.sessionId)
      assertBinding(state, binding)
      if (busy(state)) throw new Error('请等待 Tavern 当前生成和结算完成')
      signal?.throwIfAborted()
      demand(binding.sessionId)
      await prompt({ sessionId: binding.sessionId, requestId, content: [{ type: 'text', text }], mode: 'followup' }, signal || new AbortController().signal)
      const deadline = now() + timeoutMs
      while (now() < deadline) {
        signal?.throwIfAborted()
        const current = await readState(binding.sessionId)
        assertBinding(current, binding)
        const header = await readHeader(binding.sessionId)
        if (header?.foregroundError?.requestId === requestId) throw new Error('Tavern 本轮生成失败，请在电脑端查看错误')
        // Use the durable input request receipt, never "the latest reply" from
        // another browser input or a later turn.
        const commit = Object.values(header?.nativeCommits || {}).find(item => item.requestId === requestId)
        if (commit && !busy(current)) {
          const { chat, view } = await readHistory(binding.sessionId)
          assertBinding(chat, binding)
          const row = chat.messages?.find(item => item.role === 'assistant' && Number(item.turn) === Number(commit.turn))
          if (!row) throw new Error('本轮正文已被回退或删除，没有向 QQ 发送内容')
          const projection = view?.replyProjections?.find(item => Number(item.turn) === Number(commit.turn))
          const body = projection ? (projection.parts || []).filter(part => part.kind === 'markdown').map(part => part.text).join('\n') : row.text
          const reply = String(body || '').replace(/<(think|thinking|reasoning|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '').trim()
          if (!reply) throw new Error('本轮没有可发送的文字正文（HTML 面板不会发送到 QQ）')
          return { text: reply, turn: commit.turn, requestId }
        }
        await wait(pollMs, undefined, { signal })
      }
      throw new Error('等待 Tavern 回复超时，请在电脑端检查；不会自动重发输入')
    } finally { locks.delete(binding.sessionId) }
  } }
}
