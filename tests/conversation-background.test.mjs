import assert from 'node:assert/strict'
import test from 'node:test'
import { patchConversationBackground } from '../tavern-plugin/lib/domain/conversation-background.js'
import { storyToolCallEnabled } from '../tavern-plugin/lib/domain/story-tool-submission.js'

for (const key of ['storyToolCall', 'storyHistoryToolCall']) {
  test(`单局 ${key} 支持开关与跟随全局，修改不污染另一项或来源存档`, () => {
    const other = key === 'storyToolCall' ? 'storyHistoryToolCall' : 'storyToolCall'
    const chat = { id: 'c', backgroundConfigVersion: 1, [other]: false }
    const before = structuredClone(chat)
    const enabled = patchConversationBackground(chat, { [key]: true })
    assert.equal(enabled[key], true)
    assert.equal(enabled[other], false)
    assert.equal(patchConversationBackground(enabled, { [key]: false })[key], false)
    assert.equal(patchConversationBackground(enabled, { webSearchEnabled: true })[key], true)
    assert.equal(Object.hasOwn(patchConversationBackground(enabled, { [key]: null }), key), false)
    for (const value of ['true', 1, {}, []]) assert.throws(() => patchConversationBackground(chat, { [key]: value }), /布尔值/)
    assert.deepEqual(chat, before)
  })
}

test('正文工具调用优先使用单局布尔值，缺省跟随全局且只对游玩模式生效', () => {
  for (const mode of [undefined, 'story', 'script']) {
    assert.equal(storyToolCallEnabled({ mode, storyToolCall: false }, true), false)
    assert.equal(storyToolCallEnabled({ mode, storyToolCall: true }, false), true)
    assert.equal(storyToolCallEnabled({ mode }, true), true)
    assert.equal(storyToolCallEnabled({ mode }, false), false)
  }
  assert.equal(storyToolCallEnabled({ mode: 'card', storyToolCall: true }, true), false)
  assert.equal(storyToolCallEnabled(null, true), false)
})
