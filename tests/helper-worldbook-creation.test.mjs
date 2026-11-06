import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const openingSource = await readFile(new URL('../tavern-plugin/src/client/opening-preview.js', import.meta.url), 'utf8')
const name = '道渊开局创建人物'
const entry = { comment: '出生界域', content: '当前剧情舞台为玄天界', type: 'constant',
  position: 'before_character_definition', order: 100, exclude_recursion: true, prevent_recursion: true, group_weight: 42 }

// Exercise the shared compatibility API once; each UI surface uses this factory.
const apiSource = await readFile(new URL('../tavern-plugin/src/client/runtime/helper-worldbook-creation.js', import.meta.url), 'utf8')
const { install, convert } = new Function(apiSource + ';return {install:installTavernWorldbookCreationApi,convert:tavernLegacyWorldbookPatch}')()

test('创建世界书刷新名称目录，单条旧字段经统一写入器转换并返回 uid', async () => {
  const calls = [], created = new Set(['主书'])
  const win = { getWorldbookNames: () => ['主书'], createWorldbookEntries: async (name, entries) => {
    calls.push([name, entries]); return { new_entries: [{ uid: 7 }] }
  } }
  install({ window: win, legacyWorldbookPatch: convert, call: async (method, args) => {
    assert.equal(method, 'createTavernHelperWorldbook')
    const fresh = !created.has(args.name)
    created.add(args.name)
    return { created: fresh, names: [...created] }
  } })
  assert.equal(await win.TavernHelper.createLorebook(name), true)
  assert.equal(await win.TavernHelper.createLorebook(name), false)
  assert.deepEqual(win.TavernHelper.getLorebooks(), ['主书', name])
  const before = structuredClone(entry)
  assert.equal(await win.TavernHelper.createLorebookEntry(name, entry), 7)
  assert.deepEqual(entry, before)
  assert.equal(calls[0][0], name)
  const converted = calls[0][1][0]
  assert.equal(converted.content, entry.content)
  assert.equal(converted.strategy.type, 'constant')
  assert.equal(converted.position.type, 'before_character_definition')
  assert.deepEqual(converted.recursion, { prevent_incoming: true, prevent_outgoing: true })
  assert.equal(converted.extra.group_weight, 42)
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
