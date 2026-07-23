/**
 * UT-TR-*: CompanionChatTransport SSE → UIMessageChunk 映射
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionChatTransport } from '../src/features/companion/companion-chat-transport'
import type { UIMessage } from 'ai'

function ssePayload(blocks: string[]): string {
  return blocks.join('\n\n') + '\n\n'
}

function mockFetchStream(chunks: string[], status = 200) {
  const encoder = new TextEncoder()
  return vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
    let i = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (init?.signal?.aborted) {
          controller.error(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
          return
        }
        if (i < chunks.length) {
          controller.enqueue(encoder.encode(chunks[i++]))
        } else {
          controller.close()
        }
      },
      cancel() {
        /* ignore */
      },
    })
    if (init?.signal) {
      init.signal.addEventListener(
        'abort',
        () => {
          try {
            void stream.cancel()
          } catch {
            /* ignore */
          }
        },
        { once: true },
      )
    }
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      body: stream,
    })
  })
}

async function collect(stream: ReadableStream<unknown>) {
  const out: unknown[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

const userMsg = {
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text: '你好' }],
} as UIMessage

describe('UT-TR: CompanionChatTransport', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('UT-TR-map-token-done: token deltas then finish', async () => {
    globalThis.fetch = mockFetchStream([
      ssePayload([
        'event: token\ndata: {"delta":"你"}',
        'event: token\ndata: {"delta":"好"}',
        'event: done\ndata: {"fullReply":"你好","content":"你好"}',
      ]),
    ])

    const transport = new CompanionChatTransport({
      getConversationId: () => 'conv-1',
      overallTimeoutMs: 0,
      idleTimeoutMs: 0,
    })
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMsg],
      abortSignal: undefined,
      body: { conversationId: 'conv-1' },
    })

    const chunks = await collect(stream)
    const types = chunks.map((c) => (c as { type: string }).type)
    expect(types).toContain('text-start')
    expect(types).toContain('text-delta')
    expect(types).toContain('text-end')
    expect(types).toContain('finish')

    const deltas = chunks
      .filter((c) => (c as { type: string }).type === 'text-delta')
      .map((c) => (c as { delta: string }).delta)
    expect(deltas.join('')).toBe('你好')
  })

  it('UT-TR-partial-error: error after tokens still finishes and keeps error chunk', async () => {
    globalThis.fetch = mockFetchStream([
      ssePayload([
        'event: token\ndata: {"delta":"部分"}',
        'event: error\ndata: {"message":"服务异常","code":"ERR_LLM_PARSE"}',
      ]),
    ])

    const transport = new CompanionChatTransport({
      getConversationId: () => 'conv-1',
      overallTimeoutMs: 0,
      idleTimeoutMs: 0,
    })
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMsg],
      abortSignal: undefined,
      body: { conversationId: 'conv-1' },
    })

    const chunks = await collect(stream)
    const types = chunks.map((c) => (c as { type: string }).type)
    expect(types).toContain('text-delta')
    expect(types).toContain('error')
    expect(types).toContain('finish')
    const err = chunks.find((c) => (c as { type: string }).type === 'error') as {
      errorText: string
    }
    expect(err.errorText).toContain('服务异常')
  })

  it('UT-TR-map-http-error: non-ok response throws', async () => {
    globalThis.fetch = mockFetchStream([], 500)
    const transport = new CompanionChatTransport({
      getConversationId: () => 'conv-1',
      overallTimeoutMs: 0,
      idleTimeoutMs: 0,
    })
    await expect(
      transport.sendMessages({
        trigger: 'submit-message',
        chatId: 'chat-1',
        messageId: undefined,
        messages: [userMsg],
        abortSignal: undefined,
        body: { conversationId: 'conv-1' },
      }),
    ).rejects.toThrow(/500/)
  })

  it('UT-TR-empty-done: 空 done 映射为 error，不静默成功', async () => {
    globalThis.fetch = mockFetchStream([
      ssePayload(['event: done\ndata: {"fullReply":"","content":""}']),
    ])

    const transport = new CompanionChatTransport({
      getConversationId: () => 'conv-1',
      overallTimeoutMs: 0,
      idleTimeoutMs: 0,
    })
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMsg],
      abortSignal: undefined,
      body: { conversationId: 'conv-1' },
    })

    const chunks = await collect(stream)
    const types = chunks.map((c) => (c as { type: string }).type)
    expect(types).toContain('error')
    expect(types).toContain('finish')
    expect(types).not.toContain('text-delta')
    const err = chunks.find((c) => (c as { type: string }).type === 'error') as {
      errorText: string
    }
    expect(err.errorText).toMatch(/未生成有效回复|重试/)
  })

  it('UT-TR-done-then-error: 仅 error 时为 error finish；非空 done 后不再读后续（契约：服务端不得先 done 再 error）', async () => {
    // 服务端现已只发 error；客户端对纯 error 路径必须 error finish
    globalThis.fetch = mockFetchStream([
      ssePayload(['event: error\ndata: {"message":"请求超时或已中断，请重试","code":"ERR_LLM_TIMEOUT"}']),
    ])

    const transport = new CompanionChatTransport({
      getConversationId: () => 'conv-1',
      overallTimeoutMs: 0,
      idleTimeoutMs: 0,
    })
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMsg],
      abortSignal: undefined,
      body: { conversationId: 'conv-1' },
    })

    const chunks = await collect(stream)
    const types = chunks.map((c) => (c as { type: string }).type)
    expect(types).toContain('error')
    expect(types).toContain('finish')
    expect(types).not.toContain('text-delta')
    const finish = chunks.find((c) => (c as { type: string }).type === 'finish') as {
      finishReason: string
    }
    expect(finish.finishReason).toBe('error')
    const err = chunks.find((c) => (c as { type: string }).type === 'error') as {
      errorText: string
    }
    expect(err.errorText).toMatch(/超时|中断|重试/)
  })

  it('UT-TR-stream-end-no-done: 无 done/error 结束不得 stop 成功', async () => {
    globalThis.fetch = mockFetchStream([
      ssePayload(['event: token\ndata: {"delta":"半"}']),
    ])

    const transport = new CompanionChatTransport({
      getConversationId: () => 'conv-1',
      overallTimeoutMs: 0,
      idleTimeoutMs: 0,
    })
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMsg],
      abortSignal: undefined,
      body: { conversationId: 'conv-1' },
    })

    const chunks = await collect(stream)
    const types = chunks.map((c) => (c as { type: string }).type)
    expect(types).toContain('text-delta')
    expect(types).toContain('error')
    const finish = chunks.find((c) => (c as { type: string }).type === 'finish') as {
      finishReason: string
    }
    expect(finish.finishReason).toBe('error')
  })

  it('UT-TR-idle-timeout: idle 超时 Abort 映射为可见 error', async () => {
    // 永不产出 chunk 的流；abort 时 error，避免测试挂死
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const onAbort = () => {
            try {
              controller.error(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
            } catch {
              /* already closed */
            }
          }
          if (init?.signal?.aborted) {
            onAbort()
            return
          }
          init?.signal?.addEventListener('abort', onAbort, { once: true })
        },
      })
      return Promise.resolve({ ok: true, status: 200, body: stream })
    })

    const transport = new CompanionChatTransport({
      getConversationId: () => 'conv-1',
      overallTimeoutMs: 0,
      idleTimeoutMs: 40,
    })
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMsg],
      abortSignal: undefined,
      body: { conversationId: 'conv-1' },
    })

    const chunks = await collect(stream)
    const types = chunks.map((c) => (c as { type: string }).type)
    expect(types).toContain('error')
    const err = chunks.find((c) => (c as { type: string }).type === 'error') as {
      errorText: string
    }
    expect(err.errorText).toMatch(/超时|取消|重试/)
  })
})



