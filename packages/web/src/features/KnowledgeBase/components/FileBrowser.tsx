import { FolderIcon, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { openDialog } from '@/overlays/services/overlay-service'
import { openUploadManager } from '../open-upload-manager'
import {
  addFolder,
  cancelIndexStatusPoll,
  loadKbItems,
  previewDocument,
  removeItem,
  renameItem,
  searchKbItems,
} from '../services'
import { useKbStore } from '../store'
import {
  type DocumentItem,
  type Folder,
  parseSortOption,
  type SortOption,
  type ViewMode,
} from '../types'
import { FileContextMenu } from './FileContextMenu'
import { FileGridItem } from './FileGridItem'
import { FileListItem } from './FileListItem'
import { KnowledgeBaseToolbar } from './KnowledgeBaseToolbar'

interface FileBrowserProps {
  kbName: string
}

function LoadingState() {
  const skeletonKeys = ['skeleton-0', 'skeleton-1', 'skeleton-2', 'skeleton-3'] as const
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {skeletonKeys.map((key) => (
        <div
          key={key}
          data-testid="skeleton-card"
          className="h-32 bg-[#F7F8FA] rounded-xl animate-pulse"
        />
      ))}
    </div>
  )
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px]">
      <FolderIcon className="h-12 w-12 text-text-tertiary mb-2" />
      <p className="text-text-secondary text-sm">暂无文件</p>
      <p className="mt-1 text-xs text-text-tertiary">上传文档开始构建知识库</p>
      <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={onUpload}>
        <Upload className="h-3.5 w-3.5" />
        上传文件
      </Button>
    </div>
  )
}

interface FileViewProps {
  folders: Folder[]
  documents: DocumentItem[]
  folderDocumentCounts: Map<string, number>
  totalCount: number
  onFolderClick: (folder: Folder) => void
  onDocumentClick: (doc: DocumentItem) => void
  onOpenItem: (item: Folder | DocumentItem) => void
  onRenameItem: (item: Folder | DocumentItem) => void
  onDeleteItem: (item: Folder | DocumentItem) => void
  onMoveItem: (item: Folder | DocumentItem) => void
  onCopyItem: (item: Folder | DocumentItem) => void
}

function GridView({
  folders,
  documents,
  folderDocumentCounts,
  totalCount,
  onFolderClick,
  onDocumentClick,
  onOpenItem,
  onRenameItem,
  onDeleteItem,
  onMoveItem,
  onCopyItem,
}: FileViewProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {folders.map((folder) => (
          <FileContextMenu
            key={folder.id}
            item={folder}
            onOpen={onOpenItem}
            onRename={onRenameItem}
            onDelete={onDeleteItem}
            onMove={onMoveItem}
            onCopy={onCopyItem}
          >
            <div>
              <FileGridItem
                item={folder}
                isFolder
                documentCount={folderDocumentCounts.get(folder.id) ?? 0}
                onClick={() => onFolderClick(folder)}
              />
            </div>
          </FileContextMenu>
        ))}
        {documents.map((doc) => (
          <FileContextMenu
            key={doc.id}
            item={doc}
            onRename={onRenameItem}
            onDelete={onDeleteItem}
            onMove={onMoveItem}
            onCopy={onCopyItem}
          >
            <div>
              <FileGridItem item={doc} isFolder={false} onClick={() => onDocumentClick(doc)} />
            </div>
          </FileContextMenu>
        ))}
      </div>
      <div className="flex justify-center py-2 text-sm text-[#9AA3AF]">共 {totalCount} 项</div>
    </div>
  )
}

function ListView({
  folders,
  documents,
  totalCount,
  onFolderClick,
  onDocumentClick,
  onOpenItem,
  onRenameItem,
  onDeleteItem,
  onMoveItem,
  onCopyItem,
}: Omit<FileViewProps, 'folderDocumentCounts'>) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <Table aria-label="文件列表">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>名称</TableHead>
              <TableHead>类型</TableHead>
              <TableHead className="text-right">大小</TableHead>
              <TableHead className="text-right">日期</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {folders.map((folder) => (
              <FileContextMenu
                key={folder.id}
                item={folder}
                onOpen={onOpenItem}
                onRename={onRenameItem}
                onDelete={onDeleteItem}
                onMove={onMoveItem}
                onCopy={onCopyItem}
              >
                <FileListItem item={folder} isFolder onClick={() => onFolderClick(folder)} />
              </FileContextMenu>
            ))}
            {documents.map((doc) => (
              <FileContextMenu
                key={doc.id}
                item={doc}
                onRename={onRenameItem}
                onDelete={onDeleteItem}
                onMove={onMoveItem}
                onCopy={onCopyItem}
              >
                <FileListItem item={doc} isFolder={false} onClick={() => onDocumentClick(doc)} />
              </FileContextMenu>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-center py-2 text-sm text-[#9AA3AF]">共 {totalCount} 项</div>
    </div>
  )
}

export function FileBrowser({ kbName }: FileBrowserProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortOption, setSortOption] = useState<SortOption>('updatedAt-desc')
  const [searchQuery, setSearchQuery] = useState('')

  // 细粒度订阅：避免 uploadTasks 模拟进度 tick 拖垮整表重渲染
  const folders = useKbStore((s) => s.folders)
  const documents = useKbStore((s) => s.documents)
  const fileLoading = useKbStore((s) => s.fileLoading)
  const fileError = useKbStore((s) => s.fileError)
  const breadcrumbs = useKbStore((s) => s.breadcrumbs)
  const setCurrentFolderId = useKbStore((s) => s.setCurrentFolderId)
  const currentKbId = useKbStore((s) => s.currentKbId)
  const currentFolderId = useKbStore((s) => s.currentFolderId)
  const setFileListSort = useKbStore((s) => s.setFileListSort)
  const uploadBadgeCount = useKbStore((s) => s.pendingUploadCount())

  const sortParams = useMemo(() => parseSortOption(sortOption), [sortOption])

  useEffect(() => {
    setFileListSort(sortParams)
  }, [sortParams, setFileListSort])

  const folderDocumentCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const doc of documents) {
      if (!doc.folderId) continue
      counts.set(doc.folderId, (counts.get(doc.folderId) ?? 0) + 1)
    }
    return counts
  }, [documents])

  useEffect(() => {
    if (!currentKbId) return

    const trimmed = searchQuery.trim()
    if (!trimmed) {
      // 进入目录时若有排队/索引中文档，静默轮询直到终态（覆盖刷新页面后仍在索引）
      void loadKbItems(currentKbId, currentFolderId, sortParams, { pollIndexStatus: true })
      return () => {
        cancelIndexStatusPoll()
      }
    }

    // 搜索态不需要索引轮询
    cancelIndexStatusPoll()
    const timer = setTimeout(() => {
      searchKbItems(trimmed)
    }, 300)
    return () => {
      clearTimeout(timer)
      cancelIndexStatusPoll()
    }
  }, [currentKbId, currentFolderId, searchQuery, sortParams])

  function handleFolderClick(folder: Folder) {
    setCurrentFolderId(folder.id)
  }

  async function handleDocumentClick(doc: DocumentItem) {
    const preview = await previewDocument(doc.id)
    if (!preview) return
    const PreviewDialog = (await import('@/overlays/dialogs/PreviewDialog')).default
    await openDialog(PreviewDialog, { document: doc, preview })
  }

  function handleNavigate(folderId: string | null) {
    setCurrentFolderId(folderId)
  }

  function handleOpenItem(item: Folder | DocumentItem) {
    if (!('status' in item)) {
      setCurrentFolderId(item.id)
    }
  }

  async function handleRenameItem(item: Folder | DocumentItem) {
    const RenameItemDialog = (await import('@/overlays/dialogs/RenameItemDialog')).default
    await openDialog(RenameItemDialog, {
      itemName: item.name,
      isFolder: !('status' in item),
      onConfirm: async (newName: string) => {
        await renameItem(item, newName)
      },
    })
  }

  async function handleDeleteItem(item: Folder | DocumentItem) {
    const DeleteItemDialog = (await import('@/overlays/dialogs/DeleteItemDialog')).default
    await openDialog(DeleteItemDialog, {
      itemName: item.name,
      isFolder: !('status' in item),
      onConfirm: async () => {
        await removeItem(item)
      },
    })
  }

  async function handleMoveItem(item: Folder | DocumentItem) {
    const MoveCopyDialog = (await import('./MoveCopyDialog')).default
    await openDialog(MoveCopyDialog, {
      mode: 'move',
      item,
      onConfirm: async () => {
        if (!currentKbId) return
        await loadKbItems(currentKbId, currentFolderId, sortParams)
      },
    })
  }

  async function handleCopyItem(item: Folder | DocumentItem) {
    const MoveCopyDialog = (await import('./MoveCopyDialog')).default
    await openDialog(MoveCopyDialog, {
      mode: 'copy',
      item,
      onConfirm: async () => {
        if (!currentKbId) return
        await loadKbItems(currentKbId, currentFolderId, sortParams)
      },
    })
  }

  async function handleCreateFolder() {
    if (!currentKbId) return
    const CreateFolderDialog = (await import('@/overlays/dialogs/CreateFolderDialog')).default
    await openDialog(CreateFolderDialog, {
      onConfirm: async (name: string) => {
        await addFolder(currentKbId, name, currentFolderId)
      },
    })
  }

  function handleRetry() {
    if (!currentKbId) return
    const trimmed = searchQuery.trim()
    if (trimmed) {
      searchKbItems(trimmed)
    } else {
      loadKbItems(currentKbId, currentFolderId, sortParams)
    }
  }

  function handleOpenUploadManager() {
    void openUploadManager({ sort: sortParams })
  }

  const renderContent = () => {
    if (fileLoading) {
      return <LoadingState />
    }

    if (fileError) {
      return (
        <div className="bg-error/10 border border-error rounded-lg p-4">
          <p className="text-error text-sm">{fileError}</p>
          <Button variant="destructive" size="sm" onClick={handleRetry} className="mt-2">
            重试
          </Button>
        </div>
      )
    }

    const totalCount = folders.length + documents.length

    if (totalCount === 0) {
      return <EmptyState onUpload={handleOpenUploadManager} />
    }

    const viewProps = {
      folders,
      documents,
      totalCount,
      onFolderClick: handleFolderClick,
      onDocumentClick: handleDocumentClick,
      onOpenItem: handleOpenItem,
      onRenameItem: handleRenameItem,
      onDeleteItem: handleDeleteItem,
      onMoveItem: handleMoveItem,
      onCopyItem: handleCopyItem,
    }

    if (viewMode === 'grid') {
      return <GridView {...viewProps} folderDocumentCounts={folderDocumentCounts} />
    }

    return <ListView {...viewProps} />
  }

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_2px_8px_rgba(160,158,158,0.25)]"
      role="application"
      aria-label="文件浏览器"
    >
      <KnowledgeBaseToolbar
        kbName={kbName}
        breadcrumb={breadcrumbs}
        onNavigate={handleNavigate}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sortOption={sortOption}
        onSortChange={setSortOption}
        onUpload={handleOpenUploadManager}
        uploadBadgeCount={uploadBadgeCount}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <div className="flex-1 overflow-auto p-6">
        <FileContextMenu item={null} onCreateFolder={handleCreateFolder}>
          <div className="min-h-[200px]">{renderContent()}</div>
        </FileContextMenu>
      </div>
    </div>
  )
}
