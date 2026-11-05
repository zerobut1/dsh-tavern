/** Manual edits replace current posture only; history and task settings stay intact. */
export function createPostureEditor({ readChat, updateChat, isBusy }) {
  function requirePlay(chat) {
    if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('请先打开游玩会话')
  }
  return async function savePosture({ sessionId, posture, expectedPosture } = {}) {
    if (typeof posture !== 'string' || typeof expectedPosture !== 'string') throw new Error('保存前请先读取人物姿势')
    const chat = await readChat(sessionId)
    requirePlay(chat)
    const saved = await updateChat(chat.id, async current => {
      requirePlay(current)
      if (await isBusy(sessionId)) throw new Error('请等待当前生成和后台任务结束后修改人物姿势')
      if ((current.posture || '') !== expectedPosture) throw new Error('人物姿势已更新，请载入最新状态后再编辑')
      return { ...current, posture: posture.trim() }
    }, { source: 'posture.edit' })
    return { posture: saved.posture || '' }
  }
}
