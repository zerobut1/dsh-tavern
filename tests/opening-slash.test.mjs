import test from 'node:test'
import assert from 'node:assert/strict'

import {createOpeningPreparation} from '../tavern-plugin/lib/domain/opening-preparation.js'
import {initializationFixture} from './fixtures/conversation-initialization.mjs'
import {nativeOpeningMessageId} from '../tavern-plugin/lib/domain/native-opening.js'
import {consumeScriptPrompts, scriptPromptFrameInputs} from '../tavern-plugin/lib/domain/tavern-script-prompts.js'

test('pre-game sys/cut/trigger removes only the wizard and carries MVU into the new game', async () => {
  const h=initializationFixture()
  h.state.extensions={mvuResources:[{name:'MVU'}]}
  const service=createOpeningPreparation({readCard:async()=>h.card,worldBooks:{bound:async()=>null}})
  const draft=await service.create(h.card.path,{runtime:true})
  const variables={stat_data:{name:'example',realm:3},schema:{}}
  await service.callRuntime(draft.id,'updateTavernHelperVariables',{variables,option:{type:'message',message_id:0,swipe_id:1}})
  const line='/sys Name: example\nRealm: 3 | /cut 0 | /trigger'
  const plan=await service.callRuntime(draft.id,'prepareOpeningCommand',{line,openingId:'alternate:0'})
  assert.equal(plan.input,'继续。')
  assert.equal(service.resolve(draft.id,h.card.path,'primary').startCommand,undefined)
  const prepared=service.resolve(draft.id,h.card.path,'alternate:0')
  const chat=await h.make().start({...h.input,openingId:'alternate:0',preparation:prepared})
  assert.equal(chat.openingText,'')
  assert.equal(chat.messages.some(m=>m.greeting),false)
  assert.equal(chat.messages[0].role,'system')
  assert.equal(chat.messages[0].text,'Name: example\nRealm: 3')
  assert.deepEqual(chat.messages[0].variables[0],variables)
  const nativeOpening = () => h.session().durable.filter(e=>e.data?.message?.id===nativeOpeningMessageId(chat.id))
  assert.equal(nativeOpening().length,1)
  assert.equal(nativeOpening()[0].data.message.role,'assistant','/sys is a lasting narrator in native history')
  assert.equal(nativeOpening()[0].data.message.content[0].text,'Name: example\nRealm: 3')
  consumeScriptPrompts(chat)
  assert.deepEqual(scriptPromptFrameInputs(chat),[],'opening data does not depend on a consumed Frame')
  await h.make().ensureOpening('session')
  assert.equal(nativeOpening().length,1,'reopening does not duplicate the narrator')
  assert.deepEqual(chat.messages[0].variables[0],variables,'native projection does not reset the MVU baseline')
  const before=service.resolve(draft.id,h.card.path,'primary')
  for(const bad of ['/sys x | /cut 1 | /trigger','/sys x | /unknown | /trigger','/sys x | /cut 0','/send x | /cut 0 | /trigger']) {
    await assert.rejects(service.callRuntime(draft.id,'prepareOpeningCommand',{line:bad}))
    assert.deepEqual(service.resolve(draft.id,h.card.path,'primary'),before)
  }
})

test('a card opening form replaces the greeting: nothing shown or sent, opening variables kept', async () => {
  for (const viaForm of [true, false]) {
    const h=initializationFixture()
    h.state.extensions={openingSetup:{form:'<form></form>'}}
    const service=createOpeningPreparation({readCard:async()=>h.card,worldBooks:{bound:async()=>null}})
    const draft=await service.create(h.card.path,{})
    if (viaForm) await service.callRuntime(draft.id,'prepareOpeningCommand',{line:'/send {"type":"LAUNCH"}|/trigger'})
    const chat=await h.make().start({...h.input,preparation:service.resolve(draft.id,h.card.path,'primary')})
    const greeting=chat.messages.find(m=>m.greeting)
    assert.equal(greeting.text,'\u3000')
    assert.equal(greeting.displayText,'\u3000')
    const opening=h.session().events.find(e=>e.data?.message?.source?.model==='character-card')
    assert.equal(opening.data.message.content[0].text,'\u3000')
  }
})

test('split /send and /trigger await=true carries opening script prompts into the new game', async () => {
  const h = initializationFixture()
  const service = createOpeningPreparation({ readCard: async () => h.card, worldBooks: { bound: async () => null } })
  const draft = await service.create(h.card.path, {})
  const staged = await service.callRuntime(draft.id, 'prepareOpeningCommand', { line: '/send 呼叫墨池渊' })
  assert.equal(staged.deferred, true)
  await service.callRuntime(draft.id, 'updateTavernHelperPrompts', {
    operation: { kind: 'inject', once: true, prompts: [{ id: 'character-locations', content: '当前登场角色：墨池渊', role: 'system', position: 'in_chat', depth: 0 }] }
  })
  const plan = await service.callRuntime(draft.id, 'prepareOpeningCommand', { line: '/trigger await=true' })
  assert.equal(plan.deferred, false)
  assert.equal(plan.input, '呼叫墨池渊')
  const chat = await h.make().start({ ...h.input, preparation: service.resolve(draft.id, h.card.path, 'primary') })
  assert.equal(chat.tavernScriptPrompts?.length, 1)
  assert.equal(chat.tavernScriptPrompts[0].id, 'character-locations')
  if (chat.tavernScriptPrompts) {
    assert.equal(chat.tavernScriptPrompts[0].once, true)
  }
})

test('/sys without /cut keeps greeting then narrator in the native opening, with no one-shot duplicate', async () => {
  const h=initializationFixture()
  const service=createOpeningPreparation({readCard:async()=>h.card,worldBooks:{bound:async()=>null}})
  const draft=await service.create(h.card.path)
  await service.callRuntime(draft.id,'prepareOpeningCommand',{line:'/sys 灵根：火；境界：练气一层 | /trigger'})
  const chat=await h.make().start({...h.input,preparation:service.resolve(draft.id,h.card.path)})
  const opening=h.session().durable.find(e=>e.data?.message?.id===nativeOpeningMessageId(chat.id))
  assert.equal(opening.data.message.content[0].text,'玩家，你好。\n\n灵根：火；境界：练气一层')
  assert.equal(chat.messages[0].greeting,true)
  assert.equal(chat.messages[1].role,'system')
  assert.deepEqual(scriptPromptFrameInputs(chat),[])
})

test('各备选开场的变量读写隔离，交接使用所选开场的最新数据', async t => {
  const card = { path: 'card.json', name: '测试角色', first_mes: '开场', alternate_greetings: ['造人'] }
  const service = createOpeningPreparation({ readCard: async () => card, worldBooks: { bound: async () => null } })
  t.after(() => service.dispose())
  const draft = await service.create(card.path, { runtime: true })
  const defaults = { stat_data: { 境界: '凡人' }, schema: {} }
  await service.callRuntime(draft.id, 'updateTavernHelperVariables', { variables: defaults, option: { type: 'message', message_id: 0 } })
  const selected = await service.callRuntime(draft.id, 'getTavernHelperContext', { openingId: 'alternate:0' })
  assert.equal(selected.context.messages[0].swipe_id, 1)
  const chosen = { stat_data: { 境界: '练气一层' }, schema: {} }
  await service.callRuntime(draft.id, 'updateTavernHelperVariables', { variables: chosen, option: { type: 'message', message_id: 0 } })
  assert.deepEqual(service.resolve(draft.id, card.path, 'alternate:0').messageVariables, chosen)
  assert.deepEqual(service.resolve(draft.id, card.path, 'primary').messageVariables, defaults)
  const reopened = await service.callRuntime(draft.id, 'getTavernHelperContext', { openingId: 'alternate:0' })
  assert.deepEqual(reopened.context.messages[0].variables, chosen)
})
