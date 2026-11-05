import { createHash } from 'node:crypto'

// Stable identity in the existing message.id field: a retry after flush/crash
// can recognize its own greeting without another save-format field or event.
export function nativeOpeningMessageId(chatId) {
  return 'tavern-opening:' + createHash('sha256').update(chatId == null ? '' : String(chatId)).digest('hex')
}

// /sys creates a lasting narrator floor in ST. Keep its chronological place
// beside the greeting, including old saves whose /cut removed that greeting.
// Only the leading preparation floors belong to the reserved opening turn.
export function openingNarration(chat) {
  const rows = chat?.messages || [], indices = [], texts = []
  let narrator = false
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (!row || !(row.role === 'system' || row.role === 'assistant' && row.greeting === true)) break
    narrator ||= row.role === 'system'
    indices.push(index)
    texts.push(String(row.projectionText ?? row.sourceText ?? row.text ?? ''))
  }
  return narrator ? { text: texts.filter(Boolean).join('\n\n'), indices } : null
}
