import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/src/client/features/scene-images.js', import.meta.url), 'utf8')
const helpers = source.slice(0, source.indexOf('function useSceneImageRecord('))
const component = source.slice(source.indexOf('function SceneImageAction('), source.indexOf('function SceneImageGallery('))

// Isolate the component's event handlers with in-memory hooks and RPC. No DOM,
// browser, image provider or live session is involved.
function fixture() {
  const slots = [], effects = [], calls = [], errors = [], container = {}
  let cursor, dirty, pending, tree
  const props = { sessionId: 'session', turn: 2 }
  const record = { enabled: true, key: 'image-key', status: 'idle', versions: [] }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const id = cursor++
      if (!(id in slots)) slots[id] = initial
      return [slots[id], value => { if (!Object.is(slots[id], value)) { slots[id] = value; dirty = true } }]
    },
    useRef(initial) { const id = cursor++; return slots[id] ||= { current: initial } },
    useEffect(fn, deps) {
      const id = cursor++
      if (!effects[id] || deps.some((value, i) => !Object.is(value, effects[id][i]))) { effects[id] = deps; pending.push(fn) }
    }
  }
  const ctx = vm.createContext({ React, DshUi: { Tooltip: 'tooltip' },
    useSceneImageRecord: () => record, useTavernConfirm: () => async () => true,
    rpc: async (...args) => { calls.push(args) }, recordImageInteraction() {},
    tavernErrorHub: { report: (...args) => errors.push(args) },
    window: { dispatchEvent() {} }, CustomEvent: class {},
    require: () => ({ createPortal: child => child })
  })
  const Action = vm.runInContext(helpers + component + ';SceneImageAction', ctx)
  function render() {
    let attempts = 0
    do {
      assert.ok(++attempts < 10, 'hooks should settle')
      cursor = 0; dirty = false; pending = []
      tree = Action(props)
      for (const effect of pending) effect()
    } while (dirty)
    return tree
  }
  function find(type, label) {
    function visit(node) {
      if (!node || typeof node !== 'object') return
      if (node.type === type && (!label || node.props['aria-label'] === label || node.children.includes(label))) return node
      for (const child of node.children || []) { const found = visit(child); if (found) return found }
    }
    return visit(render())
  }
  function open() { find('button').props.onClick({ currentTarget: { closest: () => container } }); render() }
  function type(value) { find('textarea').props.onChange({ target: { value } }); render() }
  return { props, record, calls, errors, render, find, open, type }
}

test('首次生图先展开参考意见，取消不调用后端，提交使用当前对话和轮次', async () => {
  const f = fixture()
  f.open(); f.type('  人物背影，夕阳逆光  ')
  assert.equal(f.calls.length, 0)
  f.find('button', '取消').props.onClick()
  assert.equal(f.find('textarea'), undefined)
  assert.equal(f.calls.length, 0)
  f.open()
  await f.find('button', '生成插图').props.onClick()
  assert.equal(f.calls.length, 1)
  const [method, args, session] = f.calls[0]
  assert.equal(method, 'generateSceneImage')
  assert.equal(session, 'session')
  assert.equal(args.turn, 2)
  assert.equal(args.key, 'image-key')
  assert.equal(args.instruction, '人物背影，夕阳逆光')
  assert.ok(args.requestId)
  assert.equal(f.find('textarea'), undefined)
  f.open()
  assert.equal(f.find('textarea').props.value, '', '成功后清空意见')
  assert.deepEqual(f.errors, [])
})

test('参考意见留空时自动构图，切换对话或轮次不沿用未提交草稿', async () => {
  const f = fixture()
  f.open(); f.type('旧对话意见')
  f.props.sessionId = 'other-session'; f.props.turn = 3
  assert.equal(f.find('textarea'), undefined)
  f.open(); f.type('   ')
  await f.find('button', '生成插图').props.onClick()
  assert.equal(f.calls[0][1].instruction, '')
  assert.equal(f.calls[0][1].turn, 3)
  assert.equal(f.calls[0][2], 'other-session')
})

test('运行中、关闭生图及存在图片时不提供首次生图操作', () => {
  for (const patch of [{ enabled: false }, { status: 'running' }, { recovery: 'save' }, { versions: [{ id: 'existing' }] }]) {
    const f = fixture()
    Object.assign(f.record, patch)
    assert.equal(f.render(), null)
    assert.equal(f.calls.length, 0)
  }
})
