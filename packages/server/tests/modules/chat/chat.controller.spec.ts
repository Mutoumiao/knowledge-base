import type { FastifyReply, FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SseResponseHelper } from '@/common/helpers/sse-response.helper.js'
import { ChatController } from '@/modules/chat/chat.controller.js'
import type { ChatService } from '@/modules/chat/chat.service.js'
import type { ConversationService } from '@/modules/chat/conversation.service.js'
import type { ModelRegistryService } from '@/modules/chat/model-registry.service.js'

function createMockChatService(overrides = {}) {
  return {
    validateChatAccess: vi.fn().mockResolvedValue(undefined),
    streamChat: vi.fn().mockImplementation(async function* () {
      yield { event: 'message', conversation_id: 's1', message_id: 'm1', answer: 'hi', done: false }
      yield {
        event: 'message_end',
        conversation_id: 's1',
        message_id: 'm1',
        answer: '',
        done: true,
      }
    }),
    ...overrides,
  }
}

function createMockConversationService(overrides = {}) {
  return {
    ensureOwnership: vi.fn().mockResolvedValue(undefined),
    paginateMessages: vi.fn().mockResolvedValue({ items: [], pagination: { total: 0 } }),
    ...overrides,
  }
}

function createMockModelRegistry(overrides = {}) {
  return {
    list: vi
      .fn()
      .mockReturnValue([
        { key: 'deepseek', name: 'DeepSeek', model: 'deepseek-chat', isBuiltin: true },
      ]),
    ...overrides,
  }
}

function createMockSseHelper(overrides = {}) {
  const helper = new SseResponseHelper()
  return {
    ...helper,
    init: vi.fn().mockReturnValue(new AbortController()),
    write: vi.fn().mockReturnValue(true),
    writeError: vi.fn(),
    end: vi.fn(),
    ...overrides,
  }
}

describe('ChatController', () => {
  let controller: ChatController
  let chatService: ReturnType<typeof createMockChatService>
  let conversationService: ReturnType<typeof createMockConversationService>
  let modelRegistry: ReturnType<typeof createMockModelRegistry>
  let sseHelper: ReturnType<typeof createMockSseHelper>

  beforeEach(() => {
    vi.clearAllMocks()
    chatService = createMockChatService()
    conversationService = createMockConversationService()
    modelRegistry = createMockModelRegistry()
    sseHelper = createMockSseHelper()
    controller = new ChatController(
      chatService as unknown as ChatService,
      conversationService as unknown as ConversationService,
      modelRegistry as unknown as ModelRegistryService,
      sseHelper as unknown as SseResponseHelper,
    )
  })

  describe('chat', () => {
    it('validates access and streams chunks', async () => {
      const dto = { conversation_id: 's1', query: 'hi', provider_key: 'deepseek' } as any
      const req = {} as FastifyRequest
      const reply = {
        raw: {
          on: vi.fn(),
          statusCode: 0,
          setHeader: vi.fn(),
          write: vi.fn().mockReturnValue(true),
          end: vi.fn(),
          destroyed: false,
        },
      } as unknown as FastifyReply

      await controller.chat('user-1', dto, req, reply)

      expect(chatService.validateChatAccess).toHaveBeenCalledWith('user-1', dto)
      expect(sseHelper.init).toHaveBeenCalledWith(req, reply)
      expect(sseHelper.write).toHaveBeenCalledTimes(2)
      expect(sseHelper.end).toHaveBeenCalled()
    })

    it('writes error when stream throws', async () => {
      chatService.streamChat.mockImplementation(() => {
        const error = new Error('stream error')
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw error
              },
            }
          },
        }
      })

      const dto = { conversation_id: 's1', query: 'hi' } as any
      const req = {} as FastifyRequest
      const reply = { raw: { on: vi.fn(), destroyed: false } } as unknown as FastifyReply

      await controller.chat('user-1', dto, req, reply)

      // C1: 修复后不再暴露原始错误信息，统一返回"服务暂时不可用，请稍后重试"
      expect(sseHelper.writeError).toHaveBeenCalledWith('服务暂时不可用，请稍后重试', {
        conversationId: 's1',
      })
      expect(sseHelper.end).toHaveBeenCalled()
    })

    it('stops writing when client disconnects', async () => {
      chatService.streamChat.mockImplementation(async function* () {
        yield {
          event: 'message',
          conversation_id: 's1',
          message_id: 'm1',
          answer: 'a',
          done: false,
        }
        yield {
          event: 'message',
          conversation_id: 's1',
          message_id: 'm1',
          answer: 'b',
          done: false,
        }
      })
      sseHelper.write.mockReturnValueOnce(true).mockReturnValueOnce(false)

      const dto = { conversation_id: 's1', query: 'hi' } as any
      const req = {} as FastifyRequest
      const reply = { raw: { on: vi.fn(), destroyed: false } } as unknown as FastifyReply

      await controller.chat('user-1', dto, req, reply)

      expect(sseHelper.write).toHaveBeenCalledTimes(2)
      expect(sseHelper.end).toHaveBeenCalled()
    })
  })

  describe('listMessages', () => {
    it('checks ownership and returns paginated messages', async () => {
      const query = { conversation_id: 's1', page: 1, size: 20 } as any

      const result = await controller.listMessages('user-1', query)

      expect(conversationService.ensureOwnership).toHaveBeenCalledWith('user-1', 's1')
      expect(conversationService.paginateMessages).toHaveBeenCalledWith('s1', { page: 1, size: 20 })
      expect(result).toEqual({ items: [], pagination: { total: 0 } })
    })
  })

  describe('providers', () => {
    it('returns provider list from registry', async () => {
      const result = await controller.providers()

      expect(modelRegistry.list).toHaveBeenCalled()
      expect(result.providers).toHaveLength(1)
      expect(result.providers[0].key).toBe('deepseek')
    })
  })
})
