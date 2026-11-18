import assert from 'node:assert/strict'
import test from 'node:test'
import { patchConversationBackground } from '../tavern-plugin/lib/domain/conversation-background.js'
import { storyToolCallEnabled, storyToolCallSelection } from '../tavern-plugin/lib/domain/story-tool-submission.js'

for (const key of ['storyToolCall', 'storyHistoryToolCall']) {
  test(`单局 ${key} 写入统一开关并清理旧字段，不修改来源存档`, () => {
    const chat = { id: 'c', backgroundConfigVersion: 1, storyToolCall: false, storyHistoryToolCall: true }
    const before = structuredClone(chat)
    const enabled = patchConversationBackground(chat, { [key]: true })
    assert.equal(enabled.storyToolCall, true)
    assert.equal(Object.hasOwn(enabled, 'storyHistoryToolCall'), false)
    assert.equal(patchConversationBackground(chat, { [key]: false }).storyToolCall, false)
    assert.equal(storyToolCallEnabled(patchConversationBackground(chat, { [key]: false }), true), false)
    assert.equal(patchConversationBackground(enabled, { webSearchEnabled: true }).storyToolCall, true)
    const reset = patchConversationBackground(chat, { [key]: null })
    assert.equal(Object.hasOwn(reset, 'storyToolCall'), false)
    assert.equal(Object.hasOwn(reset, 'storyHistoryToolCall'), false)
    for (const global of [false, true]) assert.equal(storyToolCallEnabled(reset, global), global)
    for (const value of ['true', 1, {}, []]) assert.throws(() => patchConversationBackground(chat, { [key]: value }), /布尔值/)
    assert.deepEqual(chat, before)
  })
}

test('旧存档的两个开关按任一开启合并，未设置时仍跟随全局', () => {
  for (const [flags, selected] of [
    [{}, null], [{ storyToolCall: false }, false], [{ storyToolCall: true }, true],
    [{ storyHistoryToolCall: false }, false], [{ storyHistoryToolCall: true }, true],
    [{ storyToolCall: false, storyHistoryToolCall: false }, false],
    [{ storyToolCall: true, storyHistoryToolCall: false }, true],
    [{ storyToolCall: false, storyHistoryToolCall: true }, true],
    [{ storyToolCall: true, storyHistoryToolCall: true }, true]
  ]) {
    const before = structuredClone(flags)
    assert.equal(storyToolCallSelection(flags), selected)
    for (const global of [false, true]) assert.equal(storyToolCallEnabled({ mode: 'story', ...flags }, global), selected ?? global)
    assert.deepEqual(flags, before)
  }
  assert.equal(patchConversationBackground({ storyHistoryToolCall: true }, { storyToolCall: false, storyHistoryToolCall: true }).storyToolCall, false)
})

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
