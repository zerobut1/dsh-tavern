import assert from 'node:assert/strict'
import test from 'node:test'
import { createPostureEditor } from '../tavern-plugin/lib/domain/posture-editor.js'
import { postureForContext } from '../tavern-plugin/lib/domain/posture-context.js'

function harness() {
  let chat = { id: 'c', sessionId: 's', mode: 'story', posture: '她站在窗边。', backgroundTasks: { posture: true }, variables: { hp: 9 }, messages: [{ role: 'assistant', text: '既有正文' }] }
  let busy = false, beforeUpdate = () => {}
  const writes = []
  const save = createPostureEditor({
    readChat: async () => structuredClone(chat),
    updateChat: async (id, mutate, metadata) => { assert.equal(id, 'c'); beforeUpdate(); chat = await mutate(structuredClone(chat)); writes.push(metadata); return chat },
    isBusy: async () => busy
  })
  return { save, writes, get chat() { return chat }, set chat(value) { chat = value }, set busy(value) { busy = value }, set beforeUpdate(value) { beforeUpdate = value } }
}

test('手动保存人物姿势进入后续上下文，不改写正文、变量和后台开关，允许清空', async () => {
  const run = harness(), before = structuredClone(run.chat)
  assert.deepEqual(await run.save({ sessionId: 's', posture: ' 她坐在椅子上。 ', expectedPosture: before.posture }), { posture: '她坐在椅子上。' })
  assert.equal(postureForContext(run.chat), '她坐在椅子上。')
  assert.deepEqual(run.chat, { ...before, posture: '她坐在椅子上。' })
  assert.deepEqual(run.writes, [{ source: 'posture.edit' }])
  await run.save({ sessionId: 's', posture: '', expectedPosture: run.chat.posture })
  assert.equal(postureForContext(run.chat), '')
})

test('后台更新或任务启动后拒绝旧草稿，输入及会话类型不正确时不保存', async () => {
  const run = harness(), expected = run.chat.posture
  run.beforeUpdate = () => { run.chat.posture = '后台已更新。' }
  await assert.rejects(run.save({ sessionId: 's', posture: '旧草稿', expectedPosture: expected }), /已更新/)
  assert.equal(run.chat.posture, '后台已更新。')
  run.beforeUpdate = () => { run.busy = true }
  await assert.rejects(run.save({ sessionId: 's', posture: '新草稿', expectedPosture: run.chat.posture }), /等待/)
  assert.equal(run.writes.length, 0)
  await assert.rejects(run.save({ sessionId: 's', posture: '缺少基线' }), /先读取/)
  run.chat.mode = 'card'
  await assert.rejects(run.save({ sessionId: 's', posture: '', expectedPosture: '' }), /游玩/)
  run.chat = null
  await assert.rejects(run.save({ sessionId: 's', posture: '', expectedPosture: '' }), /游玩/)
})

test('后台维护关闭时仍可编辑，保存不自动开启后台或注入已禁用状态', async () => {
  const run = harness()
  run.chat.backgroundTasks.posture = false
  await run.save({ sessionId: 's', posture: '手动记录。', expectedPosture: run.chat.posture })
  assert.equal(run.chat.posture, '手动记录。')
  assert.equal(run.chat.backgroundTasks.posture, false)
  assert.equal(postureForContext(run.chat), '')
})
