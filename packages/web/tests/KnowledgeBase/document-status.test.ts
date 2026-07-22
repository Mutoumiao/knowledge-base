import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_STATUS_CONFIG,
  getDocumentStatusConfig,
  getDocumentStatusTitle,
  hasPendingIndexDocuments,
  isDocumentIndexPending,
} from '@/features/KnowledgeBase/document-status'
import type { DocumentItem } from '@/features/KnowledgeBase/types'

function doc(status: DocumentItem['status']): DocumentItem {
  return {
    id: 'd1',
    kbId: 'kb1',
    folderId: null,
    name: 'a.md',
    ext: 'md',
    mimeType: 'text/markdown',
    size: 1,
    status,
    createdAt: '2026-06-17T08:00:00.000Z',
    updatedAt: '2026-06-17T08:00:00.000Z',
  }
}

describe('document-status', () => {
  it('maps terminal and pending labels', () => {
    expect(DOCUMENT_STATUS_CONFIG.uploaded.label).toBe('排队中')
    expect(DOCUMENT_STATUS_CONFIG.indexing.label).toBe('索引中')
    expect(DOCUMENT_STATUS_CONFIG.chunking.label).toBe('索引中')
    expect(DOCUMENT_STATUS_CONFIG.embedding.label).toBe('索引中')
    expect(DOCUMENT_STATUS_CONFIG.ready.label).toBe('就绪')
    expect(DOCUMENT_STATUS_CONFIG.failed.label).toBe('失败')
  })

  it('detects pending index statuses', () => {
    expect(isDocumentIndexPending('uploaded')).toBe(true)
    expect(isDocumentIndexPending('indexing')).toBe(true)
    expect(isDocumentIndexPending('ready')).toBe(false)
    expect(isDocumentIndexPending('failed')).toBe(false)
    expect(hasPendingIndexDocuments([doc('ready'), doc('indexing')])).toBe(true)
    expect(hasPendingIndexDocuments([doc('ready'), doc('failed')])).toBe(false)
  })

  it('returns null for missing status config', () => {
    expect(getDocumentStatusConfig(undefined)).toBeNull()
    expect(getDocumentStatusConfig(null)).toBeNull()
    expect(getDocumentStatusConfig('ready')?.label).toBe('就绪')
  })

  it('prefers errorMessage as title for failed status', () => {
    expect(getDocumentStatusTitle('failed', '  embedding failed  ')).toBe('embedding failed')
    expect(getDocumentStatusTitle('failed', null)).toBe('失败')
    expect(getDocumentStatusTitle('ready', 'ignored')).toBe('就绪')
  })
})
