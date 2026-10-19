import assert from 'node:assert/strict'
import test from 'node:test'
import { hasWorldbookStateReads, worldbookPlacement } from '../tavern-plugin/lib/domain/worldbook-placement.js'

test('读取消息变量的常驻世界书留在动态部分，固定人物背景仍可缓存', () => {
  const entries = [
    { ref: 'fixed', enabled: true, constant: true, content: '固定人物背景' },
    { ref: 'formatted', enabled: true, constant: true, content: '{{format_message_variable::stat_data}}' },
    { ref: 'value', enabled: true, constant: true, content: '{{get_message_variable::stat_data.hp}}' },
    { ref: 'script', enabled: true, constant: true, content: '<%= getvar("hp") %>' },
    { ref: 'disabled', enabled: false, constant: true, content: '{{lastmessage}}' }
  ]
  const result = worldbookPlacement(entries)
  assert.deepEqual([...result.prefixRefs], ['fixed'])
  assert.deepEqual([...result.foregroundRefs].sort(), ['formatted', 'script', 'value'])
  for (const value of ['{{ format_message_variable::stat_data }}', '{{GET_MESSAGE_VARIABLE::hp}}', '{{lastmessage}}']) {
    assert.equal(hasWorldbookStateReads(value), true)
  }
  assert.equal(hasWorldbookStateReads('fixed stat_data background'), false)
})

test('变量条目的跨条目包裹标签同时保留在固定和动态部分', () => {
  const entries = [
    { ref: 'start', constant: true, content: '<world>', order: 1 },
    { ref: 'fixed', constant: true, content: '固定设定', order: 2 },
    { ref: 'changing', constant: true, content: '{{format_message_variable::stat_data}}', order: 3 },
    { ref: 'end', constant: true, content: '</world>', order: 4 }
  ]
  const result = worldbookPlacement(entries)
  assert.deepEqual([...result.prefixRefs].sort(), ['end', 'fixed', 'start'])
  assert.deepEqual([...result.foregroundRefs].sort(), ['changing', 'end', 'start'])
})
