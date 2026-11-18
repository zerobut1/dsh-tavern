import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { projectCardOpeningPreviews } from '../tavern-plugin/lib/domain/card-opening-previews.js'
import { browserReactScript } from './fixtures/browser-react.mjs'

const rule = (findRegex, replaceString) => ({ findRegex, replaceString, placement: [2], markdownOnly: true })

test('a whole-opening display replacement renders an interactive iframe', { timeout: 15000 }, async t => {
  const result = await projectCardOpeningPreviews({
    card: { first_mes: '[DEMO_OPENING]' },
    extensions: { regexScripts: [rule('^\\[DEMO_OPENING\\]$', '<button onclick="this.textContent=\'已开始\'">开始游戏</button>')] }
  })
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: '<main></main>' })
    : route.fulfill({ status: 204 }))
  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};` })
  await page.addScriptTag({ content: await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8') })
  await page.evaluate(projection => {
    modules['react-dom/client'].createRoot(document.querySelector('main')).render(
      client.renderTavernProjection(projection, { turn: 1, trustedCardMode: true })
    )
  }, result.openings[0].projection)
  const frame = page.frameLocator('iframe.dsh-tavern-message-frame')
  await frame.getByRole('button', { name: '开始游戏' }).click({ timeout: 5000 })
  await frame.getByRole('button', { name: '已开始' }).waitFor({ timeout: 5000 })
})
