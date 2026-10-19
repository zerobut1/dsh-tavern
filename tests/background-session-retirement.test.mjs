import test from 'node:test'
import assert from 'node:assert/strict'

import { createBackgroundSessionRetirement, installRetiredCatalogView, subagentCloseDecision, installRetiredBackgroundFilter } from '../tavern-plugin/lib/domain/background-session-retirement.js'

test('旧版本失败记录仅在被新会话替代后折叠，回退到旧参与者时恢复可见',async()=>{
  const chat={timeline:{participants:{background:{sessionId:'new'}},operations:{a:{kind:'agent',status:'failed',startedSessionId:'old'},b:{kind:'agent',status:'running',startedSessionId:'busy'}}}}
  const retirement=createBackgroundSessionRetirement({readJson:async()=>undefined},{readState:async()=>chat})
  const rows=['old','new','busy','unrelated'].map(id=>({kind:'child',id,label:'酒馆后台 Agent',activity:'inactive'}))
  assert.deepEqual((await retirement.filter(rows,'parent')).map(row=>row.id),['new','busy','unrelated'])
  chat.timeline.participants.background.sessionId='old'
  assert.equal((await retirement.filter(rows,'parent')).length,4)
})

// Public summaries also feed the native header count. Keep ancestors and live
// workers discoverable even when their retirement record already exists.

// DSH 0.2 reads the header count and popup from the subagentCatalog projection view.
test('子智能体目录投影：已退休的后台 Agent 不再列出，运行中的照常显示；先登记或后登记都生效', async () => {
  let saved = { gone: { parentId: 'game' } }
  const store = { readJson: async () => saved, updateJson: async (_path, update) => { saved = update(saved) } }
  const retirement = createBackgroundSessionRetirement(store)
  await retirement.load()
  const rows = ['gone', 'busy', 'current'].map(id => ({ id, createdAt: 1, mode: 'continuable', label: '酒馆后台 Agent' }))
  const view = () => rows
  const running = new Set()
  const options = { isRunning: id => running.has(id) }

  const registered = { registrations: new Map([['subagentCatalog', { def: { wire: { view } } }]]) }
  const undo = installRetiredCatalogView(registered, retirement, options)
  const read = () => registered.registrations.get('subagentCatalog').def.wire.view({}).map(row => row.id)
  assert.deepEqual(read(), ['busy', 'current'])
  await retirement.retire('busy', 'game')
  assert.deepEqual(read(), ['current'])
  running.add('busy')
  assert.deepEqual(read(), ['busy', 'current'], 'a running worker is never hidden')
  undo()
  assert.deepEqual(read(), ['gone', 'busy', 'current'])

  const definitions = []
  const later = { registrations: new Map(), register(definition) { definitions.push(definition) } }
  installRetiredCatalogView(later, retirement, options)
  later.register({ key: 'other', wire: { view } })
  later.register({ key: 'subagentCatalog', wire: { view } })
  assert.equal(definitions[0].wire.view({}).length, 3, 'other projections are left alone')
  assert.deepEqual(definitions[1].wire.view({}).map(row => row.id), ['busy', 'current'])
})

function memoryStore() {
  let data
  return { readJson: async () => structuredClone(data), updateJson: async (_path, update) => { data = update(data) } }
}

test('只允许关闭本局闲置且没有下级的子代理', () => {
  assert.equal(subagentCloseDecision({ owned: true }).closeable, true)
  for (const input of [{}, { owned: false }, { owned: true, running: true }, { owned: true, hasChildren: true }]) {
    const decision = subagentCloseDecision(input)
    assert.equal(decision.closeable, false)
    assert.ok(decision.reason)
  }
})

test('关闭记录跨实例生效，只隐藏对应父对话的闲置子代理，保留祖先和活动会话', async () => {
  const store = memoryStore()
  const retirement = createBackgroundSessionRetirement(store)
  await assert.rejects(retirement.retire('', 'parent'), /缺少/)
  for (const id of ['old', 'busy', 'ancestor']) await retirement.retire(id, 'parent')
  const restored = createBackgroundSessionRetirement(store)
  assert.equal(await restored.isRetired('old'), true)
  assert.equal(await restored.isRetired('other'), false)
  assert.deepEqual(await restored.retiredIds('parent'), ['old', 'busy', 'ancestor'])
  assert.deepEqual(await restored.retiredIds('other-parent'), [])
  const rows = [
    { id: 'old', kind: 'child', parentId: 'parent' },
    { id: 'old', kind: 'diagnostic', parentId: 'parent' },
    { id: 'old', kind: 'child', parentId: 'unrelated' },
    { id: 'old', kind: 'session' },
    { id: 'busy', kind: 'child', activity: 'running', parentId: 'parent' },
    { id: 'ancestor', kind: 'child', hasChildren: true, parentId: 'parent' }
  ]
  const before = structuredClone(rows)
  assert.deepEqual(await restored.filter(rows), rows.slice(2))
  assert.deepEqual(rows, before, '不修改目录记录或原生日志')
  const active = createBackgroundSessionRetirement(store, { isRunning: id => id === 'old' })
  assert.equal((await active.filter(rows)).length, 5, '运行状态查询优先于旧目录状态')
})

test('原生子代理目录与全局页头使用一致过滤，卸载时还原原方法', async () => {
  const retirement = createBackgroundSessionRetirement(memoryStore())
  await retirement.retire('old', 'parent')
  const children = [{ id: 'old' }, { id: 'new' }]
  const subagents = {
    async listChildren(parent, signal) { assert.equal(this, subagents); assert.equal(parent, 'parent'); signal.throwIfAborted(); return children },
    async listDescendants(parent, signal) { return this.listChildren(parent, signal) }
  }
  const sessionQuery = { async listSessions() { assert.equal(this, sessionQuery); return [
    { header: { id: 'old', origin: 'subagent', parentSession: 'parent' } },
    { header: { id: 'new', origin: 'subagent', parentSession: 'parent' } },
    { header: { id: 'parent' } }
  ] } }
  const originalChildren = subagents.listChildren, originalSessions = sessionQuery.listSessions
  const dispose = installRetiredBackgroundFilter(subagents, retirement, sessionQuery)
  const signal = new AbortController().signal
  assert.deepEqual(await subagents.listChildren('parent', signal), [children[1]])
  assert.deepEqual(await subagents.listDescendants('parent', signal), [children[1]])
  assert.deepEqual((await sessionQuery.listSessions(signal)).map(row => row.header.id), ['new', 'parent'])
  await assert.rejects(subagents.listChildren('parent', AbortSignal.abort()))
  dispose(); dispose()
  assert.equal(subagents.listChildren, originalChildren)
  assert.equal(sessionQuery.listSessions, originalSessions)
  assert.deepEqual(await subagents.listChildren('parent', signal), children)
})
