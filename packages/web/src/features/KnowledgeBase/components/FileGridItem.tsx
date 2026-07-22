import { FolderIcon } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatFileSize } from '@/utils/file'
import { getDocumentStatusConfig, getDocumentStatusTitle } from '../document-status'
import type { DocumentItem, Folder } from '../types'

interface FileGridItemProps {
  item: Folder | DocumentItem
  isFolder: boolean
  documentCount?: number
  onClick: () => void
}

const FOLDER_ICON_COLORS: Record<string, { bg: string; icon: string }> = {
  docs: { bg: 'bg-[#E8F5E9]', icon: 'text-[#4CAF50]' },
  调研原始资料: { bg: 'bg-[#E3F2FD]', icon: 'text-[#2196F3]' },
  会议纪要: { bg: 'bg-[#FFF3E0]', icon: 'text-[#FF9800]' },
  竞品分析: { bg: 'bg-[#F3E5F5]', icon: 'text-[#9C27B0]' },
}

const FILE_TYPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pdf: { bg: 'bg-[#FEE2E2]', text: 'text-[#DC2626]', label: 'PDF' },
  xlsx: { bg: 'bg-[#DCFCE7]', text: 'text-[#16A34A]', label: 'XLSX' },
  pptx: { bg: 'bg-[#FEF3C7]', text: 'text-[#D97706]', label: 'PPTX' },
  md: { bg: 'bg-[#F1F3F6]', text: 'text-[#5E6673]', label: 'MD' },
}

const FILE_ICON_BG: Record<string, string> = {
  pdf: 'bg-[#F44336]',
  xlsx: 'bg-[#4CAF50]',
  pptx: 'bg-[#FFC107]',
  md: 'bg-[#9E9E9E]',
}

interface FolderCardProps {
  item: Folder
  documentCount: number
  onClick: () => void
}

function FolderCard({ item, documentCount, onClick }: FolderCardProps) {
  const colors = FOLDER_ICON_COLORS[item.name] || { bg: 'bg-[#E3F2FD]', icon: 'text-[#2196F3]' }
  const date = new Date(item.updatedAt)
  const dateStr = `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

  return (
    <div className="group relative flex flex-col gap-2.5 rounded-xl border border-[#E7EAF0] bg-white p-3.5 transition-colors hover:bg-[#F7F8FA] focus-within:ring-2 focus-within:ring-[#5B7CFA] focus-within:ring-offset-2">
      {/* 透明背景按钮覆盖整张卡片，让卡片本身支持键盘操作；内容层禁止指针事件，避免遮挡点击 */}
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none"
        onClick={onClick}
        aria-label={`打开文件夹 ${item.name}`}
      />
      <div className="relative z-10 flex items-center justify-between pointer-events-none">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-[10px]', colors.bg)}>
          <FolderIcon className={cn('h-6 w-6', colors.icon)} />
        </div>
        <span
          className="flex h-6 w-6 items-center justify-center rounded-md text-[#9AA3AF]"
          aria-hidden="true"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>更多操作</title>
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
        </span>
      </div>
      <div className="relative z-10 flex flex-col gap-0.5 pointer-events-none">
        <span className="text-sm font-medium text-[#1F2328]">{item.name}</span>
        <span className="text-xs text-[#9AA3AF]">{documentCount} 个文件</span>
        <span className="text-xs text-[#9AA3AF]">{dateStr}</span>
      </div>
    </div>
  )
}

function DocumentCard({ item, onClick }: { item: DocumentItem; onClick: () => void }) {
  const ext = item.ext ?? ''
  const typeColors = FILE_TYPE_COLORS[ext] || {
    bg: 'bg-[#F1F3F6]',
    text: 'text-[#5E6673]',
    label: ext.toUpperCase(),
  }
  const iconBg = FILE_ICON_BG[ext] || 'bg-[#9E9E9E]'
  const date = new Date(item.updatedAt)
  const dateStr = `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const firstLetter = item.name.charAt(0).toUpperCase()
  const statusConfig = getDocumentStatusConfig(item.status)
  const statusTitle = statusConfig
    ? getDocumentStatusTitle(item.status, item.errorMessage)
    : undefined

  return (
    <div className="group relative flex h-[150px] flex-col gap-2.5 rounded-xl border border-[#E7EAF0] bg-white p-3.5 transition-colors hover:bg-[#F7F8FA] focus-within:ring-2 focus-within:ring-[#5B7CFA] focus-within:ring-offset-2">
      {/* 透明背景按钮覆盖整张卡片，让卡片本身支持键盘操作；内容层禁止指针事件，避免遮挡点击 */}
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none"
        onClick={onClick}
        aria-label={`打开文档 ${item.name}${statusConfig ? `，${statusConfig.label}` : ''}`}
        title={statusTitle}
      />
      {statusConfig && (
        <span
          className={cn(
            // pointer-events-none：点击穿透到整卡按钮；失败原因通过 button title 暴露
            'absolute right-2 top-2 z-10 rounded-full px-1.5 py-0.5 text-[10px] font-medium pointer-events-none',
            statusConfig.bg,
            statusConfig.text,
          )}
        >
          {statusConfig.label}
        </span>
      )}
      <div className="relative z-10 flex items-center justify-between pointer-events-none">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-[10px]', iconBg)}>
          <span className="text-base font-bold text-white">{firstLetter}</span>
        </div>
        <span
          className="flex h-6 w-6 items-center justify-center rounded-md text-[#9AA3AF]"
          aria-hidden="true"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>更多操作</title>
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
        </span>
      </div>
      <div className="relative z-10 flex flex-1 flex-col gap-1 pointer-events-none">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#1F2328] truncate">{item.name}</span>
        </div>
        <span
          className={cn(
            'w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold',
            typeColors.bg,
            typeColors.text,
          )}
        >
          {typeColors.label}
        </span>
        <span className="text-xs text-[#9AA3AF]">{formatFileSize(item.size)}</span>
        <span className="text-xs text-[#9AA3AF]">{dateStr}</span>
      </div>
    </div>
  )
}

export function FileGridItem({ item, isFolder, documentCount = 0, onClick }: FileGridItemProps) {
  if (isFolder) {
    return <FolderCard item={item as Folder} documentCount={documentCount} onClick={onClick} />
  }
  return <DocumentCard item={item as DocumentItem} onClick={onClick} />
}
