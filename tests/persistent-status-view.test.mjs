import assert from 'node:assert/strict'
import test from 'node:test'

import { projectPersistentStatusView } from '../tavern-plugin/lib/domain/persistent-status-view.js'

test('开场的静态状态栏在首轮没有新面板时保留，来源轮次保持为开场', () => {
  const rule = { id: 'static-status', name: '角色状态', enabled: true, placement: [2], markdownOnly: true,
    findRegex: '<StatusPlaceHolderImpl/>', replaceString: '```html\n<body><p>开场状态</p></body>\n```' }
  const messages = [{ role: 'assistant', greeting: true, turn: 1, text: '开场<StatusPlaceHolderImpl/>' }]
  const options = { regexScripts: [rule], allowStaticStatus: true }
  const opening = projectPersistentStatusView(messages, [], options)
  assert.match(opening.statusView.content, /开场状态/)
  const next = projectPersistentStatusView([...messages,
    { role: 'user', text: '你好' }, { role: 'assistant', turn: 2, text: '首轮正文，没有状态栏' }
  ], [], options)
  assert.equal(next.statusView.viewId, opening.statusView.viewId)
  assert.equal(next.statusView.sourceTurn, 1)
  assert.equal(next.statusView.targetTurn, 2)
  assert.equal(next.statusView.content, opening.statusView.content)
  assert.equal(projectPersistentStatusView(messages, [], { ...options, regexScripts: [{ ...rule, enabled: false }] }).statusView, null)
})
