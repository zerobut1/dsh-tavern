import { applyMvuSettlementEffect } from './mvu-settlement-effect.js'

/** Explicit player requests use the current snapshot and the native MVU transaction. */
export function createBackgroundCommand({ store, beginTask, settle, prepare = async () => ({}), selection, onError = console.error }) {
  const jobs = new Map()
  function project(chat) {
    const state = chat.backgroundCommandTask || { status: 'idle' }
    const task = state.status === 'running' && !jobs.has(chat.id)
      ? { ...state, status: 'failed', error: '后台指令已中断，请重试。' } : state
    return { ...task, available: chat.mvu?.enabled === true && chat.mvu.owner === 'official' }
  }
  async function start({ sessionId, instruction }) {
    const command = String(instruction || '').trim()
    if (!command || command.length > 4000) throw new Error('请输入 1–4000 字的后台指令')
    const chat = await store.chatForSession(sessionId)
    if (!chat) throw new Error('对话不存在')
    if (!project(chat).available) throw new Error('后台指令需要人物卡启用原生 MVU 变量')
    if (jobs.has(chat.id)) throw new Error('后台指令正在执行')
    const model = selection(chat)
    if (!model) throw new Error('请先选择后台模型')
    const job = { controller: new AbortController(), promise: null }
    jobs.set(chat.id, job)
    let task
    try {
      task = await beginTask(chat, sessionId)
      const snapshot = task.chat
      let messageId = snapshot.messages.length - 1
      while (messageId >= 0 && snapshot.messages[messageId]?.role !== 'assistant') messageId--
      const message = snapshot.messages[messageId]
      const swipeId = Math.max(0, Number(message?.swipeId) || 0)
      const variables = message?.variables?.[swipeId]
      if (!variables?.stat_data || !variables?.schema) throw new Error('当前回复尚无 MVU 变量快照，请完成初始化和结算后再执行')
      if (message.mvu?.pendingSubmission) throw new Error('当前回复仍有待执行的变量结算，请先完成或停止后台')
      await task.checkpoint(draft => {
        draft.backgroundCommandTask = { status: 'running', instruction: command, operationId: task.operationId, error: '' }
      })
      job.promise = execute(snapshot, { messageId, swipeId, variables }, command, model, task, job.controller.signal)
        .catch(onError).finally(() => { if (jobs.get(chat.id) === job) jobs.delete(chat.id) })
      return { status: 'running', operationId: task.operationId }
    } catch (error) {
      jobs.delete(chat.id)
      if (task) await task.fail()
      throw error
    }
  }
  async function execute(chat, target, instruction, model, task, signal) {
    let result
    try {
      const context = await prepare(chat, target)
      signal.throwIfAborted()
      result = await settle({
        ...context, instruction, selection: model, signal,
        backgroundTasks: { variables: true, posture: false, characterDesign: false },
        persistentSessionId: task.participantRequest.sessionId,
        onPersistentSessionReady: id => task.bindSession(id, { stateOnly: true }),
        operationId: task.operationId, chatId: chat.id, sessionId: chat.sessionId,
        branchId: task.basedOn.branchId, basedOnRevision: task.basedOn.revision,
        messageId: target.messageId, swipeId: target.swipeId,
        expectedLifecycleRevision: Number(chat.tavernHelperLifecycleRevision) || 0,
        currentVariables: target.variables, variableSchema: target.variables.schema
      })
      signal.throwIfAborted()
      if (!['updated', 'unchanged'].includes(result.receipt?.status)) {
        throw new Error(result.receipt?.status === 'pending'
          ? 'MVU 执行器尚未就绪，本次未写入；请保持角色卡页面打开后重试。'
          : result.receipt?.summary || result.receipt?.failures?.map(item => item.path + '：' + item.message).join('；') || '变量更新失败，本次未写入')
      }
      if (!result.effect) throw new Error('MVU 未返回可提交的变量结果，本次未写入')
      const completed = await task.commit({ participant: task.participant(result), stateChanged: result.effect.changes.length > 0,
        apply: draft => {
          signal.throwIfAborted()
          applyMvuSettlementEffect(draft, result.effect)
          draft.backgroundCommandTask = { status: 'done', instruction, operationId: task.operationId, receipt: result.receipt, error: '' }
        } })
      if (completed.status !== 'committed') throw new Error('对话状态已变化，本次指令未写入，请重试。')
    } catch (error) {
      await task.fail(result)
      await store.updateChat(chat.id, draft => {
        if (draft.backgroundCommandTask?.operationId === task.operationId) {
          draft.backgroundCommandTask = { ...draft.backgroundCommandTask, status: 'failed', error: signal.aborted ? '后台指令已停止，本次未写入。' : String(error.message || error) }
        }
        return draft
      })
    }
  }
  return { start, project, stop: chatId => jobs.get(chatId)?.controller.abort(), wait: chatId => jobs.get(chatId)?.promise }
}
