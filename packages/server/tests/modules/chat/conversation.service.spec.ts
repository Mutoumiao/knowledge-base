import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationService } from '@/modules/chat/conversation.service.js'
import type { LlmProvider } from '@/modules/chat/llm/llm-provider.interface.js'
import type { MessageRepository } from '@/modules/session/repositories/message.repository.js'
import type { SessionRepository } from '@/modules/session/repositories/session.repository.js'

function createMockSessionRepository(overrides = {}) {
  return {
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    ...overrides,
  }
}

function createMockMessageRepository(overrides = {}) {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySessionId: vi.fn(),
    findUpToMessageId: vi.fn(),
    paginateBySessionId: vi.fn(),
    ...overrides,
  }
}

describe('ConversationService', () => {
  let service: ConversationService
  let sessionRepository: ReturnType<typeof createMockSessionRepository>
  let messageRepository: ReturnType<typeof createMockMessageRepository>

  beforeEach(() => {
    vi.clearAllMocks()
    sessionRepository = createMockSessionRepository()
    messageRepository = createMockMessageRepository()
    service = new ConversationService(
      sessionRepository as unknown as SessionRepository,
      messageRepository as unknown as MessageRepository,
    )
  })

  describe('ensureOwnership', () => {
    it('throws NotFoundException when session does not exist', async () => {
      sessionRepository.findById.mockResolvedValue(null)

      await expect(service.ensureOwnership('user-1', 'session-1')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws ForbiddenException when session belongs to another user', async () => {
      sessionRepository.findById.mockResolvedValue({ id: 'session-1', userId: 'user-2' } as any)

      await expect(service.ensureOwnership('user-1', 'session-1')).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('resolves when user owns the session', async () => {
      sessionRepository.findById.mockResolvedValue({ id: 'session-1', userId: 'user-1' } as any)

      await expect(service.ensureOwnership('user-1', 'session-1')).resolves.toBeUndefined()
    })
  })

  describe('createSession', () => {
    it('creates session with default title', async () => {
      sessionRepository.create.mockResolvedValue({
        id: 's1',
        userId: 'user-1',
        title: '新对话',
      } as any)

      const result = await service.createSession('user-1')

      expect(sessionRepository.create).toHaveBeenCalledWith({ userId: 'user-1', title: '新对话' })
      expect(result.id).toBe('s1')
    })

    it('creates session with custom title', async () => {
      sessionRepository.create.mockResolvedValue({
        id: 's1',
        userId: 'user-1',
        title: 'Custom',
      } as any)

      await service.createSession('user-1', 'Custom')

      expect(sessionRepository.create).toHaveBeenCalledWith({ userId: 'user-1', title: 'Custom' })
    })
  })

  describe('saveUserMessage', () => {
    it('creates user message', async () => {
      messageRepository.create.mockResolvedValue({
        id: 'm1',
        sessionId: 's1',
        role: 'user',
        content: 'hi',
      } as any)

      const result = await service.saveUserMessage('s1', 'hi')

      expect(messageRepository.create).toHaveBeenCalledWith({
        sessionId: 's1',
        role: 'user',
        content: 'hi',
      })
      expect(result.role).toBe('user')
    })
  })

  describe('saveAssistantMessage', () => {
    it('creates assistant message with given id', async () => {
      messageRepository.create.mockResolvedValue({
        id: 'm2',
        sessionId: 's1',
        role: 'assistant',
        content: 'hello',
      } as any)

      const result = await service.saveAssistantMessage('s1', 'm2', 'hello')

      expect(messageRepository.create).toHaveBeenCalledWith({
        id: 'm2',
        sessionId: 's1',
        role: 'assistant',
        content: 'hello',
        status: 'completed',
        metadata: undefined,
      })
      expect(result.role).toBe('assistant')
    })
  })

  describe('loadHistory', () => {
    it('returns full history ordered by creation time', async () => {
      messageRepository.findBySessionId.mockResolvedValue([
        {
          id: 'm1',
          sessionId: 's1',
          role: 'user',
          content: 'q1',
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'm2',
          sessionId: 's1',
          role: 'assistant',
          content: 'a1',
          createdAt: new Date('2024-01-02'),
        },
      ] as any)

      const result = await service.loadHistory('s1')

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ role: 'user', content: 'q1' })
      expect(result[1]).toEqual({ role: 'assistant', content: 'a1' })
    })

    it('returns history up to given message id', async () => {
      const targetMessage = {
        id: 'm2',
        sessionId: 's1',
        role: 'assistant',
        content: 'a1',
        createdAt: new Date('2024-01-02'),
      }
      messageRepository.findById.mockResolvedValue(targetMessage as any)
      messageRepository.findUpToMessageId.mockResolvedValue([
        { role: 'user', content: 'q1' },
      ] as any)

      const result = await service.loadHistory('s1', { beforeMessageId: 'm2' })

      expect(result).toHaveLength(1)
      expect(messageRepository.findUpToMessageId).toHaveBeenCalledWith('s1', 'm2', {
        select: { role: true, content: true, status: true },
      })
    })

    it('throws ForbiddenException when beforeMessageId belongs to different session', async () => {
      messageRepository.findById.mockResolvedValue({ id: 'm2', sessionId: 's2' } as any)

      await expect(service.loadHistory('s1', { beforeMessageId: 'm2' })).rejects.toThrow(
        ForbiddenException,
      )
    })
  })

  describe('paginateMessages', () => {
    it('delegates to message repository', async () => {
      const paginated = { items: [], pagination: { total: 0 } }
      messageRepository.paginateBySessionId.mockResolvedValue(paginated as any)

      const result = await service.paginateMessages('s1', { page: 1, size: 20 })

      expect(messageRepository.paginateBySessionId).toHaveBeenCalledWith('s1', {
        page: 1,
        size: 20,
      })
      expect(result).toBe(paginated)
    })
  })

  describe('generateTitle', () => {
    it('updates title when current title is default', async () => {
      sessionRepository.findById.mockResolvedValue({ id: 's1', title: '新对话' } as any)
      const provider = {
        invoke: vi.fn().mockResolvedValue('  "Hello World"  \n'),
      } as unknown as LlmProvider

      await service.generateTitle('s1', 'hi', 'hello', provider)

      expect(sessionRepository.update).toHaveBeenCalledWith('s1', { title: 'Hello World' })
    })

    it('does not update when title is already customized', async () => {
      sessionRepository.findById.mockResolvedValue({ id: 's1', title: 'Custom Title' } as any)
      const provider = { invoke: vi.fn() } as unknown as LlmProvider

      await service.generateTitle('s1', 'hi', 'hello', provider)

      expect(provider.invoke).not.toHaveBeenCalled()
      expect(sessionRepository.update).not.toHaveBeenCalled()
    })

    it('falls back to default title on empty generation', async () => {
      sessionRepository.findById.mockResolvedValue({ id: 's1', title: '新对话' } as any)
      const provider = { invoke: vi.fn().mockResolvedValue('   ') } as unknown as LlmProvider

      await service.generateTitle('s1', 'hi', 'hello', provider)

      expect(sessionRepository.update).toHaveBeenCalledWith('s1', { title: '新对话' })
    })

    it('silently ignores provider errors', async () => {
      sessionRepository.findById.mockResolvedValue({ id: 's1', title: '新对话' } as any)
      const provider = {
        invoke: vi.fn().mockRejectedValue(new Error('fail')),
      } as unknown as LlmProvider

      await expect(service.generateTitle('s1', 'hi', 'hello', provider)).resolves.toBeUndefined()
    })
  })
})
