import type { KbListResponse } from '@goferbot/data'
import { toast } from 'sonner'
import {
  copyDocument as apiCopyDocument,
  copyFolder as apiCopyFolder,
  createFolder as apiCreateFolder,
  deleteDocument as apiDeleteDocument,
  deleteFolder as apiDeleteFolder,
  getBreadcrumbs as apiGetBreadcrumbs,
  getDocuments as apiGetDocuments,
  getFolders as apiGetFolders,
  moveDocument as apiMoveDocument,
  moveFolder as apiMoveFolder,
  previewDocument as apiPreviewDocument,
  renameDocument as apiRenameDocument,
  renameFolder as apiRenameFolder,
} from '@/api/file'
import {
  getKbList as apiGetKbList,
  searchKbItems as apiSearchKbItems,
  updateKb as apiUpdateKb,
  uploadFile as apiUploadFile,
} from '@/api/KnowledgeBase'
import { hasPendingIndexDocuments } from './document-status'
import { useKbStore } from './store'
import type { DocumentItem, Folder, ItemSortParams } from './types'
import { partitionUploadFiles } from './upload-validation'

class ServiceError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ServiceError'
    this.status = status
  }
}

function getHttpStatus(error: unknown): number | null {
  if (error && typeof error === 'object') {
    if ('status' in error && typeof (error as { status?: unknown }).status === 'number') {
      return (error as { status: number }).status
    }
    const response = (error as { response?: unknown }).response
    if (
      response &&
      typeof response === 'object' &&
      'status' in response &&
      typeof (response as { status?: unknown }).status === 'number'
    ) {
      return (response as { status: number }).status
    }
  }
  if (error instanceof Error) {
    const match = error.message.match(/^HTTP (\d{3})/)
    if (match) return Number(match[1])
  }
  return null
}

function isNetworkError(error: unknown): boolean {
  const message =
    error instanceof TypeError || error instanceof Error ? error.message.toLowerCase() : ''
  return (
    message.includes('network') || message.includes('fetch') || message.includes('failed to fetch')
  )
}

function mapErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return '网络连接异常，请检查网络后重试'
  const status = getHttpStatus(error)
  switch (status) {
    case 400:
      return '请求参数错误，请检查后重试'
    case 401:
    case 403:
      return '登录已过期，请重新登录'
    case 404:
      return '资源不存在或已被删除'
    case 409:
      return '名称冲突，请更换后重试'
    case 422:
      return '输入数据校验失败，请检查后重试'
    case 429:
      return '操作过于频繁，请稍后再试'
    case 500:
    case 502:
    case 503:
      return '服务器繁忙，请稍后重试'
    default:
      return '操作失败，请稍后重试'
  }
}

function throwServiceError(error: unknown): never {
  const status = getHttpStatus(error)
  throw new ServiceError(mapErrorMessage(error), status ?? undefined)
}

function isFolderItem(item: Folder | DocumentItem): item is Folder {
  return !('status' in item)
}

/** 文档列表 API 分页响应（或历史数组形态）→ DocumentItem[] */
function normalizeDocumentList(payload: unknown): DocumentItem[] {
  if (Array.isArray(payload)) {
    return payload.map(normalizeDocumentItem)
  }
  if (payload && typeof payload === 'object' && 'items' in payload) {
    const items = (payload as { items?: unknown }).items
    if (Array.isArray(items)) {
      return items.map(normalizeDocumentItem)
    }
  }
  return []
}

function normalizeDocumentItem(raw: unknown): DocumentItem {
  const doc = raw as DocumentItem & {
    size?: number | string | null
    errorMessage?: string | null
    error?: string | null
  }
  const size =
    doc.size === null || doc.size === undefined
      ? null
      : typeof doc.size === 'string'
        ? Number(doc.size)
        : doc.size
  const errorMessage = doc.errorMessage ?? doc.error ?? null
  return {
    ...doc,
    size: Number.isFinite(size as number) ? (size as number) : null,
    errorMessage,
  }
}

// ============================================================================
// 知识库操作
// ============================================================================

export async function fetchKbList(options?: {
  /** 无感刷新：不置 isLoading，避免 keep-alive 二次进入骨架闪烁 */
  silent?: boolean
}): Promise<{ success: boolean; error?: string }> {
  const silent = options?.silent === true
  const { setEntries, setKbLoading } = useKbStore.getState()
  if (!silent) {
    setKbLoading(true)
  }
  try {
    const res = await apiGetKbList().send()
    const data = res as KbListResponse
    setEntries(data.items ?? [])
    return { success: true }
  } catch (e) {
    return { success: false, error: mapErrorMessage(e) }
  } finally {
    if (!silent) {
      setKbLoading(false)
    }
  }
}

const pinningIds = new Set<string>()

export async function pinKnowledgeBase(id: string, isPinned: boolean): Promise<boolean> {
  if (pinningIds.has(id)) return false
  pinningIds.add(id)
  try {
    await apiUpdateKb(id, { isPinned }).send()
    await fetchKbList()
    return true
  } catch (e) {
    toast.error(mapErrorMessage(e))
    return false
  } finally {
    pinningIds.delete(id)
  }
}

export function removeKnowledgeBaseAndClearSelection(kbId: string) {
  const {
    selectedId,
    setSelectedId,
    setCurrentKbId,
    setCurrentFolderId,
    setFolders,
    setDocuments,
    setBreadcrumbs,
    removeEntry,
  } = useKbStore.getState()

  removeEntry(kbId)
  if (selectedId !== kbId) return

  setSelectedId(null)
  setCurrentKbId(null)
  setCurrentFolderId(null)
  setFolders([])
  setDocuments([])
  setBreadcrumbs([])
}

let currentLoadId = 0

/** 索引状态轮询：单目录只保留最新一轮，避免多路上传叠加 timer */
let indexPollGeneration = 0
let indexPollTimer: ReturnType<typeof setTimeout> | null = null
const INDEX_POLL_INTERVAL_MS = 2000
const INDEX_POLL_MAX_MS = 90_000

export type LoadKbItemsOptions = {
  /** 无感刷新：不置 fileLoading，避免轮询时列表骨架闪烁 */
  silent?: boolean
  /** 加载后若存在排队/索引中文档，启动静默轮询直到终态或超时 */
  pollIndexStatus?: boolean
}

/** 取消索引状态轮询（切目录 / 卸载 FileBrowser / 新一轮 schedule 前调用） */
export function cancelIndexStatusPoll() {
  indexPollGeneration += 1
  if (indexPollTimer != null) {
    clearTimeout(indexPollTimer)
    indexPollTimer = null
  }
}

export async function loadKbItems(
  kbId: string,
  folderId: string | null = null,
  sort?: ItemSortParams,
  options?: LoadKbItemsOptions,
) {
  const {
    setFolders,
    setDocuments,
    setCurrentKbId,
    setCurrentFolderId,
    setFileLoading,
    setFileError,
    setBreadcrumbs,
  } = useKbStore.getState()

  const silent = options?.silent === true
  const thisLoadId = ++currentLoadId

  setCurrentKbId(kbId)
  setCurrentFolderId(folderId)
  if (!silent) {
    setFileLoading(true)
    setFileError(null)
  }

  const folderSort = sort
    ? { sortBy: sort.sortBy === 'type' ? 'name' : sort.sortBy, sortOrder: sort.sortOrder }
    : undefined
  const documentSort = sort ? { sortBy: sort.sortBy, sortOrder: sort.sortOrder } : undefined

  try {
    const [folders, documentsRes, breadcrumbs] = await Promise.all([
      apiGetFolders(kbId, folderId, folderSort).send(),
      apiGetDocuments(kbId, folderId, documentSort).send(),
      apiGetBreadcrumbs(kbId, folderId).send(),
    ])
    if (thisLoadId !== currentLoadId) return
    setFolders((folders as Folder[]) ?? [])
    // 文档列表接口为分页：{ items, total, page, pageSize }；兼容旧数组响应
    const documents = normalizeDocumentList(documentsRes)
    setDocuments(documents)
    setBreadcrumbs((breadcrumbs as Folder[]) ?? [])

    if (options?.pollIndexStatus && hasPendingIndexDocuments(documents)) {
      scheduleIndexStatusPoll(kbId, folderId, sort)
    }
  } catch (e) {
    if (thisLoadId !== currentLoadId) return
    if (!silent) {
      setFileError(mapErrorMessage(e))
    }
  } finally {
    if (!silent && thisLoadId === currentLoadId) {
      setFileLoading(false)
    }
  }
}

/**
 * 轮询当前目录文档索引状态（uploaded/indexing → ready|failed）。
 * 切库/切目录时 currentLoadId 递增会丢弃过期结果；generation + clearTimeout 取消旧 timer。
 */
function scheduleIndexStatusPoll(kbId: string, folderId: string | null, sort?: ItemSortParams) {
  // 先清旧 timer 再开新 generation，避免 setTimeout 无清除
  if (indexPollTimer != null) {
    clearTimeout(indexPollTimer)
    indexPollTimer = null
  }
  const generation = ++indexPollGeneration
  const startedAt = Date.now()

  const arm = (delayMs: number) => {
    if (generation !== indexPollGeneration) return
    indexPollTimer = setTimeout(() => {
      indexPollTimer = null
      void tick()
    }, delayMs)
  }

  const tick = async () => {
    if (generation !== indexPollGeneration) return

    const state = useKbStore.getState()
    if (state.currentKbId !== kbId || state.currentFolderId !== folderId) {
      cancelIndexStatusPoll()
      return
    }
    if (Date.now() - startedAt >= INDEX_POLL_MAX_MS) {
      cancelIndexStatusPoll()
      return
    }

    await loadKbItems(kbId, folderId, sort ?? state.fileListSort ?? undefined, {
      silent: true,
    })

    if (generation !== indexPollGeneration) return

    const after = useKbStore.getState()
    if (after.currentKbId !== kbId || after.currentFolderId !== folderId) {
      cancelIndexStatusPoll()
      return
    }
    if (!hasPendingIndexDocuments(after.documents)) {
      cancelIndexStatusPoll()
      return
    }
    if (Date.now() - startedAt >= INDEX_POLL_MAX_MS) {
      cancelIndexStatusPoll()
      return
    }

    arm(INDEX_POLL_INTERVAL_MS)
  }

  arm(INDEX_POLL_INTERVAL_MS)
}

// ============================================================================
// 文件操作
// ============================================================================

export async function removeDocument(docId: string) {
  const { currentKbId, documents, setDocuments, setFileLoading, setFileError } =
    useKbStore.getState()
  if (!currentKbId) throw new ServiceError('未选择知识库')

  setFileLoading(true)
  setFileError(null)
  try {
    await apiDeleteDocument(currentKbId, docId).send()
    setDocuments(documents.filter((d) => d.id !== docId))
  } catch (e) {
    throwServiceError(e)
  } finally {
    setFileLoading(false)
  }
}

export async function renameDocument(docId: string, name: string) {
  const { currentKbId, documents, setDocuments, setFileLoading, setFileError } =
    useKbStore.getState()
  if (!currentKbId) throw new ServiceError('未选择知识库')

  setFileLoading(true)
  setFileError(null)
  try {
    const updated = await apiRenameDocument(currentKbId, docId, name).send()
    setDocuments(documents.map((d) => (d.id === docId ? (updated as DocumentItem) : d)))
  } catch (e) {
    throwServiceError(e)
  } finally {
    setFileLoading(false)
  }
}

export async function moveDocument(
  docId: string,
  targetKbId: string,
  targetFolderId: string | null,
) {
  const { currentKbId, currentFolderId, documents, setDocuments, setFileLoading, setFileError } =
    useKbStore.getState()
  if (!currentKbId) throw new ServiceError('未选择知识库')
  if (targetKbId === currentKbId && targetFolderId === currentFolderId) {
    throw new ServiceError('目标位置不能与当前位置相同')
  }

  setFileLoading(true)
  setFileError(null)
  try {
    await apiMoveDocument(currentKbId, docId, targetKbId, targetFolderId).send()
    setDocuments(documents.filter((d) => d.id !== docId))
  } catch (e) {
    throwServiceError(e)
  } finally {
    setFileLoading(false)
  }
}

export async function moveFolder(
  folderId: string,
  targetKbId: string,
  targetFolderId: string | null,
) {
  const { currentKbId, currentFolderId, folders, setFolders, setFileLoading, setFileError } =
    useKbStore.getState()
  if (!currentKbId) throw new ServiceError('未选择知识库')
  if (targetKbId === currentKbId && targetFolderId === currentFolderId) {
    throw new ServiceError('目标位置不能与当前位置相同')
  }

  setFileLoading(true)
  setFileError(null)
  try {
    await apiMoveFolder(currentKbId, folderId, targetKbId, targetFolderId).send()
    setFolders(folders.filter((f) => f.id !== folderId))
  } catch (e) {
    throwServiceError(e)
  } finally {
    setFileLoading(false)
  }
}

export async function copyDocument(
  docId: string,
  targetKbId: string,
  targetFolderId: string | null,
) {
  const { currentKbId, documents, setDocuments, setFileLoading, setFileError } =
    useKbStore.getState()
  if (!currentKbId) throw new ServiceError('未选择知识库')

  setFileLoading(true)
  setFileError(null)
  try {
    const copied = await apiCopyDocument(currentKbId, docId, targetKbId, targetFolderId).send()
    if (targetKbId === currentKbId && targetFolderId === useKbStore.getState().currentFolderId) {
      setDocuments([...documents, copied as DocumentItem])
    }
    return copied
  } catch (e) {
    throwServiceError(e)
  } finally {
    setFileLoading(false)
  }
}

export async function copyFolder(
  folderId: string,
  targetKbId: string,
  targetFolderId: string | null,
) {
  const { currentKbId, folders, setFolders, setFileLoading, setFileError } = useKbStore.getState()
  if (!currentKbId) throw new ServiceError('未选择知识库')

  setFileLoading(true)
  setFileError(null)
  try {
    const copied = await apiCopyFolder(currentKbId, folderId, targetKbId, targetFolderId).send()
    if (targetKbId === currentKbId && targetFolderId === useKbStore.getState().currentFolderId) {
      setFolders([...folders, copied as Folder])
    }
    return copied
  } catch (e) {
    throwServiceError(e)
  } finally {
    setFileLoading(false)
  }
}

export async function previewDocument(docId: string) {
  const { currentKbId, setFileLoading, setFileError } = useKbStore.getState()
  if (!currentKbId) return null

  setFileLoading(true)
  setFileError(null)
  try {
    const result = await apiPreviewDocument(currentKbId, docId).send()
    return result as {
      type: 'text' | 'pdf' | 'unsupported'
      mimeType: string
      content?: string
      url?: string | null
    }
  } catch (e) {
    setFileError(mapErrorMessage(e))
    return null
  } finally {
    setFileLoading(false)
  }
}

let currentSearchId = 0

export async function searchKbItems(query: string) {
  const { currentKbId, setFolders, setDocuments, setFileLoading, setFileError } =
    useKbStore.getState()
  if (!currentKbId) {
    setFileError('未选择知识库')
    return { folders: [], documents: [] }
  }

  const trimmed = query.trim()
  if (!trimmed) {
    setFileError(null)
    setFolders([])
    setDocuments([])
    return { folders: [], documents: [] }
  }

  // ponytail: 限制搜索查询长度，避免过长查询导致性能问题
  const MAX_QUERY_LENGTH = 200
  if (trimmed.length > MAX_QUERY_LENGTH) {
    setFileError(`搜索关键词过长（最大${MAX_QUERY_LENGTH}字符）`)
    return { folders: [], documents: [] }
  }

  const thisSearchId = ++currentSearchId

  setFileLoading(true)
  setFileError(null)
  try {
    const result = await apiSearchKbItems(currentKbId, trimmed).send()
    const data = result as { folders: Folder[]; documents: DocumentItem[] }
    if (thisSearchId === currentSearchId) {
      setFolders(data.folders ?? [])
      setDocuments(data.documents ?? [])
    }
    return data
  } catch (e) {
    const msg = mapErrorMessage(e)
    if (thisSearchId === currentSearchId) {
      setFileError(msg)
    }
    return { folders: [], documents: [] }
  } finally {
    if (thisSearchId === currentSearchId) {
      setFileLoading(false)
    }
  }
}

export async function createFolder(kbId: string, name: string, parentId: string | null = null) {
  try {
    const updated = await apiCreateFolder(kbId, name, parentId).send()
    return updated as Folder
  } catch (e) {
    throwServiceError(e)
  }
}

export async function renameFolder(kbId: string, folderId: string, name: string) {
  try {
    const updated = await apiRenameFolder(kbId, folderId, name).send()
    return updated as Folder
  } catch (e) {
    throwServiceError(e)
  }
}

export async function removeFolder(kbId: string, folderId: string) {
  try {
    await apiDeleteFolder(kbId, folderId).send()
  } catch (e) {
    throwServiceError(e)
  }
}

const removingIds = new Set<string>()
const renamingIds = new Set<string>()

export async function removeItem(item: Folder | DocumentItem) {
  const {
    currentKbId,
    folders,
    documents,
    setFolders,
    setDocuments,
    setFileLoading,
    setFileError,
  } = useKbStore.getState()
  if (!currentKbId) throw new ServiceError('未选择知识库')
  if (removingIds.has(item.id)) throw new ServiceError('操作进行中，请稍候')

  removingIds.add(item.id)
  setFileLoading(true)
  setFileError(null)
  try {
    if (isFolderItem(item)) {
      await apiDeleteFolder(currentKbId, item.id).send()
      setFolders(folders.filter((f) => f.id !== item.id))
    } else {
      await apiDeleteDocument(currentKbId, item.id).send()
      setDocuments(documents.filter((d) => d.id !== item.id))
    }
  } catch (e) {
    throwServiceError(e)
  } finally {
    removingIds.delete(item.id)
    setFileLoading(false)
  }
}

export async function renameItem(item: Folder | DocumentItem, name: string) {
  const {
    currentKbId,
    folders,
    documents,
    setFolders,
    setDocuments,
    setFileLoading,
    setFileError,
  } = useKbStore.getState()
  if (!currentKbId) throw new ServiceError('未选择知识库')
  if (renamingIds.has(item.id)) throw new ServiceError('操作进行中，请稍候')

  renamingIds.add(item.id)
  setFileLoading(true)
  setFileError(null)
  try {
    if (isFolderItem(item)) {
      const updated = await apiRenameFolder(currentKbId, item.id, name).send()
      setFolders(folders.map((f) => (f.id === item.id ? (updated as Folder) : f)))
    } else {
      const updated = await apiRenameDocument(currentKbId, item.id, name).send()
      setDocuments(documents.map((d) => (d.id === item.id ? (updated as DocumentItem) : d)))
    }
  } catch (e) {
    throwServiceError(e)
  } finally {
    renamingIds.delete(item.id)
    setFileLoading(false)
  }
}

export async function addFolder(kbId: string, name: string, parentId?: string | null) {
  const { folders, setFolders, setFileLoading, setFileError } = useKbStore.getState()
  setFileLoading(true)
  setFileError(null)
  try {
    const created = await apiCreateFolder(kbId, name, parentId).send()
    setFolders([...folders, created as Folder])
    return created as Folder
  } catch (e) {
    throwServiceError(e)
  } finally {
    setFileLoading(false)
  }
}

// ============================================================================
// 上传操作
// ============================================================================

/** 跨多次 uploadFiles 调用的全局并发闸门（与 store.maxConcurrent 对齐） */
const uploadConcurrencyGate = {
  active: 0,
  waiters: [] as Array<() => void>,
  async acquire(max: number) {
    if (this.active < max) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
    this.active += 1
  },
  release() {
    this.active = Math.max(0, this.active - 1)
    const next = this.waiters.shift()
    next?.()
  },
}

export async function uploadFiles(
  kbId: string,
  files: File[],
  folderId?: string | null,
  sort?: ItemSortParams,
) {
  const {
    addUploadTask,
    startUploadTask,
    updateUploadProgress,
    markUploadComplete,
    markUploadFailed,
    maxConcurrent,
  } = useKbStore.getState()

  if (files.length === 0) return []

  // 与 DropZone 共用扩展名校验；过滤非法后继续上传合法文件（错误 UI 由弹窗承担）
  const { valid: validFiles } = partitionUploadFiles(files)
  if (validFiles.length === 0) return []

  const uploadOne = async (file: File): Promise<string> => {
    // 先入队（queued 可见），再抢全局并发槽
    const taskId = addUploadTask({
      fileName: file.name,
      fileSize: file.size,
      kbId,
      folderId,
      file,
    })

    await uploadConcurrencyGate.acquire(maxConcurrent)

    const formData = new FormData()
    formData.append('file', file)
    if (folderId) formData.append('folderId', folderId)

    startUploadTask(taskId)

    // 模拟进度；失败路径也必须 clearInterval，避免泄漏与幽灵进度更新
    let progress = 0
    const progressInterval = setInterval(() => {
      progress = Math.min(progress + 10, 90)
      updateUploadProgress(taskId, progress)
    }, 200)

    try {
      await apiUploadFile(kbId, formData).send()
      updateUploadProgress(taskId, 100)
      markUploadComplete(taskId)
    } catch (e) {
      markUploadFailed(taskId, mapErrorMessage(e))
    } finally {
      clearInterval(progressInterval)
      uploadConcurrencyGate.release()
    }

    return taskId
  }

  // 全部并行入队，由全局闸门限制同时 uploading 数量
  const taskIds = await Promise.all(validFiles.map(uploadOne))

  // 仅当用户仍在目标目录浏览时刷新列表，避免关窗后切库/切目录被拽回
  const current = useKbStore.getState()
  const targetFolderId = folderId ?? null
  if (current.currentKbId === kbId && current.currentFolderId === targetFolderId) {
    const listSort = sort ?? current.fileListSort ?? undefined
    await loadKbItems(kbId, targetFolderId, listSort, { pollIndexStatus: true })
  }

  return taskIds
}

export function navigateToFolder(folderId: string | null) {
  const { currentKbId, setCurrentFolderId } = useKbStore.getState()
  if (!currentKbId) return
  setCurrentFolderId(folderId)
}
