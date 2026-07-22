import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/overlays/services/overlay-service', () => ({
  openDialog: vi.fn(),
}))

vi.mock('@/features/KnowledgeBase/services', () => ({
  loadKbItems: vi.fn(),
  cancelIndexStatusPoll: vi.fn(),
  searchKbItems: vi.fn(),
  previewDocument: vi.fn(),
  removeItem: vi.fn(),
  renameItem: vi.fn(),
  addFolder: vi.fn(),
}))

vi.mock('@/features/KnowledgeBase/open-upload-manager', () => ({
  openUploadManager: vi.fn(),
}))

import { FileBrowser } from '@/features/KnowledgeBase/components/FileBrowser'
import { useKbStore } from '@/features/KnowledgeBase/store'

describe('FileBrowser 上传 UI 收敛', () => {
  beforeEach(() => {
    useKbStore.setState({
      folders: [],
      documents: [],
      fileLoading: false,
      fileError: null,
      breadcrumbs: [],
      currentKbId: 'kb1',
      currentFolderId: null,
      uploadTasks: [],
      uploadManagerOpen: false,
      uploadMiniDismissed: false,
    })
  })

  it('does not render drop zone or progress bar in content area', () => {
    render(<FileBrowser kbName="测试库" />)
    expect(screen.queryByTestId('upload-drop-zone')).toBeNull()
    expect(screen.queryByTestId('progress-fill')).toBeNull()
  })

  it('shows empty state upload CTA without drop zone', () => {
    render(<FileBrowser kbName="测试库" />)
    expect(screen.getByText('暂无文件')).toBeDefined()
    expect(screen.getByText('上传文档开始构建知识库')).toBeDefined()
    // 工具栏 icon + 空态 CTA 均文案为「上传文件」
    expect(screen.getAllByRole('button', { name: '上传文件' }).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByTestId('upload-drop-zone')).toBeNull()
  })

  it('shows upload badge when pending tasks exist', () => {
    useKbStore.setState({
      uploadTasks: [
        {
          id: 't1',
          fileName: 'a.pdf',
          fileSize: 1,
          kbId: 'kb1',
          folderId: null,
          progress: 10,
          status: 'uploading',
        },
        {
          id: 't2',
          fileName: 'b.pdf',
          fileSize: 1,
          kbId: 'kb1',
          folderId: null,
          progress: 0,
          status: 'queued',
        },
        {
          id: 't3',
          fileName: 'c.pdf',
          fileSize: 1,
          kbId: 'kb1',
          folderId: null,
          progress: 0,
          status: 'failed',
          error: 'x',
        },
      ],
    })
    render(<FileBrowser kbName="测试库" />)
    expect(screen.getByTestId('upload-badge').textContent).toBe('2')
    expect(screen.getByRole('button', { name: '上传文件，2 个进行中' })).toBeDefined()
  })
})
