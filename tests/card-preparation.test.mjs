import assert from 'node:assert/strict'
import test from 'node:test'

import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'

function moduleUnderTest() {
  let sequence = 0
  return createCardPreparation({
    id: () => 'card-' + (++sequence),
    now: () => 123456
  })
}

test('世界书常驻上下文只暴露目录，正文按编号或关键词读取', () => {
  const cards = moduleUnderTest()
  const card = cards.create({
    kind: 'import',
    payload: {
      name: '阿芙拉',
      character_book: {
        name: '黑麦镇',
        entries: [
          { keys: ['钟楼'], content: '钟楼藏着失踪商队的线索。', enabled: true, constant: false },
          { keys: ['废案'], content: '这条设定已经停用。', enabled: false, constant: true },
          { keys: ['酒馆'], content: '吧台下面藏着一把短弩。', enabled: true, constant: true }
        ]
      }
    }
  })

  const overview = cards.present({ card, as: 'world-book-overview' })
  assert.equal(overview.entryCount, 2)
  assert.deepEqual(overview.entries[0], {
    ref: 'entry:0', keys: ['钟楼'], comment: '', enabled: true, constant: false, chars: 12
  })
  assert.deepEqual(overview.entries.map((entry) => entry.ref), ['entry:0', 'entry:2'])
  assert.equal(JSON.stringify(overview).includes('失踪商队'), false)

  const window = cards.present({ card, as: 'world-book-window', ref: 'entry:2' })
  assert.equal(window.total, 2)
  assert.equal(window.entries[0].ref, 'entry:2')
  assert.equal(window.entries[0].entry.content, '吧台下面藏着一把短弩。')
  assert.equal(cards.present({ card, as: 'world-book-window', query: '失踪商队', limit: 1 }).entries[0].ref, 'entry:0')
  assert.deepEqual(cards.present({ card, as: 'world-book-window', ref: 'entry:1' }).entries, [])
})

test('世界书按条目合并修改，不要求模型重传整本世界书', () => {
  const cards = moduleUnderTest()
  const card = cards.create({
    kind: 'import',
    payload: {
      name: '阿芙拉',
      character_book: {
        name: '旧世界书',
        entries: [
          { keys: ['钟楼'], content: '旧线索', enabled: true, extensions: { depth: 4 } },
          { keys: ['酒馆'], content: '保持不变', enabled: true }
        ]
      }
    }
  })

  const changed = cards.update({
    kind: 'card',
    card,
    patch: {},
    worldBookOperations: [
      { op: 'rename', name: '新世界书' },
      { op: 'update', ref: 'entry:0', patch: { content: '新线索' } },
      { op: 'add', entry: { keys: ['水道'], content: '新的入口', enabled: true } }
    ]
  })

  assert.equal(changed.changed, true)
  assert.deepEqual(changed.changedFields, ['character_book'])
  assert.equal(changed.view.character_book.name, '新世界书')
  assert.equal(changed.view.character_book.entries[0].content, '新线索')
  assert.deepEqual(changed.view.character_book.entries[0].extensions, { depth: 4 })
  assert.equal(changed.view.character_book.entries[1].content, '保持不变')
  assert.equal(changed.view.character_book.entries[2].content, '新的入口')

  const removed = cards.update({ kind: 'card', card: changed.card, patch: {}, worldBookOperations: { op: 'delete', ref: 'entry:1' } })
  assert.deepEqual(removed.view.character_book.entries.map((entry) => entry.content), ['新线索', '新的入口'])
  assert.throws(() => cards.update({ kind: 'card', card, patch: {}, worldBookOperations: { op: 'update', ref: 'entry:9', patch: { content: 'x' } } }), /世界书条目不存在/)
})

for (const spec of ['flat', 'chara_card_v2', 'chara_card_v3']) test('变量编辑不触发名字同步，原生与字段改名仍触发：' + spec, () => {
  const cards = moduleUnderTest()
  const data = { name: '原名', extensions: { tavern_helper: { variables: {} } } }
  const workspace = cards.create({ kind: 'import', payload: spec === 'flat' ? data : { spec, data } })
  const prefix = spec === 'flat' ? '' : '/data'
  const variables = cards.update({ kind: 'card', card: workspace, patch: {}, rawOperations: [{ op: 'set', path: prefix + '/extensions/tavern_helper/variables', value: { hp: 7 } }] })
  assert.equal(variables.changed, true)
  assert.equal(variables.nameChanged, false)
  const named = cards.update({ kind: 'card', card: workspace, patch: { name: '新名字' } })
  assert.equal(named.nameChanged, true)
  const rawNamed = cards.update({ kind: 'card', card: workspace, patch: {}, rawOperations: [{ op: 'set', path: prefix + '/name', value: '原生改名' }] })
  assert.equal(rawNamed.nameChanged, true)
  assert.equal(cards.update({ kind: 'card', card: workspace, patch: { name: '原名' } }).nameChanged, false)
})

test('按需交给酒馆脚本的角色带上原始扩展，会话视图不带', () => {
  const cards = moduleUnderTest()
  const assets = { panel: { guyue: 'data:image/webp;base64,abc' } }
  const workspace = cards.create({
    kind: 'import',
    payload: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '仙姝', extensions: { xsd_assets: assets } } }
  })
  const view = cards.present({ card: workspace, as: 'view' })
  assert.equal(Object.hasOwn(view, 'extensions'), false)
  const character = cards.present({ card: workspace, as: 'helper-character' })
  assert.equal(character.name, '仙姝')
  assert.equal(character.extensions.xsd_assets.panel.guyue, 'data:image/webp;base64,abc')
  assert.equal(Object.hasOwn(character, 'data'), false)
  const wrapped = { ...character, data: { ...character } }
  assert.equal(wrapped.data.extensions.xsd_assets.panel.guyue, 'data:image/webp;base64,abc')
})
