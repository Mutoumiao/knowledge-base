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
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]))
      } else {
        controller.close()
      }
    },
  })
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    body: stream,
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
})

