import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

import { fencedSegments } from '../tavern-plugin/lib/domain/html-fenced-segments.js'

const hostSource = await readFile(new URL('../tavern-plugin/src/client/runtime/helper-host.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const pendingCss = css.slice(0, css.indexOf('/* Tavern components'))
const { mount, layers } = new Function(hostSource + ';return {mount:mountTavernScriptLayer,layers:tavernScriptLayers}')()

test('未标语言的代码块按 JS-Slash-Runner 规则：只有完整页面才渲染，<msg> 等协议片段保留为代码块', () => {
  assert.deepEqual(fencedSegments('前文\n```\n<msg>胡伟|顾绒绒|你好|09:00</msg>\n```\n').map(part => part.kind), ['text'])
  assert.deepEqual(fencedSegments('```\n<html><body>面板</body></html>\n```').map(part => part.kind), ['html'])
  assert.deepEqual(fencedSegments('```html\n<div>状态</div>\n```').map(part => part.kind), ['html'])
})

test('脚本可扫描待接管正文，角色名改写后才显示副本并保留点击事件', async t => {
  const dom = new JSDOM('<style>' + pendingCss + '</style><div class="dsh-tavern-script-part"><div id="native"><p>千纱向你挥手。</p><button>原生按钮</button></div><div class="mes_text dsh-tavern-script-layer" data-dsh-script-layer data-session="s" data-mesid="0"></div></div>')
  t.after(() => dom.window.close())
  const { document, NodeFilter } = dom.window
  const native = document.querySelector('#native'), layer = document.querySelector('.mes_text')
  const cleanup = mount({ native, layer, sessionId: 's', messageId: 0 })
  t.after(cleanup)
  const displayed = layers(document, 's', 0)[0]
  assert.equal(displayed, layer)
  assert.notEqual(dom.window.getComputedStyle(displayed).display, 'none', '卡片不能把待处理正文误认为未显示')
  assert.equal(dom.window.getComputedStyle(displayed).opacity, '0', '未改写时仍显示原生正文')
  assert.equal(native.hidden, false)
  let nativeClicks = 0
  native.querySelector('button').addEventListener('click', () => nativeClicks++)
  native.querySelector('button').click()
  assert.equal(nativeClicks, 1, '只读取正文不破坏原生交互')
  const walker = document.createTreeWalker(displayed, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === 1 && (node.matches('button,[hidden],[inert]') || dom.window.getComputedStyle(node).display === 'none')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  let text
  while (walker.nextNode()) if (walker.currentNode.nodeType === 3) { text = walker.currentNode; break }
  assert.ok(text)
  const name = document.createElement('span')
  name.textContent = '千纱'
  let opened = false
  name.addEventListener('click', () => { opened = true })
  text.replaceWith(name, '向你挥手。')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(native.hidden, true)
  assert.notEqual(dom.window.getComputedStyle(layer).opacity, '0')
  assert.equal(layer.hasAttribute('inert'), false)
  name.click()
  assert.equal(opened, true)
  assert.deepEqual(layers(document, 'another', 0), [])
  cleanup()
  assert.equal(native.hidden, false)
  assert.equal(layer.hidden, true)
})
