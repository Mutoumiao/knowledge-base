import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileListItem } from '@/features/KnowledgeBase/components/FileListItem'
import type { DocumentItem, Folder } from '@/features/KnowledgeBase/types'

const mockFolder: Folder = {
  id: 'f1',
  kbId: 'kb1',
  parentId: null,
  name: '测试文件夹',
  createdAt: '2026-06-17T08:00:00.000Z',
  updatedAt: '2026-06-17T08:00:00.000Z',
}

function makeDocument(status: DocumentItem['status']): DocumentItem {
  return {
    id: 'd1',
    kbId: 'kb1',
    folderId: null,
    name: 'report.pdf',
    ext: 'pdf',
    mimeType: 'application/pdf',
    size: 2048,
    status,
    createdAt: '2026-06-17T08:00:00.000Z',
    updatedAt: '2026-06-17T08:00:00.000Z',
  }
}

describe('FileListItem', () => {
  it('renders folder row', () => {
    render(<FileListItem item={mockFolder} isFolder onClick={vi.fn()} />)

    expect(screen.getByText('测试文件夹')).toBeDefined()
    expect(screen.getByText('文件夹')).toBeDefined()
    expect(screen.getByRole('button', { name: /打开文件夹/ })).toBeDefined()
  })

  it('renders document row with type, size and date', () => {
    render(<FileListItem item={makeDocument('ready')} isFolder={false} onClick={vi.fn()} />)

    expect(screen.getByText('report.pdf')).toBeDefined()
    expect(screen.getByText('pdf')).toBeDefined()
    expect(screen.getByText('2.0 KB')).toBeDefined()
    expect(screen.getByText('2026/06/17')).toBeDefined()
    expect(screen.getByRole('button', { name: /打开文档/ })).toBeDefined()
    expect(screen.getByText('就绪')).toBeDefined()
  })

  it.each([
    { status: 'uploaded' as const, label: '排队中' },
    { status: 'indexing' as const, label: '索引中' },
    { status: 'failed' as const, label: '失败' },
  ])('renders status badge $status', ({ status, label }) => {
    render(<FileListItem item={makeDocument(status)} isFolder={false} onClick={vi.fn()} />)
    expect(screen.getByText(label)).toBeDefined()
  })

  it('shows errorMessage on failed badge title', () => {
    const item = { ...makeDocument('failed'), errorMessage: 'Knowledge AI failed' }
    render(<FileListItem item={item} isFolder={false} onClick={vi.fn()} />)
    expect(screen.getByText('失败').getAttribute('title')).toBe('Knowledge AI failed')
  })

  it('opens item on click and Enter/Space', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<FileListItem item={makeDocument('ready')} isFolder={false} onClick={onClick} />)

    const row = screen.getByRole('button', { name: /打开文档/ })
    await user.click(row)
    expect(onClick).toHaveBeenCalledTimes(1)

    await user.keyboard('{enter}')
    expect(onClick).toHaveBeenCalledTimes(2)

    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(3)
  })
})
