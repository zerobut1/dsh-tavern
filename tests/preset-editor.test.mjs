import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { sourceFunction } from './fixtures/source-function.mjs'

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
