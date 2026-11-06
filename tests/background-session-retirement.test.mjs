import test from 'node:test'
import assert from 'node:assert/strict'

import { createBackgroundSessionRetirement, subagentCloseDecision } from '../tavern-plugin/lib/domain/background-session-retirement.js'

test('只允许关闭本局闲置且没有下级的子代理', () => {
  assert.equal(subagentCloseDecision({ owned: true }).closeable, true)
  for (const input of [{}, { owned: false }, { owned: true, running: true }, { owned: true, hasChildren: true }]) {
    const decision = subagentCloseDecision(input)
    assert.equal(decision.closeable, false)
    assert.ok(decision.reason)
  }
})

test('停用记录按父对话读取，隐藏闲置诊断但保留当前运行实例', async () => {
  const saved = { old: { parentId: 'game' }, live: { parentId: 'game' }, other: { parentId: 'another' } }
  const api = createBackgroundSessionRetirement({ readJson: async () => saved }, { isRunning: id => id === 'live' })
  assert.deepEqual(await api.retiredIds('game'), ['old', 'live'])
  const rows = ['old', 'live', 'other'].map(id => ({ id, kind: 'diagnostic', parentId: 'game', activity: 'running' }))
  assert.deepEqual(await api.filter(rows), rows.slice(1))
})
