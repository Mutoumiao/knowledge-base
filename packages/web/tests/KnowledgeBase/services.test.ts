import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

vi.mock('@/api/KnowledgeBase', () => ({
  getKbList: vi.fn(() => ({ send: vi.fn() })),
  updateKb: vi.fn(() => ({ send: vi.fn() })),
  uploadFile: vi.fn(() => ({ send: vi.fn() })),
  searchKbItems: vi.fn(() => ({ send: vi.fn() })),
}))

vi.mock('@/api/file', () => ({
  getFolders: vi.fn(() => ({ send: vi.fn() })),
  getDocuments: vi.fn(() => ({ send: vi.fn() })),
  getBreadcrumbs: vi.fn(() => ({ send: vi.fn() })),
  previewDocument: vi.fn(() => ({ send: vi.fn() })),
  deleteDocument: vi.fn(() => ({ send: vi.fn() })),
  renameDocument: vi.fn(() => ({ send: vi.fn() })),
  moveDocument: vi.fn(() => ({ send: vi.fn() })),
  copyDocument: vi.fn(() => ({ send: vi.fn() })),
  copyFolder: vi.fn(() => ({ send: vi.fn() })),
  createFolder: vi.fn(() => ({ send: vi.fn() })),
  renameFolder: vi.fn(() => ({ send: vi.fn() })),
  deleteFolder: vi.fn(() => ({ send: vi.fn() })),
}))

import type { KbEntry } from '@goferbot/data'
import {
  copyDocument,
  copyFolder,
  createFolder,
  deleteDocument,
  deleteFolder,
  getBreadcrumbs,
  getDocuments,
  getFolders,
  moveDocument,
  previewDocument,
  renameDocument,
  renameFolder,
} from '@/api/file'
import { getKbList, searchKbItems, updateKb, uploadFile } from '@/api/KnowledgeBase'
import {
  addFolder,
  fetchKbList,
  loadKbItems,
  navigateToFolder,
  pinKnowledgeBase,
  removeDocument,
  removeItem,
  removeKnowledgeBaseAndClearSelection,
  renameItem,
  copyDocument as svcCopyDocument,
  copyFolder as svcCopyFolder,
  createFolder as svcCreateFolder,
  moveDocument as svcMoveDocument,
  previewDocument as svcPreviewDocument,
  removeFolder as svcRemoveFolder,
  renameDocument as svcRenameDocument,
  renameFolder as svcRenameFolder,
  searchKbItems as svcSearchKbItems,
  uploadFiles,
} from '@/features/KnowledgeBase/services'
import { useKbStore } from '@/features/KnowledgeBase/store'
import type { DocumentItem, Folder } from '@/features/KnowledgeBase/types'

describe('kb services', () => {
  beforeEach(() => {
    useKbStore.setState({
      entries: [],
      isLoading: false,
      selectedId: null,
      uploadTasks: [],
      maxConcurrent: 3,
      uploadManagerOpen: false,
      uploadMiniDismissed: false,
      fileListSort: null,
      folders: [],
      documents: [],
      currentKbId: null,
      currentFolderId: null,
      fileLoading: false,
      fileError: null,
      breadcrumbs: [],
    })
    vi.clearAllMocks()
  })

  describe('fetchKbList', () => {
    it('returns success and sets entries on ok', async () => {
      const entries: KbEntry[] = [
        { id: 'kb1', name: 'Test', description: '', fileCount: 0, createdAt: '', updatedAt: '' },
      ]
      vi.mocked(getKbList).mockReturnValue({
        send: vi.fn().mockResolvedValue({
          items: entries,
          pagination: {
            total: 1,
            size: 1,
            currentPage: 1,
            totalPage: 1,
            hasNextPage: false,
            hasPrevPage: false,
          },
        }),
      } as any)

      const result = await fetchKbList()

      expect(result.success).toBe(true)
      expect(useKbStore.getState().entries).toEqual(entries)
      expect(useKbStore.getState().isLoading).toBe(false)
    })

    it('returns friendly network error on network failure', async () => {
      vi.mocked(getKbList).mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('network')),
      } as any)

      const result = await fetchKbList()

      expect(result.success).toBe(false)
      expect(result.error).toBe('网络连接异常，请检查网络后重试')
      expect(useKbStore.getState().isLoading).toBe(false)
    })

    it('returns generic error on non-Error throw', async () => {
      vi.mocked(getKbList).mockReturnValue({ send: vi.fn().mockRejectedValue('bad') } as any)

      const result = await fetchKbList()

      expect(result.success).toBe(false)
      expect(result.error).toBe('操作失败，请稍后重试')
    })

    it('maps HTTP 500 to server busy message', async () => {
      vi.mocked(getKbList).mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('HTTP 500: Internal Server Error')),
      } as any)

      const result = await fetchKbList()

      expect(result.success).toBe(false)
      expect(result.error).toBe('服务器繁忙，请稍后重试')
    })
  })

  describe('loadKbItems', () => {
    it('sets folders, documents and breadcrumbs on success (paginated documents)', async () => {
      const folders: Folder[] = [
        { id: 'f1', kbId: 'kb1', parentId: null, name: 'F', createdAt: '', updatedAt: '' },
      ]
      const documents: DocumentItem[] = [
        {
          id: 'd1',
          kbId: 'kb1',
          folderId: null,
          name: 'doc',
          ext: 'pdf',
          mimeType: 'application/pdf',
          size: 1024,
          status: 'ready',
          errorMessage: null,
          createdAt: '',
          updatedAt: '',
        },
      ]
      const breadcrumbs: Folder[] = [
        { id: 'f2', kbId: 'kb1', parentId: null, name: 'Parent', createdAt: '', updatedAt: '' },
      ]
      vi.mocked(getFolders).mockReturnValue({ send: vi.fn().mockResolvedValue(folders) } as any)
      // 与线上契约一致：GET /documents → { items, total, page, pageSize }
      vi.mocked(getDocuments).mockReturnValue({
        send: vi.fn().mockResolvedValue({ items: documents, total: 1, page: 1, pageSize: 20 }),
      } as any)
      vi.mocked(getBreadcrumbs).mockReturnValue({
        send: vi.fn().mockResolvedValue(breadcrumbs),
      } as any)

      await loadKbItems('kb1', 'f1')

      expect(useKbStore.getState().currentKbId).toBe('kb1')
      expect(useKbStore.getState().currentFolderId).toBe('f1')
      expect(useKbStore.getState().folders).toEqual(folders)
      expect(useKbStore.getState().documents).toEqual(documents)
      expect(useKbStore.getState().breadcrumbs).toEqual(breadcrumbs)
      expect(useKbStore.getState().fileLoading).toBe(false)
    })

    it('normalizes BigInt-serialized size string from API', async () => {
      vi.mocked(getFolders).mockReturnValue({ send: vi.fn().mockResolvedValue([]) } as any)
      vi.mocked(getDocuments).mockReturnValue({
        send: vi.fn().mockResolvedValue({
          items: [
            {
              id: 'd1',
              kbId: 'kb1',
              folderId: null,
              name: 'e2e-test.txt',
              ext: 'txt',
              mimeType: 'text/plain',
              size: '27',
              status: 'uploaded',
              createdAt: '',
              updatedAt: '',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      } as any)
      vi.mocked(getBreadcrumbs).mockReturnValue({ send: vi.fn().mockResolvedValue([]) } as any)

      await loadKbItems('kb1', null)

      expect(useKbStore.getState().documents[0]?.size).toBe(27)
    })

    it('passes sort params to folder and document APIs', async () => {
      useKbStore.setState({ currentKbId: 'kb1' })
      vi.mocked(getFolders).mockReturnValue({ send: vi.fn().mockResolvedValue([]) } as any)
      vi.mocked(getDocuments).mockReturnValue({
        send: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      } as any)
      vi.mocked(getBreadcrumbs).mockReturnValue({ send: vi.fn().mockResolvedValue([]) } as any)

      await loadKbItems('kb1', 'f1', { sortBy: 'size', sortOrder: 'desc' })

      expect(getFolders).toHaveBeenCalledWith('kb1', 'f1', { sortBy: 'size', sortOrder: 'desc' })
      expect(getDocuments).toHaveBeenCalledWith('kb1', 'f1', { sortBy: 'size', sortOrder: 'desc' })
    })

    it('maps type sort to name for folders', async () => {
      useKbStore.setState({ currentKbId: 'kb1' })
      vi.mocked(getFolders).mockReturnValue({ send: vi.fn().mockResolvedValue([]) } as any)
      vi.mocked(getDocuments).mockReturnValue({
        send: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      } as any)
      vi.mocked(getBreadcrumbs).mockReturnValue({ send: vi.fn().mockResolvedValue([]) } as any)

      await loadKbItems('kb1', 'f1', { sortBy: 'type', sortOrder: 'asc' })

      expect(getFolders).toHaveBeenCalledWith('kb1', 'f1', { sortBy: 'name', sortOrder: 'asc' })
      expect(getDocuments).toHaveBeenCalledWith('kb1', 'f1', { sortBy: 'type', sortOrder: 'asc' })
    })

    it('sets friendly fileError on failure', async () => {
      vi.mocked(getFolders).mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('fail')),
      } as any)
      vi.mocked(getDocuments).mockReturnValue({
        send: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      } as any)
      vi.mocked(getBreadcrumbs).mockReturnValue({ send: vi.fn().mockResolvedValue([]) } as any)

      await loadKbItems('kb1', null)

      expect(useKbStore.getState().fileError).toBe('操作失败，请稍后重试')
      expect(useKbStore.getState().fileLoading).toBe(false)
    })
  })

  describe('previewDocument', () => {
    it('returns preview result on success', async () => {
      useKbStore.setState({ currentKbId: 'kb1' })
      const preview = { type: 'text' as const, mimeType: 'text/markdown', content: '# Hello' }
      vi.mocked(previewDocument).mockReturnValue({
        send: vi.fn().mockResolvedValue(preview),
      } as any)

      const result = await svcPreviewDocument('d1')

      expect(result).toEqual(preview)
      expect(previewDocument).toHaveBeenCalledWith('kb1', 'd1')
    })

    it('returns null and sets friendly error on failure', async () => {
      useKbStore.setState({ currentKbId: 'kb1' })
      vi.mocked(previewDocument).mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('preview fail')),
      } as any)

      const result = await svcPreviewDocument('d1')

      expect(result).toBeNull()
      expect(useKbStore.getState().fileError).toBe('操作失败，请稍后重试')
    })

    it('does nothing when currentKbId is null', async () => {
      useKbStore.setState({ currentKbId: null })
      const result = await svcPreviewDocument('d1')
      expect(result).toBeNull()
      expect(previewDocument).not.toHaveBeenCalled()
    })
  })

  describe('searchKbItems', () => {
    it('sets folders and documents from search result', async () => {
      useKbStore.setState({ currentKbId: 'kb1' })
      const folders: Folder[] = [
        { id: 'f1', kbId: 'kb1', parentId: null, name: 'Notes', createdAt: '', updatedAt: '' },
      ]
      const documents: DocumentItem[] = [
        {
          id: 'd1',
          kbId: 'kb1',
          folderId: null,
          name: 'notes.pdf',
          ext: 'pdf',
          mimeType: 'application/pdf',
          size: 1024,
          status: 'ready',
          createdAt: '',
          updatedAt: '',
        },
      ]
      vi.mocked(searchKbItems).mockReturnValue({
        send: vi.fn().mockResolvedValue({ folders, documents }),
      } as any)

      const result = await svcSearchKbItems('notes')

      expect(result.folders).toEqual(folders)
      expect(result.documents).toEqual(documents)
      expect(useKbStore.getState().folders).toEqual(folders)
      expect(useKbStore.getState().documents).toEqual(documents)
    })

    it('returns empty result when query is empty', async () => {
      useKbStore.setState({ currentKbId: 'kb1' })
      const result = await svcSearchKbItems('   ')

      expect(result).toEqual({ folders: [], documents: [] })
      expect(searchKbItems).not.toHaveBeenCalled()
    })

    it('sets fileError when currentKbId is null', async () => {
      useKbStore.setState({ currentKbId: null })
      const result = await svcSearchKbItems('notes')
      expect(result).toEqual({ folders: [], documents: [] })
      expect(searchKbItems).not.toHaveBeenCalled()
      expect(useKbStore.getState().fileError).toBe('未选择知识库')
    })

    it('ignores stale search results', async () => {
      useKbStore.setState({ currentKbId: 'kb1' })
      let resolveFirst: (value: unknown) => void = () => {}
      vi.mocked(searchKbItems)
        .mockReturnValueOnce({
          send: vi.fn().mockImplementation(
            () =>
              new Promise((resolve) => {
                resolveFirst = resolve
              }),
          ),
        } as any)
        .mockReturnValueOnce({
          send: vi.fn().mockResolvedValue({
            folders: [
              {
                id: 'new',
                kbId: 'kb1',
                parentId: null,
                name: 'New',
                createdAt: '',
                updatedAt: '',
              },
            ],
            documents: [],
          }),
        } as any)

      const p1 = svcSearchKbItems('first')
      const p2 = svcSearchKbItems('second')
      await p2
      expect(useKbStore.getState().folders).toEqual([
        { id: 'new', kbId: 'kb1', parentId: null, name: 'New', createdAt: '', updatedAt: '' },
      ])
      resolveFirst({
        folders: [
          { id: 'old', kbId: 'kb1', parentId: null, name: 'Old', createdAt: '', updatedAt: '' },
        ],
        documents: [],
      })
      await p1
      expect(useKbStore.getState().folders).toEqual([
        { id: 'new', kbId: 'kb1', parentId: null, name: 'New', createdAt: '', updatedAt: '' },
      ])
    })
  })

  describe('removeDocument', () => {
    it('removes document from store after api success', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        documents: [
          {
            id: 'd1',
            kbId: 'kb1',
            folderId: null,
            name: 'a',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
          {
            id: 'd2',
            kbId: 'kb1',
            folderId: null,
            name: 'b',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
        ],
      })
      vi.mocked(deleteDocument).mockReturnValue({
        send: vi.fn().mockResolvedValue(undefined),
      } as any)

      await removeDocument('d1')

      expect(useKbStore.getState().documents).toHaveLength(1)
      expect(useKbStore.getState().documents[0].id).toBe('d2')
    })

    it('throws when currentKbId is null', async () => {
      useKbStore.setState({
        currentKbId: null,
        documents: [
          {
            id: 'd1',
            kbId: '',
            folderId: null,
            name: 'a',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
        ],
      })
      await expect(removeDocument('d1')).rejects.toThrow('未选择知识库')
      expect(deleteDocument).not.toHaveBeenCalled()
    })

    it('throws friendly error on api failure', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        documents: [
          {
            id: 'd1',
            kbId: 'kb1',
            folderId: null,
            name: 'a',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
        ],
      })
      vi.mocked(deleteDocument).mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('del fail')),
      } as any)

      await expect(removeDocument('d1')).rejects.toThrow('操作失败，请稍后重试')
      expect(useKbStore.getState().fileError).toBeNull()
    })
  })

  describe('renameDocument', () => {
    it('updates document in store after api success', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        documents: [
          {
            id: 'd1',
            kbId: 'kb1',
            folderId: null,
            name: 'old',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
        ],
      })
      const updated: DocumentItem = {
        id: 'd1',
        kbId: 'kb1',
        folderId: null,
        name: 'new',
        ext: 'pdf',
        mimeType: 'application/pdf',
        size: 1024,
        status: 'ready',
        createdAt: '',
        updatedAt: '',
      }
      vi.mocked(renameDocument).mockReturnValue({ send: vi.fn().mockResolvedValue(updated) } as any)

      await svcRenameDocument('d1', 'new')

      expect(useKbStore.getState().documents[0].name).toBe('new')
    })

    it('throws when currentKbId is null', async () => {
      useKbStore.setState({ currentKbId: null })
      await expect(svcRenameDocument('d1', 'new')).rejects.toThrow('未选择知识库')
      expect(renameDocument).not.toHaveBeenCalled()
    })
  })

  describe('moveDocument', () => {
    it('removes document from current list after api success', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        documents: [
          {
            id: 'd1',
            kbId: 'kb1',
            folderId: null,
            name: 'a',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
        ],
      })
      vi.mocked(moveDocument).mockReturnValue({ send: vi.fn().mockResolvedValue(undefined) } as any)

      await svcMoveDocument('d1', 'kb1', 'f2')

      expect(useKbStore.getState().documents).toHaveLength(0)
    })

    it('throws when target folder is current folder', async () => {
      useKbStore.setState({ currentKbId: 'kb1', currentFolderId: 'f1' })
      await expect(svcMoveDocument('d1', 'kb1', 'f1')).rejects.toThrow('目标位置不能与当前位置相同')
      expect(moveDocument).not.toHaveBeenCalled()
    })

    it('throws when currentKbId is null', async () => {
      useKbStore.setState({ currentKbId: null })
      await expect(svcMoveDocument('d1', 'kb1', 'f1')).rejects.toThrow('未选择知识库')
      expect(moveDocument).not.toHaveBeenCalled()
    })
  })

  describe('copyDocument', () => {
    it('adds copied document to current list when target is current folder', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        currentFolderId: 'f1',
        documents: [
          {
            id: 'd1',
            kbId: 'kb1',
            folderId: 'f1',
            name: 'a',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
        ],
      })
      const copied: DocumentItem = {
        id: 'd2',
        kbId: 'kb1',
        folderId: 'f1',
        name: 'a',
        ext: 'pdf',
        mimeType: 'application/pdf',
        size: 1024,
        status: 'uploaded',
        createdAt: '',
        updatedAt: '',
      }
      vi.mocked(copyDocument).mockReturnValue({ send: vi.fn().mockResolvedValue(copied) } as any)

      await svcCopyDocument('d1', 'kb1', 'f1')

      expect(useKbStore.getState().documents).toHaveLength(2)
      expect(useKbStore.getState().documents[1].id).toBe('d2')
    })

    it('does not add document when target is another kb', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        currentFolderId: 'f1',
        documents: [
          {
            id: 'd1',
            kbId: 'kb1',
            folderId: 'f1',
            name: 'a',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
        ],
      })
      const copied: DocumentItem = {
        id: 'd2',
        kbId: 'kb2',
        folderId: null,
        name: 'a',
        ext: 'pdf',
        mimeType: 'application/pdf',
        size: 1024,
        status: 'uploaded',
        createdAt: '',
        updatedAt: '',
      }
      vi.mocked(copyDocument).mockReturnValue({ send: vi.fn().mockResolvedValue(copied) } as any)

      await svcCopyDocument('d1', 'kb2', null)

      expect(useKbStore.getState().documents).toHaveLength(1)
    })

    it('throws when currentKbId is null', async () => {
      useKbStore.setState({ currentKbId: null })
      await expect(svcCopyDocument('d1', 'kb1', null)).rejects.toThrow('未选择知识库')
      expect(copyDocument).not.toHaveBeenCalled()
    })
  })

  describe('copyFolder', () => {
    it('adds copied folder to current list when target is current folder', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        currentFolderId: 'f1',
        folders: [
          { id: 'f1', kbId: 'kb1', parentId: null, name: 'A', createdAt: '', updatedAt: '' },
        ],
      })
      const copied: Folder = {
        id: 'f2',
        kbId: 'kb1',
        parentId: 'f1',
        name: 'A',
        createdAt: '',
        updatedAt: '',
      }
      vi.mocked(copyFolder).mockReturnValue({ send: vi.fn().mockResolvedValue(copied) } as any)

      await svcCopyFolder('f1', 'kb1', 'f1')

      expect(useKbStore.getState().folders).toHaveLength(2)
      expect(useKbStore.getState().folders[1].id).toBe('f2')
    })

    it('throws when currentKbId is null', async () => {
      useKbStore.setState({ currentKbId: null })
      await expect(svcCopyFolder('f1', 'kb1', null)).rejects.toThrow('未选择知识库')
      expect(copyFolder).not.toHaveBeenCalled()
    })
  })

  describe('createFolder', () => {
    it('returns created folder from api', async () => {
      const folder: Folder = {
        id: 'f1',
        kbId: 'kb1',
        parentId: null,
        name: 'New',
        createdAt: '',
        updatedAt: '',
      }
      vi.mocked(createFolder).mockReturnValue({ send: vi.fn().mockResolvedValue(folder) } as any)

      const result = await svcCreateFolder('kb1', 'New')

      expect(result).toEqual(folder)
    })
  })

  describe('renameFolder', () => {
    it('returns updated folder from api', async () => {
      const folder: Folder = {
        id: 'f1',
        kbId: 'kb1',
        parentId: null,
        name: 'Renamed',
        createdAt: '',
        updatedAt: '',
      }
      vi.mocked(renameFolder).mockReturnValue({ send: vi.fn().mockResolvedValue(folder) } as any)

      const result = await svcRenameFolder('kb1', 'f1', 'Renamed')

      expect(result).toEqual(folder)
    })
  })

  describe('removeFolder', () => {
    it('calls api delete', async () => {
      vi.mocked(deleteFolder).mockReturnValue({ send: vi.fn().mockResolvedValue(undefined) } as any)

      await svcRemoveFolder('kb1', 'f1')

      expect(deleteFolder).toHaveBeenCalledWith('kb1', 'f1')
    })
  })

  describe('uploadFiles', () => {
    it('adds upload tasks and marks complete on success', async () => {
      vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid-1') })
      vi.mocked(uploadFile).mockReturnValue({ send: vi.fn().mockResolvedValue(undefined) } as any)

      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const ids = await uploadFiles('kb1', [file])

      expect(ids).toEqual(['uuid-1'])
      const tasks = useKbStore.getState().uploadTasks
      expect(tasks).toHaveLength(1)
      // store marks complete only when status is uploading; service sets it before api call
      expect(tasks[0].status).toBe('completed')
      vi.unstubAllGlobals()
    })

    it('marks upload failed with mapped friendly error and keeps file for retry', async () => {
      vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid-1') })
      vi.mocked(uploadFile).mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('up fail')),
      } as any)

      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      await uploadFiles('kb1', [file])

      const tasks = useKbStore.getState().uploadTasks
      expect(tasks[0].status).toBe('failed')
      // 不回传原始 e.message，使用 mapErrorMessage 友好文案
      expect(tasks[0].error).toBe('操作失败，请稍后重试')
      expect(tasks[0].file).toBe(file)
      vi.unstubAllGlobals()
    })

    it('clears file blob after successful upload', async () => {
      vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid-1') })
      vi.mocked(uploadFile).mockReturnValue({ send: vi.fn().mockResolvedValue(undefined) } as any)

      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      await uploadFiles('kb1', [file])

      const task = useKbStore.getState().uploadTasks[0]
      expect(task.status).toBe('completed')
      expect(task.file).toBeUndefined()
      vi.unstubAllGlobals()
    })
  })

  describe('navigateToFolder', () => {
    it('sets current folder id when kb selected', () => {
      useKbStore.setState({ currentKbId: 'kb1' })
      navigateToFolder('f1')
      expect(useKbStore.getState().currentFolderId).toBe('f1')
    })

    it('does nothing when no kb selected', () => {
      useKbStore.setState({ currentKbId: null })
      navigateToFolder('f1')
      expect(useKbStore.getState().currentFolderId).toBeNull()
    })
  })

  describe('removeItem', () => {
    it('removes folder from store after api success', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        folders: [
          { id: 'f1', kbId: 'kb1', parentId: null, name: 'A', createdAt: '', updatedAt: '' },
          { id: 'f2', kbId: 'kb1', parentId: null, name: 'B', createdAt: '', updatedAt: '' },
        ],
      })
      vi.mocked(deleteFolder).mockReturnValue({ send: vi.fn().mockResolvedValue(undefined) } as any)

      await removeItem({
        id: 'f1',
        kbId: 'kb1',
        parentId: null,
        name: 'A',
        createdAt: '',
        updatedAt: '',
      })

      expect(useKbStore.getState().folders).toHaveLength(1)
      expect(useKbStore.getState().folders[0].id).toBe('f2')
    })

    it('removes document from store after api success', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        documents: [
          {
            id: 'd1',
            kbId: 'kb1',
            folderId: null,
            name: 'a',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
        ],
      })
      vi.mocked(deleteDocument).mockReturnValue({
        send: vi.fn().mockResolvedValue(undefined),
      } as any)

      await removeItem({
        id: 'd1',
        kbId: 'kb1',
        folderId: null,
        name: 'a',
        ext: 'pdf',
        mimeType: 'application/pdf',
        size: 1024,
        status: 'ready',
        createdAt: '',
        updatedAt: '',
      })

      expect(useKbStore.getState().documents).toHaveLength(0)
    })

    it('throws when currentKbId is null', async () => {
      useKbStore.setState({
        currentKbId: null,
        folders: [{ id: 'f1', kbId: '', parentId: null, name: 'A', createdAt: '', updatedAt: '' }],
      })
      await expect(
        removeItem({ id: 'f1', kbId: '', parentId: null, name: 'A', createdAt: '', updatedAt: '' }),
      ).rejects.toThrow('未选择知识库')
      expect(deleteFolder).not.toHaveBeenCalled()
    })

    it('rejects concurrent remove requests for the same item', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        folders: [
          { id: 'f1', kbId: 'kb1', parentId: null, name: 'A', createdAt: '', updatedAt: '' },
        ],
      })
      vi.mocked(deleteFolder).mockReturnValue({
        send: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50))),
      } as any)

      const p1 = removeItem({
        id: 'f1',
        kbId: 'kb1',
        parentId: null,
        name: 'A',
        createdAt: '',
        updatedAt: '',
      })
      const p2 = removeItem({
        id: 'f1',
        kbId: 'kb1',
        parentId: null,
        name: 'A',
        createdAt: '',
        updatedAt: '',
      })

      await expect(p2).rejects.toThrow('操作进行中，请稍候')
      await p1
      expect(deleteFolder).toHaveBeenCalledTimes(1)
    })

    it('maps HTTP 409 to friendly conflict message', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        folders: [
          { id: 'f1', kbId: 'kb1', parentId: null, name: 'A', createdAt: '', updatedAt: '' },
        ],
      })
      vi.mocked(deleteFolder).mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('HTTP 409: Conflict')),
      } as any)

      await expect(
        removeItem({
          id: 'f1',
          kbId: 'kb1',
          parentId: null,
          name: 'A',
          createdAt: '',
          updatedAt: '',
        }),
      ).rejects.toThrow('名称冲突，请更换后重试')
      expect(useKbStore.getState().fileError).toBeNull()
    })
  })

  describe('renameItem', () => {
    it('renames folder in store after api success', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        folders: [
          { id: 'f1', kbId: 'kb1', parentId: null, name: 'Old', createdAt: '', updatedAt: '' },
        ],
      })
      const updated: Folder = {
        id: 'f1',
        kbId: 'kb1',
        parentId: null,
        name: 'New',
        createdAt: '',
        updatedAt: '',
      }
      vi.mocked(renameFolder).mockReturnValue({ send: vi.fn().mockResolvedValue(updated) } as any)

      await renameItem(
        { id: 'f1', kbId: 'kb1', parentId: null, name: 'Old', createdAt: '', updatedAt: '' },
        'New',
      )

      expect(useKbStore.getState().folders[0].name).toBe('New')
    })

    it('renames document in store after api success', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        documents: [
          {
            id: 'd1',
            kbId: 'kb1',
            folderId: null,
            name: 'old',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
        ],
      })
      const updated: DocumentItem = {
        id: 'd1',
        kbId: 'kb1',
        folderId: null,
        name: 'new',
        ext: 'pdf',
        mimeType: 'application/pdf',
        size: 1024,
        status: 'ready',
        createdAt: '',
        updatedAt: '',
      }
      vi.mocked(renameDocument).mockReturnValue({ send: vi.fn().mockResolvedValue(updated) } as any)

      await renameItem(
        {
          id: 'd1',
          kbId: 'kb1',
          folderId: null,
          name: 'old',
          ext: 'pdf',
          mimeType: 'application/pdf',
          size: 1024,
          status: 'ready',
          createdAt: '',
          updatedAt: '',
        },
        'new',
      )

      expect(useKbStore.getState().documents[0].name).toBe('new')
    })

    it('throws when currentKbId is null', async () => {
      useKbStore.setState({ currentKbId: null })
      await expect(
        renameItem(
          { id: 'f1', kbId: '', parentId: null, name: 'Old', createdAt: '', updatedAt: '' },
          'New',
        ),
      ).rejects.toThrow('未选择知识库')
      expect(renameFolder).not.toHaveBeenCalled()
    })

    it('rejects concurrent rename requests for the same item', async () => {
      useKbStore.setState({
        currentKbId: 'kb1',
        folders: [
          { id: 'f1', kbId: 'kb1', parentId: null, name: 'Old', createdAt: '', updatedAt: '' },
        ],
      })
      vi.mocked(renameFolder).mockReturnValue({
        send: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50))),
      } as any)

      const p1 = renameItem(
        { id: 'f1', kbId: 'kb1', parentId: null, name: 'Old', createdAt: '', updatedAt: '' },
        'New',
      )
      const p2 = renameItem(
        { id: 'f1', kbId: 'kb1', parentId: null, name: 'Old', createdAt: '', updatedAt: '' },
        'Another',
      )

      await expect(p2).rejects.toThrow('操作进行中，请稍候')
      await p1
      expect(renameFolder).toHaveBeenCalledTimes(1)
    })
  })

  describe('addFolder', () => {
    it('adds folder to store after api success', async () => {
      useKbStore.setState({ currentKbId: 'kb1', folders: [] })
      const folder: Folder = {
        id: 'f1',
        kbId: 'kb1',
        parentId: null,
        name: 'New',
        createdAt: '',
        updatedAt: '',
      }
      vi.mocked(createFolder).mockReturnValue({ send: vi.fn().mockResolvedValue(folder) } as any)

      const result = await addFolder('kb1', 'New')

      expect(result).toEqual(folder)
      expect(useKbStore.getState().folders).toHaveLength(1)
    })

    it('throws friendly error on api failure', async () => {
      useKbStore.setState({ currentKbId: 'kb1', folders: [] })
      vi.mocked(createFolder).mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('fail')),
      } as any)

      await expect(addFolder('kb1', 'New')).rejects.toThrow('操作失败，请稍后重试')
      expect(useKbStore.getState().fileError).toBeNull()
    })
  })

  describe('pinKnowledgeBase', () => {
    it('calls updateKb and refreshes list on success', async () => {
      useKbStore.setState({
        entries: [
          {
            id: 'kb1',
            name: 'A',
            description: '',
            fileCount: 0,
            createdAt: '',
            updatedAt: '',
            isPinned: false,
          },
        ],
      })
      vi.mocked(updateKb).mockReturnValue({ send: vi.fn().mockResolvedValue(undefined) } as any)
      vi.mocked(getKbList).mockReturnValue({
        send: vi.fn().mockResolvedValue({
          items: [
            {
              id: 'kb1',
              name: 'A',
              description: '',
              fileCount: 0,
              createdAt: '',
              updatedAt: '',
              isPinned: true,
            },
          ],
          pagination: {
            total: 1,
            size: 1,
            currentPage: 1,
            totalPage: 1,
            hasNextPage: false,
            hasPrevPage: false,
          },
        }),
      } as any)

      const result = await pinKnowledgeBase('kb1', true)

      expect(result).toBe(true)
      expect(updateKb).toHaveBeenCalledWith('kb1', { isPinned: true })
      expect(useKbStore.getState().entries[0].isPinned).toBe(true)
    })

    it('returns false and toasts error on api failure', async () => {
      useKbStore.setState({
        entries: [
          {
            id: 'kb1',
            name: 'A',
            description: '',
            fileCount: 0,
            createdAt: '',
            updatedAt: '',
            isPinned: false,
          },
        ],
      })
      vi.mocked(updateKb).mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('HTTP 500: fail')),
      } as any)

      const result = await pinKnowledgeBase('kb1', true)

      expect(result).toBe(false)
      expect(updateKb).toHaveBeenCalledTimes(1)
    })

    it('ignores duplicate pin requests for the same kb', async () => {
      useKbStore.setState({
        entries: [
          {
            id: 'kb1',
            name: 'A',
            description: '',
            fileCount: 0,
            createdAt: '',
            updatedAt: '',
            isPinned: false,
          },
        ],
      })
      vi.mocked(updateKb).mockReturnValue({
        send: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50))),
      } as any)

      const p1 = pinKnowledgeBase('kb1', true)
      const p2 = pinKnowledgeBase('kb1', false)

      expect(await p2).toBe(false)
      await p1
      expect(updateKb).toHaveBeenCalledTimes(1)
    })
  })

  describe('removeKnowledgeBaseAndClearSelection', () => {
    it('removes entry and clears selection when deleting selected kb', () => {
      useKbStore.setState({
        selectedId: 'kb1',
        currentKbId: 'kb1',
        currentFolderId: 'f1',
        folders: [
          { id: 'f1', kbId: 'kb1', parentId: null, name: 'F', createdAt: '', updatedAt: '' },
        ],
        documents: [
          {
            id: 'd1',
            kbId: 'kb1',
            folderId: null,
            name: 'a',
            ext: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            status: 'ready',
            createdAt: '',
            updatedAt: '',
          },
        ],
        breadcrumbs: [
          { id: 'f1', kbId: 'kb1', parentId: null, name: 'F', createdAt: '', updatedAt: '' },
        ],
        entries: [
          { id: 'kb1', name: 'A', description: '', fileCount: 0, createdAt: '', updatedAt: '' },
        ],
      })

      removeKnowledgeBaseAndClearSelection('kb1')

      expect(useKbStore.getState().entries).toHaveLength(0)
      expect(useKbStore.getState().selectedId).toBeNull()
      expect(useKbStore.getState().currentKbId).toBeNull()
      expect(useKbStore.getState().currentFolderId).toBeNull()
      expect(useKbStore.getState().folders).toHaveLength(0)
      expect(useKbStore.getState().documents).toHaveLength(0)
      expect(useKbStore.getState().breadcrumbs).toHaveLength(0)
    })

    it('only removes entry when deleted kb is not selected', () => {
      useKbStore.setState({
        selectedId: 'kb2',
        currentKbId: 'kb2',
        currentFolderId: 'f1',
        folders: [
          { id: 'f1', kbId: 'kb2', parentId: null, name: 'F', createdAt: '', updatedAt: '' },
        ],
        entries: [
          { id: 'kb1', name: 'A', description: '', fileCount: 0, createdAt: '', updatedAt: '' },
          { id: 'kb2', name: 'B', description: '', fileCount: 0, createdAt: '', updatedAt: '' },
        ],
      })

      removeKnowledgeBaseAndClearSelection('kb1')

      expect(useKbStore.getState().entries).toHaveLength(1)
      expect(useKbStore.getState().entries[0].id).toBe('kb2')
      expect(useKbStore.getState().selectedId).toBe('kb2')
      expect(useKbStore.getState().currentKbId).toBe('kb2')
      expect(useKbStore.getState().folders).toHaveLength(1)
    })
  })
})
