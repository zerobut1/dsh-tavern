import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/src/client/text-colors.js', import.meta.url), 'utf8')
const { findTavernQuoteRanges, installTavernTextColors } = vm.runInNewContext(
  source.slice(0, source.indexOf('// Display colors belong')) + ';({findTavernQuoteRanges,installTavernTextColors})')

function fixture(t, content) {
  const dom = new JSDOM('<main>' + content + '</main>')
  t.after(() => dom.window.close())
  const win = dom.window, root = win.document.querySelector('main'), timers = new Map()
  let nextId = 0, reads = 0, ranges = 0
  win.CSS = { highlights: new Map(), supports: () => true }
  win.Highlight = class extends Set {}
  win.getComputedStyle = element => { reads++; return { color: element.style.color || 'rgb(20, 20, 20)' } }
  win.setTimeout = fn => { timers.set(++nextId, fn); return nextId }
  win.clearTimeout = id => timers.delete(id)
  const createRange = win.document.createRange.bind(win.document)
  win.document.createRange = () => { ranges++; return createRange() }
  const api = installTavernTextColors(root, {}, findTavernQuoteRanges)
  t.after(() => api.dispose())
  function flush() {
    while (timers.size) { const [id, fn] = timers.entries().next().value; timers.delete(id); fn() }
  }
  const marked = () => [...win.CSS.highlights.values()].flatMap(value => [...value])
  return { win, root, api, flush, marked, reads: () => reads, createdRanges: () => ranges }
}

test('只有完整同一行的引号成对高亮，不跨行或匹配空对白', () => {
  const text = '旁白“你好”「再见」\n""\n“跨\n行”'
  assert.deepEqual(Array.from(findTavernQuoteRanges(text), pair => text.slice(...pair)), ['“你好”', '「再见」'])
})

test('普通段落不创建空高亮，样式读取次数随元素数增长而非重复遍历祖先', t => {
  const f = fixture(t, Array.from({ length: 100 }, () => '<p><span>普通</span><b>旁白</b></p>').join(''))
  f.flush()
  assert.equal(f.createdRanges(), 0)
  assert.equal(f.win.CSS.highlights.size, 0)
  assert.equal(f.win.document.querySelector('[data-dsh-tavern-text-colors]'), null)
  assert.ok(f.reads() <= 301, `样式读取过多：${f.reads()}`)
})

test('跨节点对白只生成实际重叠范围，保留卡片自设颜色和 DOM，关闭及销毁清理注册', t => {
  const f = fixture(t, '<p><span>旁白“<b>你好</b>朋友”</span><em>心想</em><span style="color:red">“红字”</span></p>')
  const original = f.root.innerHTML
  f.flush()
  assert.equal(f.marked().length, 4)
  assert.ok(f.marked().every(range => range.toString().length > 0))
  assert.deepEqual(f.marked().map(range => range.toString()).sort(), ['心想', '“', '你好', '朋友”'].sort())
  assert.equal(f.root.innerHTML, original)
  f.api.setEnabled(false)
  assert.equal(f.marked().length, 0)
  f.api.setEnabled(true); f.flush()
  assert.equal(f.marked().length, 4)
  f.api.dispose()
  assert.equal(f.win.CSS.highlights.size, 0)
  assert.equal(f.win.document.querySelector('[data-dsh-tavern-text-colors]'), null)
})
