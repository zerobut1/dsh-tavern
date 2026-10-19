import assert from 'node:assert/strict'
import test from 'node:test'

import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness({ work = async () => {}, flush = async () => {}, dispose = async () => {}, compactWork = async () => {}, needsNewBackgroundSession, resume, retirement } = {}) {
  const children = new Map(), starts = [], calls = [], disposals = [], tools = new Map()
  let seq = 0
  const runner = createBackgroundAgentRunner({ id: () => 'child-' + ++seq, flushSession: flush, needsNewBackgroundSession, retirement,
    compactAgent: async agent => { calls.push(['compact', agent.session.id]); await compactWork(); return { message: 'compacted' } },
    agents: {
      ...(resume ? { resume } : {}),
      get(id) { if (id.startsWith('game-')) return { id, session: { header: {} } } },
      async create(options) {
        calls.push(['create', options.sessionId])
        const activeTools = new Map(); tools.set(options.sessionId, activeTools)
        await options.setup({ systemPrompt: { section() {}, variable() {}, suppressRuntimeContext() {} },
          tools: { restrict() {}, register(definition) { activeTools.set(definition.name, definition); return () => activeTools.delete(definition.name) } }, on() {} })
        const session = { id: options.sessionId, header: options.meta, events: [], append(type, data) { this.events.push({ type, data }) } }
        let idle = Promise.resolve(), cancellation
        const child = { session,
          followup(message) {
            const call = { id: session.id, text: message.content[0].text, tools: [...activeTools.keys()] }; starts.push(call)
            cancellation = deferred()
            idle = Promise.race([work(call), cancellation.promise]).then(() => { session.append('assistant/message', { message: { content: [{ type: 'text', text: '完成 ' + starts.length }] } }) })
          },
          whenIdle: () => idle,
          cancel() { calls.push(['cancel', session.id]); cancellation?.resolve() }
        }
        children.set(session.id, child)
        return { agent: child, async dispose() { disposals.push(session.id); await dispose(session) } }
      }
    }
  })
  const input = (extra = {}) => ({ sessionId: 'game-a', task: 'candidate', persistent: true,
    selection: { provider: 'test', model: 'scripted' }, system: '任务规则', messages: [], tools: [], ...extra })
  return { runner, input, calls, starts, tools, children, disposals }
}

test('释放所有常驻会话时汇总错误并清空所有权，可重复释放', async () => {
  const h = harness({ dispose: async session => { if (session.id === 'child-1') throw new Error('dispose failure') } })
  await h.runner.run(h.input())
  await h.runner.run(h.input({ sessionId: 'game-b' }))
  await assert.rejects(h.runner.dispose(), AggregateError)
  assert.deepEqual(h.disposals.sort(), ['child-1', 'child-2'])
  assert.equal(h.runner.owns('child-1'), false); assert.equal(h.runner.owns('child-2'), false)
  assert.equal(h.runner.requestContext('child-2'), null)
  await h.runner.dispose()
  assert.equal(h.disposals.length, 2)
})

test('关闭闲置子代理先持久化停用，再释放实例；旧检查点不能复用上下文', async t => {
  const retired = new Map(), order = []
  const h = harness({
    retirement: {
      isRetired: async id => retired.has(id),
      retire: async (id, parent) => { order.push('persist'); retired.set(id, parent) }
    },
    dispose: async () => { order.push('dispose') },
    resume: async () => { assert.fail('已关闭的子代理不能 resume') }
  })
  t.after(() => h.runner.dispose())
  await h.runner.run(h.input())
  assert.equal(h.runner.owns('child-1'), true)
  const logs = structuredClone(h.children.get('child-1').session.events)
  await assert.rejects(h.runner.retire('child-1', 'game-b'), /不属于/)
  assert.equal(retired.size, 0)
  await h.runner.retire('child-1', 'game-a')
  assert.deepEqual(order, ['persist', 'dispose'])
  assert.equal(h.runner.owns('child-1'), false)
  assert.equal(h.runner.requestContext('child-1'), null)
  assert.deepEqual(h.children.get('child-1').session.events, logs, '关闭不删除或改写历史日志')
  await h.runner.run(h.input({ persistentSessionId: 'child-1', rewindTo: 0 }))
  assert.equal(h.starts.at(-1).id, 'child-2')
  assert.equal(retired.get('child-1'), 'game-a')
})

test('停用记录写入失败时保留常驻子代理，不能误报关闭成功', async t => {
  const h = harness({ retirement: { isRetired: async () => false, retire: async () => { throw new Error('存储失败') } } })
  t.after(() => h.runner.dispose())
  await h.runner.run(h.input())
  await assert.rejects(h.runner.retire('child-1', 'game-a'), /存储失败/)
  assert.equal(h.runner.owns('child-1'), true)
  assert.deepEqual(h.disposals, [])
  await h.runner.run(h.input())
  assert.deepEqual(h.starts.map(call => call.id), ['child-1', 'child-1'])
})

test('子代理正在执行时拒绝关闭，不写停用记录', async t => {
  const entered = deferred(), complete = deferred(), retired = []
  const h = harness({ work: async () => { entered.resolve(); await complete.promise },
    retirement: { isRetired: async () => false, retire: async id => { retired.push(id) } } })
  t.after(() => h.runner.dispose())
  const pending = h.runner.run(h.input())
  try {
    await entered.promise
    await assert.rejects(h.runner.retire('child-1', 'game-a'), /仍有任务|仍在运行/)
    assert.deepEqual(retired, [])
    assert.equal(h.runner.isActive('child-1'), true)
  } finally { complete.resolve(); await pending }
})
