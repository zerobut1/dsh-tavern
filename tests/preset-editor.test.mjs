import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { createPresetEditor } from '../tavern-plugin/lib/domain/preset-editor.js'
import { sourceFunction } from './fixtures/source-function.mjs'

function harness(document) {
  let text = JSON.stringify(document)
  let writes = 0
  const editor = createPresetEditor({
    normalizePath: function (value, kind) {
      assert.equal(kind, 'preset')
      if (!String(value).startsWith('presets/')) throw new Error('bad path')
      return String(value)
    },
    readText: async function () { return text },
    writeText: async function (_path, next) { text = next; writes += 1 },
    inspectRegexScripts: function (_inspected, source) {
      return (source.extensions && source.extensions.regex_scripts || []).map(function (script, index) {
        const base = '/extensions/regex_scripts/' + index
        return { regexKey: String(script.id || 'regex-' + (index + 1)) + '#1', edit: {
          scriptNamePath: base + '/scriptName',
          findRegexPath: base + '/findRegex',
          replaceStringPath: base + '/replaceString',
          disabledPath: base + '/disabled'
        } }
      })
    }
  })
  return { editor, document: function () { return JSON.parse(text) }, writes: function () { return writes } }
}

test('预设编辑器按 JSON Pointer 分段读取并保留未知字段', async () => {
  const run = harness({ prompts: [{ identifier: 'main', content: '正文' }], extension_data: { custom: 42 } })
  const result = await run.editor.read('presets/写作.json', { pointer: '/prompts/0', limit: 1000 })

  assert.equal(result.pointer, '/prompts/0')
  assert.match(result.text, /"content": "正文"/)
  assert.equal(result.done, true)
})

 test('同一预设的并发条目和原文修改都保留，失败修改不阻塞后续保存', async () => {
  const run = harness({ prompts: [{ identifier: 'a', content: 'old A' }, { identifier: 'b', content: 'old B' }] })
  const results = await Promise.allSettled([
    run.editor.updateEntry('presets/test.json', 'a#1', { content: 'NEW A' }),
    run.editor.updateEntry('presets/test.json', 'b#1', { unknown: true }),
    run.editor.update('presets/test.json', [{ op: 'set', path: '/prompts/1/content', value: 'NEW B' }])
  ])
  assert.deepEqual(results.map(row => row.status), ['fulfilled', 'rejected', 'fulfilled'])
  assert.deepEqual(run.document().prompts.map(row => row.content), ['NEW A', 'NEW B'])
})

test('增删条目后保留其他词条未保存的修改，重复标识改号时草稿仍对应原词条', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/features/preset-library.js', import.meta.url), 'utf8')
  const removed = { entryKey: 'same#1', identifier: 'same', sourcePromptIndex: 0 }
  let drafts = { 'same#1': { content: '将被删除' }, 'same#2': { content: '未保存的修改' }, 'other#1': { name: '未保存的名称' } }
  let rows = new Set(['entry:same#1', 'entry:same#2', 'entry:other#1', 'regex:r#1'])
  const context = {
    preset: { entries: [removed, { entryKey: 'same#2', identifier: 'same', sourcePromptIndex: 1 }, { entryKey: 'other#1', identifier: 'other', sourcePromptIndex: 2 }] },
    setEntryDrafts: update => { drafts = update(drafts) }, setOpenRows: update => { rows = update(rows) },
    setPreset: value => { context.preset = value }
  }
  const apply = vm.runInNewContext('(' + sourceFunction(source, 'applyEntryStructureChange') + ')', context)
  const remaining = [{ entryKey: 'same#1', identifier: 'same', sourcePromptIndex: 0 }, { entryKey: 'other#1', identifier: 'other', sourcePromptIndex: 1 }]
  apply({ entries: remaining }, removed)
  assert.deepEqual(JSON.parse(JSON.stringify(drafts)), { 'same#1': { content: '未保存的修改' }, 'other#1': { name: '未保存的名称' } })
  assert.deepEqual([...rows].sort(), ['entry:other#1', 'entry:same#1', 'regex:r#1'])
  apply({ entries: [...remaining, { entryKey: 'new#1', identifier: 'new', sourcePromptIndex: 2 }] }, null, 'new#1')
  assert.equal(drafts['same#1'].content, '未保存的修改')
  assert.equal(rows.has('entry:new#1'), true, '新增词条自动展开供编辑')
})

 test('同一预设的并发条目和原文修改都保留，失败修改不阻塞后续保存', async () => {
  const run = harness({ prompts: [{ identifier: 'a', content: 'old A' }, { identifier: 'b', content: 'old B' }] })
  const results = await Promise.allSettled([
    run.editor.updateEntry('presets/test.json', 'a#1', { content: 'NEW A' }),
    run.editor.updateEntry('presets/test.json', 'b#1', { unknown: true }),
    run.editor.update('presets/test.json', [{ op: 'set', path: '/prompts/1/content', value: 'NEW B' }])
  ])
  assert.deepEqual(results.map(row => row.status), ['fulfilled', 'rejected', 'fulfilled'])
  assert.deepEqual(run.document().prompts.map(row => row.content), ['NEW A', 'NEW B'])
})
