import assert from 'node:assert/strict'
import test from 'node:test'
import { createNativePlayOrchestrationStrategy } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { storyToolCallEnabled } from '../tavern-plugin/lib/domain/story-tool-submission.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'

const choices = [
  ['跟随全局', {}, undefined], ['关闭', { storyToolCall: false }, false], ['开启', { storyToolCall: true }, true],
  ['旧历史关闭', { storyHistoryToolCall: false }, false], ['旧历史开启', { storyHistoryToolCall: true }, true],
  ['旧正文关闭历史开启', { storyToolCall: false, storyHistoryToolCall: true }, true],
  ['旧正文开启历史关闭', { storyToolCall: true, storyHistoryToolCall: false }, true]
]
for (const global of [false, true]) for (const [name, flags, local] of choices) {
  test(`正文提交与历史回放使用同一个单局开关（全局=${global}，单局=${name}）`, async () => {
    let globalReads = 0
    const strategy = createNativePlayOrchestrationStrategy({
      modeFor: async () => 'story', filterMessages: value => value, resolvePreset: async () => null,
      prepareTurn: async () => ({ frame: { userInput: { projectedText: '当前输入' } } }),
      appendFrame: ({ messages }) => ({ messages, receipt: {} }), recordFrame() {},
      storyOutputToolCall: async () => global,
      historyToolCall: async () => { globalReads++; return global }
    })
    const chat = { mode: 'story', ...flags }
    assert.equal(storyToolCallEnabled(chat, global), local ?? global)
    const orchestrator = createTurnOrchestrator({
      frameBuilder: { build() {} }, storyToolCall: async () => global,
      store: { headerForSession: async (_id, fields) => Object.fromEntries(fields
        .filter(field => Object.hasOwn(chat, field)).map(field => [field, chat[field]])) }
    })
    assert.equal((await orchestrator.visibleTools('session')).includes('submit_story'), local ?? global,
      '按需读取也必须保留本局选择，使可用工具与历史回放一致')
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '之前输入' }], source: { kind: 'user' } },
      { role: 'assistant', id: 'old', content: [{ type: 'text', text: '之前正文' }], source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' } },
      { role: 'user', content: [{ type: 'text', text: '当前输入' }], source: { kind: 'user' } }
    ]
    const before = structuredClone(messages)
    await strategy.prepareStep({ sessionId: 'session', chat, payload: { turn: 2, step: 1, messages }, decision: { kind: 'enter', messages } })
    const result = strategy.projectRequest({ sessionId: 'session', system: '', messages })
    if (local ?? global) {
      assert.deepEqual(result.messages.map(row => row.role), ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'user'])
      assert.equal(result.messages[3].content[0].name, 'submit_story')
      assert.deepEqual(JSON.parse(result.messages[3].content[0].arguments), { content: '之前正文' })
      assert.deepEqual(result.messages.at(-1), messages.at(-1))
    } else assert.deepEqual(result?.messages ?? messages, messages, '关闭回放时保留原始消息角色与正文')
    assert.equal(globalReads, local === undefined ? 1 : 0)
    assert.deepEqual(messages, before)
  })
}

// Only mixed global choices are new; the existing matrix covers uniform defaults.
test('两个全局开关独立生效，本局覆盖同时控制历史、确认消息和输出协议', async () => {
  for (const [input, output] of [[true, false], [false, true]]) for (const local of [null, false, true]) {
    const stagedRequests = new Map()
    const chat = { mode: 'story', ...(local === null ? {} : { storyToolCall: local }) }
    const offered = local ?? (input || output)
    const strategy = createNativePlayOrchestrationStrategy({
      stagedRequests, modeFor: async () => 'story', filterMessages: value => value, resolvePreset: async () => null,
      historyToolCall: async () => input, storyOutputToolCall: async () => output,
      visibleTools: async () => offered ? ['submit_story'] : [], controlledToolNames: new Set(['submit_story'])
    })
    await strategy.prepareStep({ sessionId: 'game', chat, payload: { turn: 2, step: 2 }, decision: { messages: [] } })
    assert.equal(stagedRequests.get('game').historyToolCall, local ?? input)
    assert.equal(stagedRequests.get('game').storyOutputToolCall, local ?? output)
    const assembled = await strategy.assembleSystemPrompt({ tools: [{ name: 'submit_story' }] }, { sessionId: 'game', chat })
    const policy = assembled.sections.find(section => section.name === 'tavern:story-tool-submission')
    if (offered) assert.match(policy.text, (local ?? output) ? /本轮所有面向玩家的输出/ : /本轮请直接输出正文/)
    else assert.equal(policy, undefined)
  }
})
