import { FolderIcon } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatDate, formatFileSize, getFileIcon } from '@/utils/file'
import { getDocumentStatusConfig, getDocumentStatusTitle } from '../document-status'
import type { DocumentItem, Folder } from '../types'

interface FileListItemProps {
  item: Folder | DocumentItem
  isFolder: boolean
  onClick: () => void
}

export function FileListItem({ item, isFolder, onClick }: FileListItemProps) {
  const Icon = isFolder ? FolderIcon : getFileIcon((item as DocumentItem).ext ?? null)
  const doc = item as DocumentItem
  const size = isFolder ? null : doc.size
  const date = 'createdAt' in item ? item.createdAt : ''
  const ext = isFolder ? null : doc.ext
  const statusConfig = !isFolder ? getDocumentStatusConfig(doc.status) : null
  const statusTitle =
    !isFolder && statusConfig ? getDocumentStatusTitle(doc.status, doc.errorMessage) : undefined

  return (
    <tr className="relative border-b border-border-default hover:bg-surface-2 transition-colors focus-within:bg-[#EEF2FF] focus-within:ring-2 focus-within:ring-[#5B7CFA]">
      <td colSpan={5} className="p-0">
        <button
          type="button"
          className="flex w-full items-center cursor-pointer bg-transparent border-none p-0 text-left focus-visible:outline-none"
          onClick={onClick}
          aria-label={
            isFolder
              ? `打开文件夹 ${item.name}`
              : `打开文档 ${item.name}${statusConfig ? `，${statusConfig.label}` : ''}`
          }
        >
          <span className="py-2 px-3">
            <Icon className="h-5 w-5 text-text-secondary" />
          </span>
          <span className="py-2 px-3 text-sm text-text-primary flex-1 min-w-0 flex items-center gap-2">
            <span className="truncate">{item.name}</span>
            {statusConfig && (
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  statusConfig.bg,
                  statusConfig.text,
                )}
                title={statusTitle}
              >
                {statusConfig.label}
              </span>
            )}
          </span>
          <span className="py-2 px-3 text-xs text-text-tertiary">
            {isFolder ? '文件夹' : (ext ?? '--')}
          </span>
          <span className="py-2 px-3 text-xs text-text-tertiary text-right">
            {size !== null ? formatFileSize(size) : '--'}
          </span>
          <span className="py-2 px-3 text-xs text-text-tertiary text-right">
            {date ? formatDate(date) : '--'}
          </span>
        </button>
      </td>
    </tr>
  )
}
