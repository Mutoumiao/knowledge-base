import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeBaseService } from '@/modules/knowledge-base/knowledge-base.service.js'

describe('KnowledgeBaseService', () => {
  let kbService: KnowledgeBaseService
  let mockKbRepository: any
  let mockFolderRepository: any
  let mockDocumentRepository: any
  let mockEventEmitter: any
  let mockCacheService: any

  beforeEach(() => {
    mockKbRepository = {
      findManyByUserIdWithPagination: vi.fn(),
      countByUserId: vi.fn(),
      findManyForSelector: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    mockFolderRepository = {
      searchByKbName: vi.fn(),
    }
    mockDocumentRepository = {
      searchByKbName: vi.fn(),
    }

    mockEventEmitter = {
      emitAsync: vi.fn().mockResolvedValue(undefined),
    }

    mockCacheService = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
      delByPrefix: vi.fn().mockResolvedValue(undefined),
    }

    kbService = new KnowledgeBaseService(
      mockKbRepository,
      mockFolderRepository,
      mockDocumentRepository,
      mockEventEmitter as any,
      mockCacheService as any,
    )
  })

  describe('list', () => {
    it('AC-04a: returns paginated knowledge bases for user sorted by pinned first', async () => {
      mockKbRepository.findManyByUserIdWithPagination.mockResolvedValue([
        { id: 'kb1', name: 'Test KB', userId: 'u1' },
      ])
      mockKbRepository.countByUserId.mockResolvedValue(1)

      const result = await kbService.list('u1', 1, 20)

      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('Test KB')
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.size).toBe(20)
      expect(mockKbRepository.findManyByUserIdWithPagination).toHaveBeenCalledWith('u1', 1, 20)
    })

    it('returns second page with correct skip', async () => {
      mockKbRepository.findManyByUserIdWithPagination.mockResolvedValue([])
      mockKbRepository.countByUserId.mockResolvedValue(25)

      const result = await kbService.list('u1', 2, 10)

      expect(result.page).toBe(2)
      expect(result.size).toBe(10)
      expect(mockKbRepository.findManyByUserIdWithPagination).toHaveBeenCalledWith('u1', 2, 10)
    })
  })

  describe('create', () => {
    it('AC-04b: creates knowledge base with valid data', async () => {
      mockKbRepository.create.mockResolvedValue({
        id: 'kb1',
        name: 'New KB',
        description: null,
        icon: null,
        userId: 'u1',
      })

      const result = await kbService.create('u1', { name: 'New KB' })

      expect(result.name).toBe('New KB')
      expect(mockKbRepository.create).toHaveBeenCalledWith({
        userId: 'u1',
        name: 'New KB',
        description: null,
        icon: null,
      })
    })
  })

  describe('update', () => {
    it('AC-04c: updates knowledge base for owner', async () => {
      mockKbRepository.findById.mockResolvedValue({ userId: 'u1' })
      mockKbRepository.update.mockResolvedValue({
        id: 'kb1',
        name: 'Updated KB',
      })

      const result = await kbService.update('u1', 'kb1', { name: 'Updated KB' })

      expect(result.name).toBe('Updated KB')
    })

    it('AC-04d: throws NotFoundException when KB not found', async () => {
      mockKbRepository.findById.mockResolvedValue(null)

      await expect(kbService.update('u1', 'kb1', { name: 'Updated' })).rejects.toThrow(
        NotFoundException,
      )
    })

    it('AC-04e: throws ForbiddenException when not owner', async () => {
      mockKbRepository.findById.mockResolvedValue({ userId: 'u2' })

      await expect(kbService.update('u1', 'kb1', { name: 'Updated' })).rejects.toThrow(
        ForbiddenException,
      )
    })
  })

  describe('search', () => {
    it('returns matching folders and documents', async () => {
      mockKbRepository.findById.mockResolvedValue({ userId: 'u1' })
      mockFolderRepository.searchByKbName.mockResolvedValue([{ id: 'f1', name: 'Notes' }])
      mockDocumentRepository.searchByKbName.mockResolvedValue([{ id: 'd1', name: 'notes.pdf' }])

      const result = await kbService.search('u1', 'kb1', 'notes')

      expect(result.folders).toHaveLength(1)
      expect(result.documents).toHaveLength(1)
      expect(mockFolderRepository.searchByKbName).toHaveBeenCalledWith('kb1', 'notes', 100)
      expect(mockDocumentRepository.searchByKbName).toHaveBeenCalledWith('kb1', 'notes', 100)
    })

    it('trims search query before searching', async () => {
      mockKbRepository.findById.mockResolvedValue({ userId: 'u1' })
      mockFolderRepository.searchByKbName.mockResolvedValue([{ id: 'f1', name: 'Notes' }])
      mockDocumentRepository.searchByKbName.mockResolvedValue([])

      const result = await kbService.search('u1', 'kb1', '  notes  ')

      expect(result.folders).toHaveLength(1)
      expect(mockFolderRepository.searchByKbName).toHaveBeenCalledWith('kb1', 'notes', 100)
    })

    it('throws BadRequestException when query is empty', async () => {
      mockKbRepository.findById.mockResolvedValue({ userId: 'u1' })

      await expect(kbService.search('u1', 'kb1', '   ')).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when query exceeds max length', async () => {
      mockKbRepository.findById.mockResolvedValue({ userId: 'u1' })

      await expect(kbService.search('u1', 'kb1', 'a'.repeat(101))).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws ForbiddenException when not owner', async () => {
      mockKbRepository.findById.mockResolvedValue({ userId: 'u2' })

      await expect(kbService.search('u1', 'kb1', 'notes')).rejects.toThrow(ForbiddenException)
    })
  })

  describe('remove', () => {
    it('AC-04f: removes knowledge base for owner and emits event', async () => {
      mockKbRepository.findById.mockResolvedValue({ userId: 'u1' })
      mockKbRepository.delete.mockResolvedValue({})

      const result = await kbService.remove('u1', 'kb1')

      // 物理删除由 KbCleanupService（监听 knowledge_base.deleted）完成，service 只发事件
      expect(mockKbRepository.delete).not.toHaveBeenCalled()
      expect(mockEventEmitter.emitAsync).toHaveBeenCalledWith(
        'knowledge_base.deleted',
        expect.anything(),
      )
      expect(result.deleted).toBe(true)
    })
  })
})
