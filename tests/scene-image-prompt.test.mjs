import assert from 'node:assert/strict'
import test from 'node:test'
import { imagePromptPlan } from '../tavern-plugin/lib/domain/scene-image-prompt.js'
import { readSceneTaskInstruction, readScenePlanInstruction, readSceneAdjustmentInstruction } from '../tavern-plugin/lib/scene-image-prompts.js'

test('完整生图提示词原样保存，保留调整来源和画面锚点，标识随内容变化', () => {
  const prompt = '  cinematic light, (rain:1.2)\n人物背影，夕阳  '
  const previous = { id: 'previous', description: '原画', anchor: { turn: 2 }, moment: '推开窗户' }
  const before = structuredClone(previous)
  const args = { positive_prompt: prompt }
  const plan = imagePromptPlan(args, 'tags-a', previous)
  assert.equal(plan.prompt, prompt)
  assert.equal(plan.promptMode, 'direct')
  assert.equal(plan.description, '原画')
  assert.deepEqual(plan.anchor, previous.anchor)
  assert.equal(plan.moment, previous.moment)
  assert.equal(plan.basedOn, 'previous')
  assert.ok(plan.blocks.length)
  assert.ok(plan.blocks.every(block => block.text === prompt && block.tags === prompt))
  assert.equal(imagePromptPlan(args, 'tags-a', previous).id, plan.id)
  assert.notEqual(imagePromptPlan({ positive_prompt: prompt + ' new' }, 'tags-a', previous).id, plan.id)
  assert.equal(imagePromptPlan({ ...args, description: '新画' }, 'tags-a', previous).description, '新画')
  assert.deepEqual(previous, before)
})

test('完整提示词拒绝空值、过长及旧式拼接字段，不丢弃错误后继续生图', () => {
  for (const args of [null, [], {}, { positive_prompt: '  ' }, { positive_prompt: 1 },
    { positive_prompt: 'x'.repeat(12001) }, { positive_prompt: 'ok', description: 'x'.repeat(1001) },
    { positive_prompt: 'ok', description: null }, { positive_prompt: 'ok', characters: [] }]) {
    assert.throws(() => imagePromptPlan(args, 'tags-a'), /参数内容错误/)
  }
  assert.equal(imagePromptPlan({ positive_prompt: 'x'.repeat(12000), description: 'x'.repeat(1000) }, 'tags-a').prompt.length, 12000)
})

for (const adjustment of [false, true]) test(`完整提示词模式采用对应默认规则，但保留自定义任务提示词（调整=${adjustment}）`, () => {
  const builtin = adjustment ? readSceneAdjustmentInstruction() : readScenePlanInstruction()
  assert.equal(readSceneTaskInstruction({ adjustment }), builtin)
  const direct = readSceneTaskInstruction({ adjustment, directPromptOnly: true })
  assert.match(direct, /submit_image_prompt/)
  assert.notEqual(direct, builtin)
  assert.equal(readSceneTaskInstruction({ adjustment, directPromptOnly: true, prompt: () => builtin }), direct)
  let requested
  const custom = readSceneTaskInstruction({ adjustment, directPromptOnly: true, prompt: name => { requested = name; return '我的生图规则' } })
  assert.equal(custom, '我的生图规则')
  assert.equal(requested, adjustment ? 'scene-image-adjustment' : 'scene-plan')
})
