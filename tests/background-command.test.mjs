import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createBackgroundCommand } from '../tavern-plugin/lib/domain/background-command.js'
import { createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'

test('输入区按钮打开指令小窗口，并将输入交给后台接口', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
  const component = source.slice(source.indexOf('function TavernBackgroundCommandAction('), source.indexOf('function CandidateDockActions('))
  let dialog, saved, invalidated = false
  const render = vm.runInNewContext('(' + component.trim() + ')', {
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }),
      useState: () => [{ status: 'idle', available: true }, () => {}], useEffect: () => {} },
    useTavernCoordination: () => ({ view: { activity: { busy: false } } }), describeTavernActivity: value => value,
    askTavernText: async input => { dialog = input },
    rpc: async (method, args, sessionId) => { saved = { method, args, sessionId }; return { status: 'running' } },
    liveTavernView: { invalidate: () => { invalidated = true } }
  })
  const view = render({ sessionId: 's', running: false })
  const button = view.children[0]
  assert.equal(button.children[0], '后台指令')
  assert.equal(button.props.disabled, false)
  button.props.onClick()
  assert.equal(dialog.allowEmpty, false)
  assert.equal(dialog.maxLength, 4000)
  await dialog.onSubmit('生成奖池')
  assert.equal(saved.method, 'startBackgroundCommand')
  assert.equal(saved.args.instruction, '生成奖池')
  assert.equal(saved.sessionId, 's')
  assert.equal(invalidated, true)
})

function fixture(run) {
  let chat = { id: 'c', sessionId: 's', mvu: { enabled: true, owner: 'official' }, variables: {},
    messages: [{ role: 'assistant', text: '保留原正文', swipes: ['保留原正文'], swipeId: 0,
      variables: [{ stat_data: { 商城: { 在售: {} }, 积分: 20 }, schema: {} }] }] }
  const copy = () => structuredClone(chat)
  const updateChat = async (_id, fn) => { chat = fn(copy()); return copy() }
  const tasks = createBackgroundTaskCoordinator({ timeline: createStoryTimeline(),
    store: { readChat: async () => copy(), writeChat: async value => { chat = structuredClone(value) }, updateChat } })
  function result(input) {
    const before = copy(), after = copy()
    after.messages[0].variables[0].stat_data.商城.在售.药水 = { 描述: '恢复体力', 价格: 10, 库存: 2 }
    const effect = createMvuSettlementEffect({ ...input, before, after })
    return { effect, receipt: { status: 'updated', changes: [{ path: '/stat_data/商城/在售/药水' }] } }
  }
  const api = createBackgroundCommand({ store: { chatForSession: async () => copy(), updateChat },
    beginTask: value => tasks.begin(value, 'command'), selection: () => ({ provider: 'stub', model: 'stub' }),
    settle: input => run(input, result), prepare: async () => ({ storyText: '' }) })
  return { api, tasks, get: copy, edit: fn => fn(chat) }
}

test('后台指令使用当前快照和原生 MVU 工具提交，保留正文与未要求修改的变量', async () => {
  const run = fixture(async (input, result) => {
    assert.equal(input.currentVariables.stat_data.积分, 20)
    assert.equal(input.preserveForeground, true)
    const native = createMvuSettlementModule({
      model: { async run(request) {
        assert.equal(request.task, 'command')
        assert.equal(request.messages[0].role, 'user')
        assert.equal(request.messages[0].content[0].text, '上架药水，价格 10，库存 2')
        assert.match(request.system, /不是自动剧情结算/)
        assert.deepEqual(request.tools.map(tool => tool.name), ['mvu_submit_update'])
        await request.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [
          { op: 'insert', path: '/stat_data/商城/在售/药水', valueJson: '{"描述":"恢复体力","价格":10,"库存":2}' }
        ] } })
        return { traceSessionId: 'background', traceBoundary: 5 }
      } },
      runtime: { async settleMvuUpdate(request) {
        assert.equal(request.preserveForeground, true)
        const prepared = result(input)
        return { effect: prepared.effect, variables: { ...input.currentVariables, stat_data: { ...input.currentVariables.stat_data,
          商城: { 在售: { 药水: { 描述: '恢复体力', 价格: 10, 库存: 2 } } } } } }
      } }
    })
    return native.settleVariables(input)
  })
  await run.api.start({ sessionId: 's', instruction: '上架药水，价格 10，库存 2' })
  await run.api.wait('c')
  const chat = run.get()
  assert.equal(run.api.project(chat).status, 'done')
  assert.equal(chat.messages[0].variables[0].stat_data.商城.在售.药水.库存, 2)
  assert.equal(chat.messages[0].variables[0].stat_data.积分, 20)
  assert.equal(chat.messages[0].text, '保留原正文')
  assert.equal(chat.messages.length, 1)
  assert.equal(chat.timeline.participants.background.sessionId, 'background')
})

test('停止或 MVU 目标变化后拒绝迟到结果', async () => {
  for (const cancel of [true, false]) {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const run = fixture(async (input, result) => { const prepared = result(input); await gate; return prepared })
    await run.api.start({ sessionId: 's', instruction: '上架药水' })
    await assert.rejects(run.api.start({ sessionId: 's', instruction: '重复指令' }), /正在执行/)
    if (cancel) {
      run.api.stop('c')
      await run.tasks.recover(run.get(), { operationId: run.get().backgroundCommandTask.operationId })
    } else run.edit(chat => { chat.tavernHelperLifecycleRevision = 1 })
    release()
    await run.api.wait('c')
    assert.equal(run.get().backgroundCommandTask.status, 'failed')
    assert.deepEqual(run.get().messages[0].variables[0].stat_data.商城.在售, {})
  }
})

test('校验失败或执行器未就绪时保留变量并显示原因', async () => {
  for (const status of ['error', 'pending']) {
    const run = fixture(async () => ({ receipt: { status, summary: '人物卡约束拒绝更新' } }))
    await assert.rejects(run.api.start({ sessionId: 's', instruction: ' ' }), /请输入/)
    await run.api.start({ sessionId: 's', instruction: '上架药水' })
    await run.api.wait('c')
    const state = run.get().backgroundCommandTask
    assert.equal(state.status, 'failed')
    assert.match(state.error, status === 'pending' ? /执行器尚未就绪/ : /人物卡约束/)
    assert.deepEqual(run.get().messages[0].variables[0].stat_data.商城.在售, {})
  }
})
