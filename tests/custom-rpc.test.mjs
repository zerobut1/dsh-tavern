import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'
import { createResourceHandlers } from '../tavern-plugin/lib/rpc/resources.js'
import { createTemplateHandlers } from '../tavern-plugin/lib/rpc/template.js'
import { createSettlementControls } from '../tavern-plugin/lib/domain/settlement-controls.js'

test('拆分后的游玩接口保留后台指令、子代理和姿势编辑', async () => {
  const command = { sessionId: 'session', instruction: '更新任务' }
  const posture = { sessionId: 'session', posture: '站立' }
  const chat = { id: 'chat', mvu: { enabled: true }, backgroundCommandTask: { status: 'completed' } }
  const handlers = createPlayHandlers({
    backgroundCommand: { start: async args => ({ task: args }), project: row => ({ task: row.backgroundCommandTask }) },
    chatHeaderForSession: async (id, fields) => {
      assert.deepEqual(fields, ['id', 'mvu', 'backgroundCommandTask'])
      return id === 'session' ? chat : undefined
    },
    listGameSubagents: async id => ({ sessionId: id, items: ['agent'] }),
    closeGameSubagents: async (id, ids) => ({ sessionId: id, closed: ids }),
    savePosture: async args => ({ saved: args })
  })
  assert.deepEqual(await handlers.startBackgroundCommand(command), { task: command })
  assert.deepEqual(await handlers.getBackgroundCommand({ sessionId: 'session' }), { task: chat.backgroundCommandTask })
  await assert.rejects(handlers.getBackgroundCommand({ sessionId: 'missing' }), /对话不存在/)
  assert.deepEqual(await handlers.listGameSubagents({ sessionId: 'session' }), { sessionId: 'session', items: ['agent'] })
  assert.deepEqual(await handlers.closeGameSubagents({ sessionId: 'session', ids: ['agent'] }), { sessionId: 'session', closed: ['agent'] })
  assert.deepEqual(await handlers.savePosture(posture), { saved: posture })
})

test('资源接口保留预设增删，并将全局正则变化通知所有会话', async () => {
  let items = []
  const signals = []
  const handlers = createResourceHandlers({
    presetLibrary: {
      addEntry: async (...args) => ({ added: args }),
      deleteEntry: async (...args) => ({ deleted: args })
    },
    tavernExtensionSettings: { listRegex: async () => items, updateRegex: async value => (items = value.items) },
    readSessionMap: async () => ({ first: 'chat1', second: 'chat2' }),
    profileData: { version: async name => { assert.equal(name, 'tavern-extension-settings.json'); return 7 } },
    sessionSignals: { publish: (id, event) => signals.push({ id, event }) }
  })
  assert.deepEqual(await handlers.addPresetEntry({ path: 'preset', phase: 'before', revision: 3 }), { added: ['preset', 'before', 3] })
  assert.deepEqual(await handlers.deletePresetEntry({ path: 'preset', entryKey: 'entry', revision: 4 }), { preset: { deleted: ['preset', 'entry', 4] } })
  assert.deepEqual(await handlers.updateGlobalRegex({ items: [{ id: 'rule', enabled: true }] }), { items: [{ id: 'rule', enabled: true }] })
  assert.deepEqual(await handlers.listGlobalRegex(), { items })
  assert.deepEqual(signals, ['first', 'second'].map(id => ({ id, event: { kind: 'tavern-state', version: 'extension-settings:7' } })))
})

test('模板接口将创建独立世界书的结果返回酒馆助手', async () => {
  const handlers = createTemplateHandlers({ tavernScriptHostAdapter: {
    createWorldbook: async (sessionId, name) => { assert.equal(sessionId, 'session'); return name === '新世界书' }
  } })
  assert.equal(await handlers.createTavernHelperWorldbook({ sessionId: 'session', name: '新世界书' }), true)
})

test('停止后台结算同时取消手动后台指令，过期操作不能取消新任务', async () => {
  const events = []
  const chat = { id: 'chat', sessionId: 'session' }
  const { stopBackground } = createSettlementControls({
    chatForSession: async () => chat,
    backgroundTasks: {
      activity: () => ({ busy: true, operationId: 'operation' }),
      recover: async row => { events.push('recover'); return { chat: { ...row, stopped: true } } }
    },
    pluginApi: { stopTasks: id => events.push(['plugin', id]) },
    backgroundCommand: { stop: id => events.push(['command', id]) },
    backgroundAgentRunner: { cancel: id => events.push(['agent', id]) },
    cancelSettlement: async (id, options) => events.push(['settlement', id, options]),
    readChatCard: async () => ({}), view: async row => row
  })
  assert.deepEqual(await stopBackground('session', 'old-operation'), chat)
  assert.deepEqual(events, [])
  assert.equal((await stopBackground('session', 'operation')).stopped, true)
  assert.deepEqual(events, [
    ['plugin', 'session'], ['command', 'chat'], ['agent', 'session'],
    ['settlement', 'chat', { wait: false }], 'recover'
  ])
})
