import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileGridItem } from '@/features/KnowledgeBase/components/FileGridItem'
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

describe('FileGridItem', () => {
  it('renders folder card with name and document count', () => {
    render(<FileGridItem item={mockFolder} isFolder documentCount={5} onClick={vi.fn()} />)

    expect(screen.getByText('测试文件夹')).toBeDefined()
    expect(screen.getByText('5 个文件')).toBeDefined()
    expect(screen.getByRole('button', { name: /打开文件夹/ })).toBeDefined()
  })

  it.each([
    { status: 'uploaded' as const, label: '排队中' },
    { status: 'chunking' as const, label: '索引中' },
    { status: 'embedding' as const, label: '索引中' },
    { status: 'indexing' as const, label: '索引中' },
    { status: 'ready' as const, label: '就绪' },
    { status: 'failed' as const, label: '失败' },
  ])('renders status label $status for documents', ({ status, label }) => {
    render(<FileGridItem item={makeDocument(status)} isFolder={false} onClick={vi.fn()} />)
    expect(screen.getByText(label)).toBeDefined()
    expect(screen.getByRole('button', { name: new RegExp(label) })).toBeDefined()
  })

  it('exposes errorMessage via card title when failed', () => {
    const item = { ...makeDocument('failed'), errorMessage: 'Parsed document text is empty' }
    render(<FileGridItem item={item} isFolder={false} onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /失败/ }).getAttribute('title')).toBe(
      'Parsed document text is empty',
    )
  })

  it('renders document name and file size', () => {
    render(<FileGridItem item={makeDocument('ready')} isFolder={false} onClick={vi.fn()} />)

    expect(screen.getByText('report.pdf')).toBeDefined()
    expect(screen.getByText('2.0 KB')).toBeDefined()
    expect(screen.getByRole('button', { name: /打开文档/ })).toBeDefined()
  })

  it('opens folder on click and Enter', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<FileGridItem item={mockFolder} isFolder documentCount={3} onClick={onClick} />)

    const button = screen.getByRole('button', { name: /打开文件夹/ })
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)

    await user.keyboard('{enter}')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('opens document on click and Enter', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<FileGridItem item={makeDocument('ready')} isFolder={false} onClick={onClick} />)

    const button = screen.getByRole('button', { name: /打开文档/ })
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)

    await user.keyboard('{enter}')
    expect(onClick).toHaveBeenCalledTimes(2)
  })
})
