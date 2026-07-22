import type { DocumentItem } from './types'

export type DocumentStatusStyle = {
  bg: string
  text: string
  label: string
}

/** 与后端 DocumentStatus 对齐；chunking/embedding 为遗留中间态，展示合并为「索引中」 */
export const DOCUMENT_STATUS_CONFIG: Record<DocumentItem['status'], DocumentStatusStyle> = {
  uploaded: { bg: 'bg-[#9E9E9E]', text: 'text-white', label: '排队中' },
  chunking: { bg: 'bg-[#5B7CFA]', text: 'text-white', label: '索引中' },
  embedding: { bg: 'bg-[#5B7CFA]', text: 'text-white', label: '索引中' },
  indexing: { bg: 'bg-[#5B7CFA]', text: 'text-white', label: '索引中' },
  ready: { bg: 'bg-[#4CAF50]', text: 'text-white', label: '就绪' },
  failed: { bg: 'bg-[#F44336]', text: 'text-white', label: '失败' },
}

const PENDING_STATUSES = new Set<DocumentItem['status']>([
  'uploaded',
  'chunking',
  'embedding',
  'indexing',
])

export function isDocumentIndexPending(status: DocumentItem['status']): boolean {
  return PENDING_STATUSES.has(status)
}

export function hasPendingIndexDocuments(documents: DocumentItem[]): boolean {
  return documents.some((d) => isDocumentIndexPending(d.status))
}

export function getDocumentStatusConfig(
  status: DocumentItem['status'] | undefined | null,
): DocumentStatusStyle | null {
  if (!status) return null
  return DOCUMENT_STATUS_CONFIG[status] ?? null
}

/** failed 时用 errorMessage 做 title；其它状态返回徽章文案 */
export function getDocumentStatusTitle(
  status: DocumentItem['status'],
  errorMessage?: string | null,
): string {
  const config = DOCUMENT_STATUS_CONFIG[status]
  if (status === 'failed' && errorMessage?.trim()) {
    return errorMessage.trim()
  }
  return config?.label ?? status
}
