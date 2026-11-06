import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettlementControls } from '../tavern-plugin/lib/domain/settlement-controls.js'

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
