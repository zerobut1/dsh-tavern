import { randomUUID } from 'node:crypto'
import { QQ_BRIDGE_STATE } from './qq-bridge-config.js'

export function privateQqText(event, config, since, now = Date.now()) {
  if (event?.post_type !== 'message' || event.message_type !== 'private' || event.sub_type !== 'friend' || event.group_id != null) return null
  const userId = String(event.user_id ?? '')
  if (String(event.self_id) !== config.botQq || userId === config.botQq || !config.allowedUserIds.includes(userId)) return null
  if (event.sender?.user_id != null && String(event.sender.user_id) !== userId) return null
  if (!Number.isFinite(event.time) || event.time < Math.floor(since / 1000) || event.time > Math.floor(now / 1000) + 60) return null
  if (!/^-?\d+$/.test(String(event.message_id ?? ''))) return null
  // Require NapCat's array format and reject mixed media, forwarded messages,
  // CQ-code strings, group-temporary chats and sent-message reports entirely.
  if (!Array.isArray(event.message) || !event.message.length || event.message.some(part => part?.type !== 'text' || typeof part.data?.text !== 'string')) return null
  const text = event.message.map(part => part.data.text).join('').trim()
  return text && text.length <= 10000 ? { userId, text, key: `${config.botQq}:${userId}:${event.message_id}` } : null
}

export function splitQqReply(text, limit = 1500) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('QQ 消息长度限制必须为正整数')
  const parts = []
  // A blank line separates chat bubbles; a single newline stays inside its
  // paragraph (lists, quoted text, etc.). Validate the entire reply before any
  // send so an excessive paragraph count cannot produce a partial flood.
  const paragraphs = String(text).replace(/\r\n?/g, '\n').split(/\n(?:[^\S\n]*\n)+/u)
  for (const paragraph of paragraphs) {
    const characters = Array.from(paragraph.trim())
    for (let i = 0; i < characters.length; i += limit) {
      parts.push(characters.slice(i, i + limit).join(''))
      if (parts.length > 20) throw new Error('回复超过 20 条消息或 30000 字，请在 Tavern 查看')
    }
  }
  return parts
}

// Every reply is a consequence of an admitted, whitelisted private message.
// No history replay, proactive delivery, model-provided recipients or group API.
export function createQqBridgeProcessor({ config, store, messenger, client, authorized, now = Date.now, onError = () => {} }) {
  const abort = new AbortController()
  let since = Infinity, epoch = 0, queue = Promise.resolve(), queued = 0, stopped = false
  async function process(input) {
    const active = async () => !stopped && input.epoch === epoch && await authorized(input.userId)
    if (!await active()) return
    let claimed = false
    const requestId = randomUUID()
    const state = await store.updateJson(QQ_BRIDGE_STATE, current => {
      current ||= { version: 1, receipts: {}, selected: {} }
      current.receipts ||= {}; current.selected ||= {}
      if (Object.hasOwn(current.receipts, input.key)) return undefined
      claimed = true
      current.receipts[input.key] = { at: now(), requestId, status: 'processing' }
      // Keep bounded durable deduplication, but never evict in-flight receipts.
      const entries = Object.entries(current.receipts).filter(([, row]) => row.status !== 'processing').sort((a, b) => b[1].at - a[1].at)
      for (const [key] of entries.slice(999)) delete current.receipts[key]
      return current
    })
    if (!claimed || !await active()) return
    async function finish(status) {
      await store.updateJson(QQ_BRIDGE_STATE, current => {
        if (current?.receipts?.[input.key]) current.receipts[input.key].status = status
        return current
      })
    }
    try {
      let text
      if (input.text === '/角色') text = '可用角色：\n' + config.bindings.map(binding => binding.name).join('\n') + '\n使用 /切换 名称 切换对话'
      else if (input.text.startsWith('/切换 ')) {
        const name = input.text.slice(4).trim()
        const binding = config.bindings.find(item => item.name === name)
        if (binding) {
          await store.updateJson(QQ_BRIDGE_STATE, current => { current.selected[input.userId] = binding.name; return current })
          text = '已切换到：' + binding.name
        } else text = '没有这个角色，发送 /角色 查看可用名称'
      } else {
        const binding = config.bindings.find(item => item.name === state.selected[input.userId]) || config.bindings[0]
        const reply = await messenger.send(binding, input.text, { signal: abort.signal, requestId })
        text = reply.text
      }
      for (const part of splitQqReply(text)) {
        if (!await active() || !client.connected) { await finish('suppressed'); return }
        // Array segments prevent a generated [CQ:...] string from becoming an
        // image, mention, forwarded message or other active OneBot instruction.
        await client.call('send_private_msg', { user_id: Number(input.userId), message: [{ type: 'text', data: { text: part } }] })
      }
      await finish('replied')
    } catch (error) {
      await finish('failed')
      onError(error)
      // Do not forward internal errors (or retry possibly-delivered messages).
    }
  }
  return {
    ready(at = now()) { since = at; epoch++ },
    disconnected() { since = Infinity; epoch++ },
    handle(event) {
      if (stopped || !config.enabled || !client.connected) return Promise.resolve()
      const input = privateQqText(event, config, since, now())
      if (!input || queued >= 8) return Promise.resolve()
      queued++
      const inputEpoch = epoch
      const job = queue.then(() => process({ ...input, epoch: inputEpoch }))
      queue = job.catch(onError).finally(() => { queued-- })
      return queue
    },
    stop() { stopped = true; since = Infinity; abort.abort(new Error('QQ 桥接已停用')) },
    idle() { return queue },
  }
}
