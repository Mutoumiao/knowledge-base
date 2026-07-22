import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderService } from '@/modules/knowledge-base/folder.service.js'

describe('FolderService', () => {
  let folderService: FolderService
  let mockTreeService: any
  let mockMoveService: any
  let mockCleanup: any

  beforeEach(() => {
    mockTreeService = {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      getBreadcrumbs: vi.fn(),
      findAncestors: vi.fn(),
      isDescendant: vi.fn(),
      ensureOwnership: vi.fn().mockResolvedValue(undefined),
    }
    mockMoveService = {
      move: vi.fn(),
      copy: vi.fn(),
      deleteFolder: vi.fn(),
    }
    mockCleanup = {
      cleanupFolder: vi.fn().mockResolvedValue(undefined),
    }

    folderService = new FolderService(mockTreeService, mockMoveService, mockCleanup)
  })

  describe('list', () => {
    it('delegates to treeService.list', async () => {
      mockTreeService.list.mockResolvedValue([{ id: 'f1', name: 'Folder' }])

      const result = await folderService.list('u1', 'kb1', 'p1')

      expect(result).toHaveLength(1)
      expect(mockTreeService.list).toHaveBeenCalledWith('u1', 'kb1', 'p1', undefined, undefined)
    })
  })

  describe('create', () => {
    it('delegates to treeService.create', async () => {
      mockTreeService.create.mockResolvedValue({ id: 'f1', name: 'New Folder' })

      const result = await folderService.create('u1', 'kb1', { name: 'New Folder', parentId: 'p1' })

      expect(result.name).toBe('New Folder')
      expect(mockTreeService.create).toHaveBeenCalledWith('u1', 'kb1', {
        name: 'New Folder',
        parentId: 'p1',
      })
    })

    it('throws NotFoundException when parent folder not found', async () => {
      mockTreeService.create.mockRejectedValue(new NotFoundException('父文件夹不存在'))

      await expect(
        folderService.create('u1', 'kb1', { name: 'New', parentId: 'p1' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('update', () => {
    it('delegates to treeService.update', async () => {
      mockTreeService.update.mockResolvedValue({ id: 'f1', name: 'Renamed' })

      const result = await folderService.update('u1', 'kb1', 'f1', { name: 'Renamed' })

      expect(result.name).toBe('Renamed')
    })
  })

  describe('remove', () => {
    it('removes folder and cleans up', async () => {
      mockTreeService.remove.mockResolvedValue({ id: 'f1' })
      mockMoveService.deleteFolder.mockResolvedValue({ id: 'f1', deleted: true })

      const result = await folderService.remove('u1', 'kb1', 'f1')

      // treeService 仅校验归属；级联删除由 cleanupFolder 完成
      expect(mockTreeService.remove).toHaveBeenCalledWith('u1', 'kb1', 'f1')
      expect(mockCleanup.cleanupFolder).toHaveBeenCalledWith('kb1', 'f1')
      expect(mockMoveService.deleteFolder).not.toHaveBeenCalled()
      expect(result.deleted).toBe(true)
    })
  })

  describe('getBreadcrumbs', () => {
    it('delegates to treeService.getBreadcrumbs', async () => {
      mockTreeService.getBreadcrumbs.mockResolvedValue([])

      const result = await folderService.getBreadcrumbs('u1', 'kb1')

      expect(result).toHaveLength(0)
    })

    it('throws NotFoundException when folder not in KB', async () => {
      mockTreeService.getBreadcrumbs.mockRejectedValue(new NotFoundException('文件夹不存在'))

      await expect(folderService.getBreadcrumbs('u1', 'kb1', 'c1')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws ForbiddenException when not owner', async () => {
      mockTreeService.getBreadcrumbs.mockRejectedValue(new ForbiddenException('无权访问'))

      await expect(folderService.getBreadcrumbs('u1', 'kb1', 'c1')).rejects.toThrow(
        ForbiddenException,
      )
    })
  })

  describe('findAncestors', () => {
    it('delegates to treeService.findAncestors after ownership check', async () => {
      mockTreeService.findAncestors.mockResolvedValue([
        { id: 'p1', name: 'Parent' },
        { id: 'c1', name: 'Child' },
      ])

      const result = await folderService.findAncestors('u1', 'kb1', 'c1')

      expect(mockTreeService.ensureOwnership).toHaveBeenCalledWith('u1', 'kb1')
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('p1')
    })
  })

  describe('isDescendant', () => {
    it('delegates to treeService.isDescendant after ownership check', async () => {
      mockTreeService.isDescendant.mockResolvedValue(true)

      const result = await folderService.isDescendant('u1', 'kb1', 'p1', 'c1')

      expect(mockTreeService.ensureOwnership).toHaveBeenCalledWith('u1', 'kb1')
      expect(result).toBe(true)
    })
  })
})
