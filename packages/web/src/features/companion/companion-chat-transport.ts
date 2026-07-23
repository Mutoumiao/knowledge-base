/**
 * CompanionChatTransport — 将 Nest Companion SSE 映射为 AI SDK UIMessageChunk 流。
 *
 * 契约见 `packages/server/.../companion-sse.events.ts`：
 *   token → text-start/text-delta/text-end
 *   done  → finish
 *   error → error（保留已收 delta）
 *   summary/memories → data-* 侧车
 *   heartbeat → 忽略
 *
 * 超时：idle（两次 chunk 静默）+ overall（整次上限）；触发 Abort，不静默重放用户消息。
 */
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import { parseSseBlock } from './sse-client'

export type CompanionTransportBody = {
  conversationId: string
}

/** 产品 Web 默认：与 L1 验收同量级，略保守于管线慢路径 */
export const COMPANION_SSE_OVERALL_TIMEOUT_MS = 240_000
export const COMPANION_SSE_IDLE_TIMEOUT_MS = 120_000

function extractLastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    const parts = msg.parts ?? []
    const text = parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    if (text.trim()) return text.trim()
    // 兼容旧字段
    const legacy = (msg as { content?: string }).content
    if (typeof legacy === 'string' && legacy.trim()) return legacy.trim()
  }
  return ''
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController()
  const onAbort = () => {
    if (!ctrl.signal.aborted) ctrl.abort()
  }
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort()
      return ctrl.signal
    }
    s.addEventListener('abort', onAbort, { once: true })
  }
  return ctrl.signal
}

export class CompanionChatTransport implements ChatTransport<UIMessage> {
  private readonly baseUrl: string
  private readonly getConversationId: () => string
  private readonly overallTimeoutMs: number
  private readonly idleTimeoutMs: number

  constructor(options?: {
    baseUrl?: string
    /** 动态读取当前会话 ID（创建会话后更新） */
    getConversationId?: () => string
    /** 整次请求上限（ms），0 关闭 */
    overallTimeoutMs?: number
    /** 两次收到数据间静默上限（ms），0 关闭 */
    idleTimeoutMs?: number
  }) {
    this.baseUrl = options?.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api'
    this.getConversationId = options?.getConversationId ?? (() => '')
    this.overallTimeoutMs = options?.overallTimeoutMs ?? COMPANION_SSE_OVERALL_TIMEOUT_MS
    this.idleTimeoutMs = options?.idleTimeoutMs ?? COMPANION_SSE_IDLE_TIMEOUT_MS
  }

  async sendMessages(options: {
    trigger: 'submit-message' | 'regenerate-message'
    chatId: string
    messageId: string | undefined
    messages: UIMessage[]
    abortSignal: AbortSignal | undefined
    headers?: Record<string, string> | Headers
    body?: object
    metadata?: unknown
  }): Promise<ReadableStream<UIMessageChunk>> {
    const bodyObj = (options.body ?? {}) as Partial<CompanionTransportBody>
    const conversationId = bodyObj.conversationId || this.getConversationId() || options.chatId
    const content = extractLastUserText(options.messages)

    if (!conversationId) {
      throw new Error('缺少 conversationId，无法发起 Companion 对话')
    }
    if (!content) {
      throw new Error('消息内容为空')
    }

    const timeoutCtrl = new AbortController()
    let overallTimer: ReturnType<typeof setTimeout> | undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimeouts = () => {
      if (overallTimer !== undefined) clearTimeout(overallTimer)
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      overallTimer = undefined
      idleTimer = undefined
    }

    const armIdle = () => {
      if (this.idleTimeoutMs <= 0) return
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort()
      }, this.idleTimeoutMs)
    }

    if (this.overallTimeoutMs > 0) {
      overallTimer = setTimeout(() => {
        if (!timeoutCtrl.signal.aborted) timeoutCtrl.abort()
      }, this.overallTimeoutMs)
    }
    armIdle()

    const signals = [timeoutCtrl.signal]
    if (options.abortSignal) signals.push(options.abortSignal)
    const signal = mergeAbortSignals(signals)

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/companion/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string> | undefined),
        },
        body: JSON.stringify({ conversationId, content }),
        credentials: 'include',
        signal,
      })
    } catch (err) {
      clearTimeouts()
      throw err
    }

    if (!response.ok) {
      clearTimeouts()
      throw new Error(`Companion SSE 请求失败: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      clearTimeouts()
      throw new Error('ReadableStream 不可用')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    const textId = `text-${Date.now()}`
    let textStarted = false
    let finished = false

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        const enqueue = (chunk: UIMessageChunk) => {
          if (finished) return
          controller.enqueue(chunk)
        }

        const ensureTextStart = () => {
          if (!textStarted) {
            textStarted = true
            enqueue({ type: 'text-start', id: textId })
          }
        }

        const finishText = () => {
          if (textStarted) {
            enqueue({ type: 'text-end', id: textId })
          }
        }

        const finishAsError = (errorText: string) => {
          finishText()
          enqueue({ type: 'error', errorText })
          enqueue({ type: 'finish', finishReason: 'error' })
          finished = true
          clearTimeouts()
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            armIdle()

            buffer += decoder.decode(value, { stream: true })
            const parts = buffer.split(/\r?\n\r?\n/)
            buffer = parts.pop() ?? ''

            for (const block of parts) {
              const event = parseSseBlock(block)
              if (!event) continue

              if (event.event === 'token') {
                const delta = typeof event.data === 'string' ? event.data : String(event.data ?? '')
                if (!delta) continue
                ensureTextStart()
                enqueue({ type: 'text-delta', id: textId, delta })
              } else if (event.event === 'done') {
                const data = event.data as {
                  content?: string
                  fullReply?: string
                }
                // 若未收到 token 但 done 带全文，补一次 delta
                const full = (data.content || data.fullReply || '').trim()
                // 服务端偶发空 done：展示错误，禁止当成功结束（不自动静默重放）
                if (!textStarted && !full) {
                  finishAsError('助手未生成有效回复，请重试')
                  return
                }
                if (!textStarted && full) {
                  ensureTextStart()
                  enqueue({ type: 'text-delta', id: textId, delta: full })
                }
                finishText()
                enqueue({ type: 'finish', finishReason: 'stop' })
                finished = true
                clearTimeouts()
                controller.close()
                return
              } else if (event.event === 'error') {
                const errData = event.data as { message?: string }
                // 保留已收部分内容：不回滚 text，仅附加 error 并 finish
                finishAsError(errData?.message || 'AI 回复出错')
                return
              } else if (event.event === 'summary') {
                const data = event.data as { summary?: string }
                enqueue({
                  type: 'data-summary',
                  data: { summary: data.summary ?? '' },
                } as UIMessageChunk)
              } else if (event.event === 'memories') {
                const data = event.data as { items?: unknown }
                enqueue({
                  type: 'data-memories',
                  data: { items: data.items ?? [] },
                } as UIMessageChunk)
              }
              // heartbeat / unknown → ignore
            }
          }

          if (buffer.trim()) {
            const event = parseSseBlock(buffer)
            if (event?.event === 'token') {
              const delta = typeof event.data === 'string' ? event.data : String(event.data ?? '')
              if (delta) {
                ensureTextStart()
                enqueue({ type: 'text-delta', id: textId, delta })
              }
            }
          }

          // 流结束但无 done/error：禁止静默成功
          if (!finished) {
            finishAsError(
              textStarted
                ? '连接中断，请重试'
                : '连接中断，助手未生成有效回复，请重试',
            )
          }
        } catch (err) {
          if (!finished) {
            const isAbort =
              (err instanceof Error && err.name === 'AbortError') ||
              (typeof err === 'object' &&
                err !== null &&
                'name' in err &&
                (err as { name?: string }).name === 'AbortError') ||
              timeoutCtrl.signal.aborted
            finishAsError(
              isAbort
                ? '请求超时或已取消，请重试'
                : err instanceof Error
                  ? err.message
                  : String(err),
            )
          }
        } finally {
          clearTimeouts()
          try {
            reader.releaseLock()
          } catch {
            /* ignore */
          }
        }
      },
      cancel() {
        clearTimeouts()
        timeoutCtrl.abort()
        reader.cancel().catch(() => undefined)
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // Companion SSE 无服务端可恢复流
    return null
  }
}
