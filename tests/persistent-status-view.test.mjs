import assert from 'node:assert/strict'
import test from 'node:test'

import { projectPersistentStatusView } from '../tavern-plugin/lib/domain/persistent-status-view.js'

test('text 围栏的 body 根状态栏仍提升为右侧面板', () => {
  const replaceString = "```text\n<body>\n<script>\n$('body').load('/api/dsh-tavern/remote-assets/hash/bottom-status-bar.html_V_1?host=1')\n</script>\n</body>\n```"
  const rule = { id: 'adf31d55-5ab4-4be7-a720-c0c96a5e1ed4', name: '状态栏', enabled: true, placement: [2], markdownOnly: true,
    findRegex: '<StatusPlaceHolderImpl/>', replaceString }
  const result = projectPersistentStatusView([{ role: 'assistant', turn: 2, text: '正文' }], [], { regexScripts: [rule] })
  assert.equal(result.statusViews.length, 1)
  assert.match(result.statusView.content, /bottom-status-bar\.html/)
  assert.match(result.statusView.content, /<body[\s>]/i)
  assert.equal(projectPersistentStatusView([{ role: 'assistant', turn: 2 }], [], {
    regexScripts: [{ ...rule, replaceString: '```text\n<body><p>无脚本</p></body>\n```' }]
  }).statusView, null)
})

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
