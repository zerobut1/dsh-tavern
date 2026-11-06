import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/src/client/features/composer-enter.js', import.meta.url), 'utf8')

function harness(t) {
  const dom = new JSDOM('<div data-composer-seat><div data-composer-input contenteditable="true"></div><textarea></textarea></div><div data-composer-seat><div data-composer-input contenteditable="true"></div></div>')
  t.after(() => dom.window.close())
  let now = 100, text = '前文后文', start = 2, end = 2, sends = 0
  const install = vm.runInNewContext(source + ';installTavernComposerEnter', { Date: { now: () => now } })
  const [host, otherHost] = dom.window.document.querySelectorAll('[data-composer-seat]')
  const input = host.querySelector('[data-composer-input]')
  const actions = {
    captureInsertion: () => ({ start, end, draftRev: 1 }),
    insertText: (value, span) => {
      text = text.slice(0, span.start) + value + text.slice(span.end)
      start = end = span.start + value.length
      return true
    }
  }
  const dispose = install(host)
  const beforeinput = event => {
    if (event.inputType === 'insertLineBreak') {
      event.preventDefault()
      actions.insertText('\n', actions.captureInsertion())
    }
  }
  input.addEventListener('beforeinput', beforeinput)
  // Stand-in for DSH's downstream editor keymap: Enter submits unless shifted.
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return
    if (event.shiftKey) {
      event.preventDefault()
      actions.insertText('\n', actions.captureInsertion())
    } else sends++
  })
  const press = (options = {}, target = input) => {
    const event = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options })
    target.dispatchEvent(event)
    return event
  }
  return { host, otherHost, input, actions, dispose, press, dom,
    withoutBeforeInput: () => input.removeEventListener('beforeinput', beforeinput),
    get text() { return text }, get sends() { return sends },
    select: (from, to) => { start = from; end = to },
    advance: value => { now += value }
  }
}

test('Enter 在光标或选区处换行，Ctrl+Enter 才进入原生发送，Shift+Enter 保持原生换行', t => {
  const h = harness(t)
  assert.equal(h.press().defaultPrevented, true)
  assert.equal(h.text, '前文\n后文')
  h.select(0, 2)
  h.press()
  assert.equal(h.text, '\n\n后文')
  assert.equal(h.sends, 0)
  assert.equal(h.press({ ctrlKey: true }).defaultPrevented, false)
  assert.equal(h.sends, 1)
  assert.equal(h.press({ shiftKey: true }).defaultPrevented, true)
  assert.equal(h.sends, 1)
  assert.equal(h.press({ metaKey: true }).defaultPrevented, true)
  assert.equal(h.sends, 1, 'Cmd+Enter 不再意外发送')
  assert.equal(h.text, '\n\n\n后文')
  h.withoutBeforeInput()
  h.press()
  assert.equal(h.text, '\n\n\n\n后文', '没有 beforeinput 时仍由原生 Shift+Enter 换行')
  assert.equal(h.sends, 1)
})

test('输入法确认不插入换行，其他编辑器与只读输入不受影响，卸载后释放监听', t => {
  const h = harness(t)
  for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
    assert.equal(h.press(options).defaultPrevented, false)
  }
  h.input.setAttribute('data-composer-composing', '')
  assert.equal(h.press().defaultPrevented, false)
  h.input.removeAttribute('data-composer-composing')
  h.input.dispatchEvent(new h.dom.window.CompositionEvent('compositionend', { bubbles: true }))
  assert.equal(h.press().defaultPrevented, false, '兼容输入法结束紧邻的 Enter')
  h.advance(11)
  assert.equal(h.press({}, h.host.querySelector('textarea')).defaultPrevented, false)
  assert.equal(h.press({}, h.otherHost.querySelector('[data-composer-input]')).defaultPrevented, false)
  h.input.setAttribute('contenteditable', 'false')
  assert.equal(h.press().defaultPrevented, false)
  h.input.setAttribute('contenteditable', 'true')
  assert.equal(h.text, '前文后文')
  h.press()
  assert.equal(h.text, '前文\n后文')
  h.dispose()
  assert.equal(h.press().defaultPrevented, false)
  assert.equal(h.text, '前文\n后文')
})

test('真实编辑器生成换行节点，连续换行可退格或选区删除，也可撤销重做', async t => {
  const dom = new JSDOM('<div data-composer-seat><div data-composer-input contenteditable="true"></div></div>', { pretendToBeVisual: true })
  // Lexical registers beforeinput only when target-range support is available.
  dom.window.InputEvent.prototype.getTargetRanges = () => []
  dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 })
  dom.window.Range.prototype.getClientRects = () => []
  // JSDOM lacks the browser caret measurement used by collapsed Backspace.
  // Only supply that measurement across a BR; Lexical performs the deletion.
  dom.window.getSelection().modify = function (alter, direction, granularity) {
    assert.deepEqual([alter, direction, granularity], ['move', 'backward', 'character'])
    let node = this.focusNode, offset = this.focusOffset
    if (node.nodeType === dom.window.Node.TEXT_NODE) {
      assert.equal(offset, 0)
      offset = [...node.parentNode.childNodes].indexOf(node)
      node = node.parentNode
    }
    while (offset === 0 && node.parentNode) {
      offset = [...node.parentNode.childNodes].indexOf(node)
      node = node.parentNode
    }
    assert.equal(node.childNodes[offset - 1].nodeName, 'BR')
    this.collapse(node, offset - 1)
  }
  const globals = new Map()
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? dom.window : dom.window[name] })
  }
  t.after(() => {
    dom.window.close()
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  const { createEditor, $getRoot, $createParagraphNode, $createTextNode, $getSelection, $isRangeSelection, UNDO_COMMAND, REDO_COMMAND } = await import('lexical')
  const { registerPlainText } = await import('@lexical/plain-text')
  const { registerHistory, createEmptyHistoryState } = await import('@lexical/history')
  const host = document.querySelector('[data-composer-seat]'), input = host.firstElementChild
  const editor = createEditor({ namespace: 'composer-enter-unit', onError: error => { throw error } })
  editor.setRootElement(input)
  const disposeText = registerPlainText(editor)
  const disposeHistory = registerHistory(editor, createEmptyHistoryState(), 1000)
  const dispose = new Function(source + ';return installTavernComposerEnter')()(host)
  t.after(() => { dispose(); disposeHistory(); disposeText(); editor.setRootElement(null) })
  const update = fn => editor.update(fn, { discrete: true })
  const flush = () => update(() => {})
  const text = () => editor.getEditorState().read(() => $getRoot().getTextContent())
  const nodes = () => editor.getEditorState().toJSON().root.children[0].children
  const press = key => {
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }))
    flush()
  }
  input.focus()
  update(() => {
    const content = $createTextNode('前文后文')
    $getRoot().append($createParagraphNode().append(content))
    content.select(2, 2)
  })
  press('Enter')
  assert.equal(text(), '前文\n后文')
  editor.dispatchCommand(UNDO_COMMAND, undefined)
  flush()
  assert.equal(text(), '前文后文', '换行本身可撤销')
  editor.dispatchCommand(REDO_COMMAND, undefined)
  flush()
  assert.equal(text(), '前文\n后文')
  press('Enter')
  assert.equal(text(), '前文\n\n后文')
  assert.deepEqual(nodes().map(node => node.type), ['text', 'linebreak', 'linebreak', 'text'])
  assert.ok(nodes().filter(node => node.type === 'text').every(node => !node.text.includes('\n')))
  press('Backspace')
  assert.equal(text(), '前文\n后文')
  press('Backspace')
  assert.equal(text(), '前文后文')
  editor.dispatchCommand(UNDO_COMMAND, undefined)
  flush()
  assert.equal(text(), '前文\n后文')
  editor.dispatchCommand(REDO_COMMAND, undefined)
  flush()
  assert.equal(text(), '前文后文')
  press('Enter')
  update(() => {
    const selection = $getSelection()
    assert.ok($isRangeSelection(selection))
    const paragraph = $getRoot().getFirstChild()
    selection.anchor.set(paragraph.getKey(), 1, 'element')
    selection.focus.set(paragraph.getKey(), 2, 'element')
  })
  press('Backspace')
  assert.equal(text(), '前文后文', '只选中换行即可删除，保留前后文字')
})
