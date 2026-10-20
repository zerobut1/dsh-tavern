import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage } from '@assistant-ui/react'
import { ChatGPT } from './chatgpt'
import './mobile.css'
import { browserRequestId } from '../../lib/domain/browser-request-id.js'

type Message = { id: string; role: 'user' | 'assistant'; text: string }
type State = { sessionId: string; chatId: string; title: string; revision: number; busy: boolean; error?: string; messages?: Message[] }
async function rpc(method: string, args: object = {}) {
  const response = await fetch('/api/dsh-tavern/mobile.' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  if (!response.ok) throw new Error('连接失败，请从手机入口重新进入酒馆')
  const result = await response.json()
  if (!result.ok) throw new Error(result.error || '请求失败')
  return result as State
}

function App() {
  const [state, setState] = useState<State | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const latest = useRef<State | null>(null)
  const alive = useRef(true)
  const reading = useRef(false)
  const refresh = useCallback(async () => {
    if (reading.current) return
    reading.current = true
    try {
      const current = latest.current
      const next = await rpc('read', { sessionId: current?.sessionId || new URL(location.href).searchParams.get('session'), revision: current?.revision })
      if (!alive.current) return
      latest.current = next
      setState(next)
      if (next.messages) setMessages(next.messages)
      setError(next.error || '')
    } catch (failure) {
      if (alive.current) setError(String((failure as Error).message || failure))
    } finally { reading.current = false }
  }, [])
  useEffect(() => {
    alive.current = true
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 1500)
    const resume = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => { alive.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume) }
  }, [refresh])
  useEffect(() => {
    const viewport = window.visualViewport
    const resize = () => document.documentElement.style.setProperty('--app-height', `${viewport?.height || innerHeight}px`)
    resize(); viewport?.addEventListener('resize', resize)
    return () => viewport?.removeEventListener('resize', resize)
  }, [])
  const onNew = useCallback(async (message: AppendMessage) => {
    const current = latest.current
    if (!current || current.busy) throw new Error('请等待当前请求完成')
    const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    setSending(true); setError('')
    try {
      await rpc('send', { sessionId: current.sessionId, chatId: current.chatId, revision: current.revision, requestId: browserRequestId(), text })
      await refresh()
    } catch (failure) { setError(String((failure as Error).message || failure)); throw failure }
    finally { setSending(false) }
  }, [refresh])
  const busy = sending || !state || state.busy
  const runtime = useExternalStoreRuntime({
    messages, isRunning: busy, onNew,
    convertMessage: message => ({ id: message.id, role: message.role, content: [{ type: 'text' as const, text: message.text }] }),
  })
  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="mobile-app">
      <header className="app-header">
        <span className="app-title">{statusOpen ? '状态栏' : state?.title || 'DSH Tavern'}</span>
        <button type="button" disabled={!state} onClick={() => setStatusOpen(value => !value)}>{statusOpen ? '返回聊天' : '状态栏'}</button>
      </header>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="chat-page" hidden={statusOpen}><ChatGPT busy={busy} /></div>
      {statusOpen && state && <iframe className="status-frame" title="角色卡状态栏" src={`/?tavern-mobile-status=${encodeURIComponent(state.sessionId)}`} />}
    </div>
  </AssistantRuntimeProvider>
}

createRoot(document.getElementById('root')!).render(<App />)
