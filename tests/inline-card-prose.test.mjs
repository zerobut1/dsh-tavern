import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { projectReplyLayers, projectDisplayParts } from '../tavern-plugin/lib/domain/reply-presentation.js'

const source = await readFile(new URL('../tavern-plugin/src/client/inline-fragment.js', import.meta.url), 'utf8')
const parseInline = new Function(source.slice(0, source.indexOf('function TavernInlineFragment(')) + ';return parseTavernInlineFragment')()
const hostThemeSource = await readFile(new URL('../tavern-plugin/src/client/modules/host-theme.js', import.meta.url), 'utf8')
const colorsSource = await readFile(new URL('../tavern-plugin/src/client/text-colors.js', import.meta.url), 'utf8')
const { installColors, findQuotes } = new Function(colorsSource + ';return {installColors:installTavernTextColors,findQuotes:findTavernQuoteRanges}')()

test('双语 ruby 与引号、同行叙述保持同一段落，Markdown 与独立状态栏均保留', t => {
  const dom = new JSDOM()
  t.after(() => dom.window.close())
  const text = '**前文**\n\n「こんにちは|你好」她转身离开。\n\n后文\n\n<style>.status{color:red}</style><div class="status">状态</div>'
  const result = projectReplyLayers(text, { placement: 2, regexScripts: [{ enabled: true, placement: [2], markdownOnly: true,
    findRegex: '/「([^|]+)\\|([^」]+)」/g', replaceString: '「<ruby>$2<rt style="color:#9e9e9e;">$1</rt></ruby>」' }] })
  assert.equal(result.sourceText, text)
  assert.equal(result.sessionText, text)
  assert.equal(result.displayParts.length, 2)
  const body = parseInline(result.displayParts[0].content, dom.window.document)
  assert.ok(body, '注音使用宿主行内渲染')
  const ruby = body.querySelector('ruby')
  assert.equal(ruby.parentElement.tagName, 'P')
  assert.equal(ruby.previousSibling.textContent, '「')
  assert.equal(ruby.nextSibling.textContent, '」她转身离开。')
  assert.equal(ruby.querySelector('rt').textContent, 'こんにちは')
  assert.equal(body.querySelector('strong').textContent, '前文')
  assert.match(result.displayParts[1].content, /^<style>/)
  assert.equal(parseInline(result.displayParts[1].content, dom.window.document), null, '样式与独立 UI 维持原渲染边界')
})

test('普通 Markdown 和代码示例保持原路径，行内渲染仍拒绝可执行 HTML', t => {
  const dom = new JSDOM()
  t.after(() => dom.window.close())
  for (const text of ['「普通对话」\n\n**后文**', '`<ruby>示例</ruby>`']) {
    assert.deepEqual(projectDisplayParts(text).parts, [{ kind: 'markdown', text }])
  }
  for (const html of ['<ruby onclick="run()">文本</ruby>', '<span><script>run()</script></span>', '<a href="javascript:run()">文本</a>']) {
    assert.equal(parseInline(html, dom.window.document), null)
  }
})

test('双语行内正文向角色脚本公开实际 DOM，并通知消息已渲染', t => {
  const dom = new JSDOM('<style>body{--dsh-content-font-size:20px}[data-test-prose]{font-size:20px}</style>')
  t.after(() => dom.window.close())
  const root = dom.window.document.createElement('div')
  root.setAttribute('data-test-prose', '')
  dom.window.document.body.append(root)
  let effect, cleanup
  const announcements = []
  const React = { useRef: () => ({ current: root }), useLayoutEffect: run => { effect = run }, createElement: (_tag, props) => props }
  const bindZoom = new Function('tavernTextColorOverrides', hostThemeSource + ';return bindTavernFontZoom')(() => ({ quote: '', em: '' }))
  const component = new Function('React', 'bindTavernFontZoom', 'installTavernTextColors', 'findTavernQuoteRanges', 'announceTavernMessageRendered', source + ';return TavernInlineFragment')(
    React, bindZoom, () => ({ dispose() {} }), () => [], (_view, session, id) => announcements.push([session, id]))
  const props = component({ content: '<p>千纱说：「<ruby>你好<rt>こんにちは</rt></ruby>」</p>', scriptLayer: { sessionId: 's', messageId: 0 } })
  for (const [name, value] of Object.entries(props)) if (name.startsWith('data-')) root.setAttribute(name, value)
  cleanup = effect()
  const effectiveFontSize = parseFloat(dom.window.getComputedStyle(root).fontSize) * (Number(root.style.zoom) || 1)
  assert.equal(effectiveFontSize, 20, '继承的 DSH 字号不能再叠加 iframe 缩放')
  assert.equal(dom.window.document.querySelector('[data-dsh-script-layer][data-session="s"][data-mesid="0"]'), root)
  assert.deepEqual(announcements, [['s', 0]])
  const text = root.querySelector('p').firstChild
  const name = dom.window.document.createElement('a')
  name.textContent = '千纱'
  let opened = false
  name.addEventListener('click', () => { opened = true })
  text.replaceWith(name, '说：「')
  name.click()
  assert.equal(opened, true)
  assert.ok(root.querySelector('ruby rt'), '角色名改写保留双语注音')
  cleanup()
  assert.equal(root.childNodes.length, 0)
})

test('双语注音不打断引号着色，日文、卡片自定义颜色和代码保持原样', async t => {
  const dom = new JSDOM('<style>body{color:rgb(30,30,30)}</style><div id="prose"><p>「<ruby>你好<a href="#profile" style="color:#d080a0">千纱</a><rp>(</rp><rt style="color:#9e9e9e">こんにちは</rt><rp>)</rp></ruby>」</p><p style="color:red">「原卡颜色」</p><pre>「代码示例」</pre></div>')
  t.after(() => dom.window.close())
  const root = dom.window.document.querySelector('#prose')
  dom.window.CSS = { highlights: new Map(), supports: () => true }
  dom.window.Highlight = class extends Set {}
  const before = root.innerHTML
  const colors = installColors(root, {}, findQuotes)
  t.after(() => colors.dispose())
  await new Promise(resolve => dom.window.setTimeout(resolve, 60))
  const highlighted = [...dom.window.CSS.highlights.values()].flatMap(ranges => [...ranges].map(range => range.toString()))
  assert.equal(highlighted.join(''), '「你好」')
  assert.equal(root.querySelector('rt').style.color, 'rgb(158, 158, 158)')
  assert.equal(root.querySelector('a').style.color, 'rgb(208, 128, 160)', '可点击的名字保留原卡颜色')
  assert.equal(root.innerHTML, before, '着色不能改写角色脚本拥有的正文 DOM')
})
