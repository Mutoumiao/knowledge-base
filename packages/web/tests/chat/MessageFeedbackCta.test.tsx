import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageFeedbackCta } from '@/features/chat/components/MessageFeedbackCta'

const submitChatMessageFeedback = vi.fn()

vi.mock('@/api/chat', () => ({
  submitChatMessageFeedback: (...args: unknown[]) => submitChatMessageFeedback(...args),
}))

describe('MessageFeedbackCta (Chat only)', () => {
  beforeEach(() => {
    submitChatMessageFeedback.mockReset()
    submitChatMessageFeedback.mockResolvedValue({
      ok: true,
      messageId: 'msg-1',
      rating: 'helpful',
    })
  })

  it('renders CTA with helpful / not-helpful controls', () => {
    render(<MessageFeedbackCta messageId="msg-1" sessionId="sess-1" traceId="t-1" />)
    expect(screen.getByTestId('chat-feedback-cta')).toBeTruthy()
    expect(screen.getByTestId('chat-feedback-helpful').textContent).toContain('有帮助')
    expect(screen.getByTestId('chat-feedback-not-helpful').textContent).toContain('没帮助')
  })

  it('submits helpful rating and shows thanks', async () => {
    const user = userEvent.setup()
    render(<MessageFeedbackCta messageId="msg-1" sessionId="sess-1" traceId="t-1" />)
    await user.click(screen.getByTestId('chat-feedback-helpful'))
    await waitFor(() => {
      expect(submitChatMessageFeedback).toHaveBeenCalledWith({
        messageId: 'msg-1',
        sessionId: 'sess-1',
        rating: 'helpful',
        reason: undefined,
        traceId: 't-1',
      })
    })
    expect(screen.getByTestId('chat-feedback-thanks').textContent).toContain('感谢反馈')
  })

  it('shows reason chips for not_helpful then submits', async () => {
    const user = userEvent.setup()
    submitChatMessageFeedback.mockResolvedValue({
      ok: true,
      messageId: 'msg-1',
      rating: 'not_helpful',
    })
    render(<MessageFeedbackCta messageId="msg-1" sessionId="sess-1" />)
    await user.click(screen.getByTestId('chat-feedback-not-helpful'))
    expect(screen.getByTestId('chat-feedback-reasons')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '答非所问' }))
    await waitFor(() => {
      expect(submitChatMessageFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          rating: 'not_helpful',
          reason: '答非所问',
        }),
      )
    })
    expect(screen.getByTestId('chat-feedback-thanks').textContent).toContain('已记录')
  })

  it('returns null without messageId/sessionId', () => {
    const { container } = render(<MessageFeedbackCta messageId="" sessionId="s" />)
    expect(container.firstChild).toBeNull()
  })
})
