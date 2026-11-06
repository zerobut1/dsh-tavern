import assert from 'node:assert/strict'
import test from 'node:test'
import { createNativePlayOrchestrationStrategy } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'

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
