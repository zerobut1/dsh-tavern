import assert from 'node:assert/strict'
import test from 'node:test'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'
import { createStorySubmissionGuard, foldStorySubmission, storySubmissionForTurn } from '../tavern-plugin/lib/domain/story-tool-submission.js'
import { userMessageForTurn, requestIdForTurn } from '../tavern-plugin/lib/domain/session-turn-input.js'

function fixture() {
  const session = { id: 'session', header: { version: 4 }, events: [], surface: { nodes: [] }, append(type, data, intent = {}) {
    const event = { seq: this.events.length, type, data, ...intent }
    this.events.push(event)
    if (intent.surfaceOp === 'append') this.surface.nodes.push(event.seq)
    else if (intent.surfaceOp?.op === 'replace') {
      const from = this.surface.nodes.indexOf(intent.surfaceOp.startSeq)
      const to = this.surface.nodes.indexOf(intent.surfaceOp.endSeq)
      this.surface.nodes.splice(from, to - from + 1, event.seq)
    }
    return event
  } }
  const corrections = [], finalized = [], failures = [], handlers = {}
  const agent = { session, steer(message) {
    corrections.push(message)
    session.append('user/message', message, { surfaceOp: 'append' })
  } }
  const previous = session.append('assistant/message', { turn: 1, step: 1, message: { id: 'old', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '上一轮正文' }] } }, { surfaceOp: 'append' })
  session.append('turn/start', { turn: 2 })
  const input = session.append('user/message', { id: 'input', role: 'user', source: { kind: 'user', rpcId: 'request' }, content: [{ type: 'text', text: '继续' }] }, { surfaceOp: 'append' })
  function response(content, { turn = 2, step = 1 } = {}) {
    session.append('step/start', { turn, step })
    session.append('assistant/message', { turn, step, message: { id: 'model-' + session.events.length, role: 'assistant', source: { kind: 'model' }, content } }, { surfaceOp: 'append' })
    for (const call of content.filter(block => block.type === 'tool-call')) {
      session.append('tool/call', { turn, step, callId: call.id, name: call.name, arguments: call.arguments })
      session.append('tool/result', { turn, step, message: { role: 'tool', toolCallId: call.id, isError: false, content: [{ type: 'text', text: '已提交' }] } }, { surfaceOp: 'append' })
    }
    session.append('step/end', { turn, step })
  }
  registerTurnLifecycleHooks({
    ctx: { on(name, handler) { handlers[name] = handler } },
    backgroundAgentRunner: { owns: () => false, requestContext: () => null },
    clearRuntimePresetRequestState() {}, fullTemplateRuntime: { cancel() {} },
    contentText: message => message?.content?.map(block => block.text || '').join('') || '',
    userMessageForTurn, requestIdForTurn,
    chatHeaderForSession: async () => ({ mode: 'story', storyToolCall: true }), storyToolCall: async () => false,
    foregroundHandoff: { finalize: async input => { finalized.push(input); return { reply: { sessionText: input.assistantText } } } },
    turnOrchestrator: { recordFailure: async failure => failures.push(failure) },
    replaceAssistantReply: foldStorySubmission
  })
  return { session, agent, response, corrections, finalized, failures, previous, input,
    stop: (turn = 2, signal = new AbortController().signal) => handlers['agent/turn-stopping']({ agent, turn, signal }) }
}

const prose = [{ type: 'text', text: '<game>完整正文</game>' }]
const submission = [{ type: 'tool-call', id: 'submission', name: 'submit_story', arguments: JSON.stringify({ content: prose[0].text }) }]

test('直接正文被拒收，同一回合纠正成功后只保存工具正文并收拢重复历史', async () => {
  const run = fixture()
  run.response(prose)
  await run.stop()
  assert.equal(run.finalized.length, 0)
  assert.equal(run.corrections.length, 1)
  assert.match(run.corrections[0].content[0].text, /调用 submit_story/)
  run.response(prose, { step: 2 })
  await run.stop()
  assert.equal(run.finalized.length, 0)
  run.response(submission, { step: 3 })
  await run.stop()
  assert.equal(run.finalized.length, 1)
  assert.equal(run.finalized[0].assistantText, prose[0].text)
  assert.equal(run.finalized[0].userText, '继续')
  assert.equal(run.finalized[0].requestId, 'request')
  assert.deepEqual(run.failures, [])
  const visible = run.session.surface.nodes.map(seq => run.session.events[seq])
  assert.deepEqual(visible.slice(0, 2), [run.previous, run.input])
  assert.equal(visible.length, 3)
  assert.deepEqual(visible[2].data.message.content, prose)
})

test('最多纠正两次，仍不提交时记录失败且不保存正文；新回合重新计数并尊重取消', async () => {
  const run = fixture()
  for (let step = 1; step <= 2; step++) {
    run.response(prose, { step })
    await run.stop()
  }
  run.response(prose, { step: 3 })
  await assert.rejects(run.stop(), /自动纠正 2 次/)
  assert.equal(run.corrections.length, 2)
  assert.equal(run.finalized.length, 0)
  assert.equal(run.failures[0].code, 'story-tool-required')
  run.session.append('turn/end', { turn: 2, reason: { kind: 'error' } })
  run.session.append('turn/start', { turn: 3 })
  run.session.append('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '重试' }] }, { surfaceOp: 'append' })
  run.response(prose, { turn: 3 })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(run.stop(3, controller.signal), { name: 'AbortError' })
  assert.equal(run.corrections.length, 2)
  await run.stop(3)
  assert.equal(run.corrections.length, 3)
})

test('关闭开关、卡片编辑、兼容模式及已成功提交的正文均不触发纠正', async () => {
  const run = fixture()
  let chat, enabled = true
  const guard = createStorySubmissionGuard({ chatForSession: async () => chat, enabled: async () => enabled })
  const payload = { agent: run.agent, turn: 2 }
  for (chat of [undefined, { mode: 'card', storyToolCall: true }, { mode: 'story', storyToolCall: false }, { mode: 'script', requestMode: 'sillytavern', storyToolCall: true }]) {
    assert.equal(await guard(payload, { text: '普通输出' }), false)
  }
  chat = { mode: 'story' }; enabled = false
  assert.equal(await guard(payload, { text: '普通输出' }), false)
  enabled = true
  assert.equal(await guard(payload, { text: '已提交', storyToolSubmission: true }), false)
  assert.deepEqual(run.corrections, [])
  await assert.rejects(guard({ agent: { session: run.session }, turn: 2 }, { text: '未提交' }), /不支持回合内纠正/)
})

test('纠正过程中插入的新玩家输入不会被正文收拢覆盖', async () => {
  const run = fixture()
  run.response(prose)
  await run.stop()
  const extraInput = run.session.append('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '补充要求' }] }, { surfaceOp: 'append' })
  run.response(submission, { step: 2 })
  foldStorySubmission(run.session, storySubmissionForTurn(run.session, 2), prose[0].text)
  assert.ok(run.session.surface.nodes.includes(extraInput.seq))
  assert.ok(run.session.surface.nodes.includes(run.input.seq))
  assert.ok(run.session.surface.nodes.includes(run.previous.seq))
})
