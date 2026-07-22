import { useState } from 'react'
import { cn } from '@/lib/utils'
import { submitChatMessageFeedback } from '@/api/chat'

const NEGATIVE_REASONS = [
  { id: 'wrong', label: '答非所问' },
  { id: 'empty', label: '没有依据' },
  { id: 'incomplete', label: '不完整' },
  { id: 'other', label: '其他' },
] as const

export interface MessageFeedbackCtaProps {
  messageId: string
  sessionId: string
  /** 可选：消息 metadata 中的 obs_trace_id */
  traceId?: string
  disabled?: boolean
}

/**
 * 仅知识库问答（Chat）显式反馈 CTA。Companion 不上该组件。
 */
export function MessageFeedbackCta({
  messageId,
  sessionId,
  traceId,
  disabled,
}: MessageFeedbackCtaProps) {
  const [sent, setSent] = useState<'helpful' | 'not_helpful' | null>(null)
  const [showReasons, setShowReasons] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!messageId || !sessionId) return null

  const submit = async (rating: 'helpful' | 'not_helpful', reason?: string) => {
    setPending(true)
    setError(null)
    try {
      await submitChatMessageFeedback({
        messageId,
        sessionId,
        rating,
        reason,
        traceId,
      })
      setSent(rating)
      setShowReasons(false)
    } catch {
      setError('反馈提交失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <p className="mt-2 text-xs text-text-secondary" data-testid="chat-feedback-thanks">
        {sent === 'helpful' ? '感谢反馈' : '已记录，我们会改进'}
      </p>
    )
  }

  return (
    <div className="mt-2 space-y-1.5" data-testid="chat-feedback-cta">
      <p className="text-xs text-text-secondary">这条回答有帮助吗？</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || pending}
          data-testid="chat-feedback-helpful"
          className={cn(
            'rounded-full border border-border px-2.5 py-0.5 text-xs',
            'hover:bg-muted disabled:opacity-50',
          )}
          onClick={() => void submit('helpful')}
        >
          有帮助
        </button>
        <button
          type="button"
          disabled={disabled || pending}
          data-testid="chat-feedback-not-helpful"
          className={cn(
            'rounded-full border border-border px-2.5 py-0.5 text-xs',
            'hover:bg-muted disabled:opacity-50',
          )}
          onClick={() => setShowReasons(true)}
        >
          没帮助
        </button>
      </div>
      {showReasons && (
        <div className="flex flex-wrap gap-1.5" data-testid="chat-feedback-reasons">
          {NEGATIVE_REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={pending}
              className="rounded-md bg-muted px-2 py-0.5 text-xs hover:opacity-90"
              onClick={() => void submit('not_helpful', r.label)}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
