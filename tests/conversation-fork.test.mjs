import assert from 'node:assert/strict'
import test from 'node:test'
import { assertConversationExportable, assertConversationForkable, forkConversationChat } from '../tavern-plugin/lib/domain/conversation-fork.js'

function sourceChat() {
  return {
    id: 'chat-source', sessionId: 'session-source', cardPath: 'cards/a.json', cardName: '阿青', mode: 'story',
    _storageRevision: 17, createdAt: 1, updatedAt: 2, settleStatus: 'done', settleError: null,
    messages: [
      { role: 'assistant', greeting: true, turn: 1, text: '开场' },
      { role: 'user', text: '进门' },
      { role: 'assistant', turn: 2, text: '她抬起头。', variables: [{ hp: 9 }] }
    ],
    posture: '门内', worldBookReads: { gate: 2 }, tavernPluginData: { phone: { chats: ['保留'] } },
    candidates: { items: ['旧候选'] }, candidateAgent: { sessionId: 'background-old' },
    nativeCommits: { 2: { old: true } }, suppressedDshTurns: [9], regeneratedDshTurns: { 2: 9 },
    timeline: {
      schemaVersion: 1, branchId: 'branch-source', revision: 4,
      checkpoints: [{ id: 'checkpoint-4', beforeRevision: 12 }],
      participants: { background: { sessionId: 'background-old', lifetime: 'chat' } },
      operations: { completed: { id: 'completed', kind: 'body', status: 'completed' } }
    }
  }
}

test('分叉只接受没有前台或后台未完成工作的游玩对话', () => {
  assert.equal(assertConversationForkable(sourceChat()), true)
  assert.throws(() => assertConversationForkable({ ...sourceChat(), mode: 'card' }), /只有游玩对话/)
  assert.throws(() => assertConversationForkable(sourceChat(), { agentRunning: true }), /正文仍在生成/)
  const settling = sourceChat()
  settling.timeline.operations.running = { kind: 'body', status: 'completed', background: { phase: 'pending' } }
  assert.throws(() => assertConversationForkable(settling), /状态结算/)
  assert.throws(() => assertConversationForkable({
    ...sourceChat(),
    mvu: { enabled: true, openingInitialization: { status: 'pending' } }
  }), /MVU 开局状态尚未初始化完成/)
  const dangling = sourceChat()
  dangling.messages.push({ role: 'user', text: '未完成' })
  assert.throws(() => assertConversationForkable(dangling), /尚未产生正文/)
})

test('导出检查真实结算任务和时间线，允许遗留的结算标记', () => {
  const chat = { ...sourceChat(), settleStatus: 'pending' }
  assert.doesNotThrow(() => assertConversationExportable(chat))
  assert.throws(() => assertConversationForkable(chat), /尚未完成状态结算/)
  assert.throws(() => assertConversationExportable(chat, { settlementRunning: true }), /尚未完成状态结算/)
  chat.timeline.operations.completed.background = { phase: 'pending' }
  assert.throws(() => assertConversationExportable(chat), /尚未完成生成或状态结算/)
})

test('分叉合并旧工具开关，历史分叉继承来源对话当前的统一选择', () => {
  const source = { ...sourceChat(), storyToolCall: false, storyHistoryToolCall: true }
  const before = structuredClone(source)
  const options = { chatId: 'fork', sessionId: 'fork', id: prefix => prefix + '-x' }
  const inherited = forkConversationChat(source, options)
  assert.equal(inherited.storyToolCall, true)
  assert.equal(Object.hasOwn(inherited, 'storyHistoryToolCall'), false)
  for (const selected of [false, true, null]) {
    const fork = forkConversationChat(source, { ...options, storyToolCall: selected })
    assert.equal(fork.storyToolCall, selected ?? undefined)
    assert.equal(Object.hasOwn(fork, 'storyHistoryToolCall'), false)
  }
  assert.deepEqual(source, before)
})
