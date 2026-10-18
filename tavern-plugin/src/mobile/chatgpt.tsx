// Adapted from assistant-ui's MIT-licensed ChatGPT Clone example.
// https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/components/pages/examples/chatgpt.tsx
import { AuiIf, ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'

const UserMessage = () => <MessagePrimitive.Root className="user-message">
  <div className="user-bubble"><MessagePrimitive.Parts /></div>
</MessagePrimitive.Root>

const AssistantMessage = () => <MessagePrimitive.Root className="assistant-message">
  <MessagePrimitive.Parts components={{ Text: MarkdownTextPrimitive }} />
</MessagePrimitive.Root>

export function ChatGPT({ busy }: { busy: boolean }) {
  return <ThreadPrimitive.Root className="chat-thread">
    <ThreadPrimitive.Viewport className="chat-viewport">
      <AuiIf condition={s => s.thread.isEmpty}><div className="empty-state">从这里继续故事</div></AuiIf>
      <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      <ThreadPrimitive.ViewportFooter className="chat-footer">
        {busy && <div className="activity" role="status">正在生成或结算…</div>}
        <ComposerPrimitive.Root className="composer">
          <ComposerPrimitive.Input placeholder="发送消息" aria-label="消息" rows={1} disabled={busy} />
          <ComposerPrimitive.Send aria-label="发送" disabled={busy}>
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 20V4M5 11l7-7 7 7" /></svg>
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>
}
