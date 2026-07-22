export interface Folder {
  id: string
  kbId: string
  parentId: string | null
  name: string
  createdAt: string
  updatedAt: string
}

export interface DocumentItem {
  id: string
  kbId: string
  folderId: string | null
  name: string
  ext: string | null
  mimeType: string | null
  size: number | null
  status: 'uploaded' | 'chunking' | 'embedding' | 'indexing' | 'ready' | 'failed'
  /** 索引失败原因（后端 Document.errorMessage） */
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
}

export interface UploadTask {
  id: string
  fileName: string
  fileSize: number
  progress: number
  status: 'queued' | 'uploading' | 'completed' | 'failed'
  error?: string
  kbId: string
  folderId?: string | null
  file?: File
}

export type ViewMode = 'grid' | 'list'

export type SortOption =
  | 'name-asc'
  | 'name-desc'
  | 'updatedAt-desc'
  | 'updatedAt-asc'
  | 'createdAt-desc'
  | 'createdAt-asc'
  | 'size-desc'
  | 'size-asc'
  | 'type-desc'
  | 'type-asc'

export interface ItemSortParams {
  sortBy: 'name' | 'updatedAt' | 'createdAt' | 'size' | 'type'
  sortOrder: 'asc' | 'desc'
}

const SORTABLE_FIELDS = ['name', 'updatedAt', 'createdAt', 'size', 'type'] as const
const SORT_ORDERS = ['asc', 'desc'] as const

export function parseSortOption(option: SortOption): ItemSortParams {
  const [rawBy, rawOrder] = option.split('-')
  const sortBy = (SORTABLE_FIELDS as readonly string[]).includes(rawBy)
    ? (rawBy as ItemSortParams['sortBy'])
    : 'updatedAt'
  const sortOrder = (SORT_ORDERS as readonly string[]).includes(rawOrder)
    ? (rawOrder as ItemSortParams['sortOrder'])
    : 'desc'
  return { sortBy, sortOrder }
}

export type FilterType = 'all' | 'document' | 'image' | 'other'
