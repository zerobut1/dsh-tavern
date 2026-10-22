import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
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

const panelSource = await readFile(new URL('../tavern-plugin/src/client/features/posture-panel.js', import.meta.url), 'utf8')

test('人物姿势面板保留轮询期间的草稿，取消不保存，载入最新后按基线提交', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react'), { createRoot } = await import('react-dom/client')
  const calls = [], invalidations = []
  const Panel = new Function('React', 'rpc', 'liveTavernView', panelSource + ';return TavernPosturePanel')(React,
    async (...args) => { calls.push(args); return { posture: args[1].posture } }, { invalidate: id => invalidations.push(id) })
  const container = document.querySelector('#root'), root = createRoot(container)
  t.after(async () => { await React.act(() => root.unmount()); dom.window.close() })
  let props = { sessionId: 's', posture: '她站在窗边。', enabled: true, busy: false }
  const render = async patch => { props = { ...props, ...patch }; await React.act(() => root.render(React.createElement(Panel, { ...props, key: props.sessionId }))) }
  const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text)
  const click = async text => { await React.act(async () => { button(text).click() }) }
  async function type(text) {
    const node = container.querySelector('textarea')
    await React.act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(node, text)
      node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  await render()
  assert.match(container.textContent, /她站在窗边/)
  await click('编辑')
  await type('未保存的草稿')
  await render({ busy: true })
  assert.equal(container.querySelector('textarea').value, '未保存的草稿')
  assert.equal(button('保存').disabled, true)
  await click('取消')
  assert.equal(calls.length, 0)
  await render({ busy: false })
  await click('编辑')
  await type('保留我的修改')
  await render({ posture: '后台的新状态' })
  assert.equal(container.querySelector('textarea').value, '保留我的修改')
  assert.equal(button('保存').disabled, true)
  assert.match(container.querySelector('[role="alert"]').textContent, /草稿已保留/)
  await click('载入最新')
  assert.equal(container.querySelector('textarea').value, '后台的新状态')
  await type('手动确认的状态')
  await click('保存')
  assert.deepEqual(calls, [['savePosture', { posture: '手动确认的状态', expectedPosture: '后台的新状态' }, 's']])
  assert.deepEqual(invalidations, ['s'])
  assert.equal(container.querySelector('textarea'), null)
})
