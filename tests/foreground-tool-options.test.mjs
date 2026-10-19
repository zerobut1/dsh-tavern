import assert from 'node:assert/strict'
import test from 'node:test'
import { createNativePlayOrchestrationStrategy } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'

for (const global of [false, true]) for (const local of [undefined, false, true]) {
  test(`历史工具回放的单局设置优先于全局（全局=${global}，单局=${local}）`, async () => {
    let globalReads = 0
    const strategy = createNativePlayOrchestrationStrategy({
      modeFor: async () => 'story', filterMessages: value => value, resolvePreset: async () => null,
      prepareTurn: async () => ({ frame: { userInput: { projectedText: '当前输入' } } }),
      appendFrame: ({ messages }) => ({ messages, receipt: {} }), recordFrame() {},
      historyToolCall: async () => { globalReads++; return global }
    })
    const chat = { mode: 'story', ...(local === undefined ? {} : { storyHistoryToolCall: local }), storyToolCall: !global }
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '之前输入' }], source: { kind: 'user' } },
      { role: 'assistant', id: 'old', content: [{ type: 'text', text: '之前正文' }], source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' } },
      { role: 'user', content: [{ type: 'text', text: '当前输入' }], source: { kind: 'user' } }
    ]
    const before = structuredClone(messages)
    await strategy.prepareStep({ sessionId: 'session', chat, payload: { turn: 2, step: 1, messages }, decision: { kind: 'enter', messages } })
    const result = strategy.projectRequest({ sessionId: 'session', system: '', messages })
    if (local ?? global) {
      assert.deepEqual(result.messages.map(row => row.role), ['assistant', 'tool', 'assistant', 'tool', 'user'])
      assert.equal(result.messages[2].content[0].name, 'submit_story')
      assert.deepEqual(JSON.parse(result.messages[2].content[0].arguments), { content: '之前正文' })
      assert.deepEqual(result.messages.at(-1), messages.at(-1))
    } else assert.deepEqual(result?.messages ?? messages, messages, '关闭回放时保留原始消息角色与正文')
    assert.equal(globalReads, local === undefined ? 1 : 0)
    assert.deepEqual(messages, before)
  })
}
