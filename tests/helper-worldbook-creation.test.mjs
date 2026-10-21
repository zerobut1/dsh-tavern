import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { helperClient, helperHostHarness } from './fixtures/helper-host-harness.mjs'
import { createHelperWorldbookHost } from './fixtures/helper-worldbook-host.mjs'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'

const openingSource = await readFile(new URL('../tavern-plugin/src/client/opening-preview.js', import.meta.url), 'utf8')
const name = '道渊开局创建人物'
const entry = { comment: '出生界域', content: '当前剧情舞台为玄天界', type: 'constant',
  position: 'before_character_definition', order: 100, exclude_recursion: true, prevent_recursion: true }

// Only the transport and browser shell are doubles; library writes use temporary files.
for (const surface of ['script', 'opening', 'message']) test('酒馆助手创建世界书并单条写入，重载后保留：' + surface, async t => {
  const host = await createHelperWorldbookHost()
  t.after(host.cleanup)
  let invoke = host.invoke.bind(host), context = { ...await host.adapter.getWorldbook('audit', 'current'), worldbookNames: await host.library.names() }
  if (surface === 'opening') {
    const preparation = createOpeningPreparation({ readCard: host.readCard, worldBooks: host.library })
    t.after(() => preparation.dispose())
    const draft = await preparation.create('card.json', { runtime: true })
    context = draft.runtime.context
    invoke = (method, args) => preparation.callRuntime(draft.id, method, args)
  }
  let win
  if (surface !== 'message') {
    let harness
    harness = helperHostHarness(context, { onCall(call) {
      if (call.type !== 'dsh-tavern-helper-call') return
      Promise.resolve().then(() => invoke(call.method, call.args)).then(result => harness.reply(call, result), error => harness.reply(call, error.message, false))
    } })
    win = harness.window
  } else {
    const html = helperClient.buildTavernFrameDocument({ token: 'worldbooks', content: '', helperContext: context })
    const listeners = []
    const parent = { postMessage(call) {
      Promise.resolve().then(() => invoke(call.method, call.args)).then(result => {
        for (const listener of listeners) listener({ source: parent, data: { token: call.token,
          type: 'dsh-tavern-helper-response', requestId: call.requestId, ok: true, result } })
      })
    } }
    win = { getWorldbookNames: () => context.worldbookNames, parent, structuredClone,
      addEventListener: (_type, listener) => listeners.push(listener) }
    win.window = win
    vm.runInNewContext(html.match(/<script data-dsh-tavern-interactive-helper>([\s\S]*?)<\/script>/)[1], win)
  }
  const api = win.TavernHelper
  assert.equal(api.getLorebooks().includes(name), false)
  assert.equal(await api.createLorebook(name), true)
  assert.equal(api.getLorebooks().includes(name), true)
  const uid = await api.createLorebookEntry(name, entry)
  assert.equal(Number.isSafeInteger(uid), true)
  const created = (await win.getWorldbook(name)).find(row => row.uid === uid)
  assert.equal(created.content, entry.content)
  assert.equal(created.strategy.type, 'constant')
  assert.equal(created.recursion.prevent_incoming, true)
  assert.equal(created.recursion.prevent_outgoing, true)
  assert.equal(await api.createLorebook(name), false)
  // A different runtime reads persisted library data, even after preparation disposal.
  const reloaded = await host.adapter.getWorldbook('audit', name)
  assert.equal(reloaded.worldbook.entries.length, 1)
  assert.equal(reloaded.worldbook.entries[0].content, entry.content)
  assert.equal((await host.library.bound('card.json')).view.displayName, '审计书')
  if (surface !== 'message') assert.equal(win.getCharWorldbookNames().primary, '审计书')
  assert.equal((await host.library.get((await host.library.named(name)).source)).globalEnabled, false)
})

test('准备页的世界书覆盖接口将新建书读写交给原 Helper，保留主书草稿', async () => {
  const calls = [], parent = { postMessage() { assert.fail('新建书不应写入主书草稿') } }
  const win = { parent, addEventListener() {}, setTimeout, clearTimeout,
    SillyTavern: { getContext: () => ({}) }, TavernHelper: {},
    getWorldbook: async book => { calls.push(['read', book]); return [] },
    updateWorldbookWith: async (book, updater) => { calls.push(['write', book]); return updater([]) } }
  win.window = win
  vm.runInNewContext(openingSource, win)
  win.installOpeningPreviewBridge('preview', { runtime: true, worldbook: { name: '主书', entries: [] },
    swipes: ['开场'], selectedIndex: 0, openingIds: ['primary'] })
  await win.getWorldbook(name)
  const updated = await win.updateWorldbookWith(name, rows => rows.concat({ content: '新增' }))
  assert.equal(updated[0].content, '新增')
  assert.deepEqual(calls, [['read', name], ['write', name]])
})
