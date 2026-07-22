import { ArrowLeft, Brain, Heart, MessageSquarePlus, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Companion } from '../types'
import { CompanionStatusTag } from './CompanionStatusTag'

interface CompanionHeaderProps {
  companion: Companion
  onBack: () => void
  onOpenMemories: () => void
  onOpenCare?: () => void
  onEdit?: () => void
  /** 清空本会话聊天记录，保留长期记忆 */
  onFreshChat?: () => void
  /** 嵌入工作台时：窄屏返回清选中；宽屏可隐藏返回 */
  embedded?: boolean
}

export function CompanionHeader({
  companion,
  onBack,
  onOpenMemories,
  onOpenCare,
  onEdit,
  onFreshChat,
  embedded = false,
}: CompanionHeaderProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle bg-surface-1 p-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        aria-label={embedded ? '关闭对话' : '返回'}
        className={embedded ? 'md:hidden' : undefined}
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <div
        className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 text-base font-medium"
        style={{
          backgroundImage: companion.avatarUrl
            ? `url(${companion.avatarUrl})`
            : companion.avatarKey
              ? `url(/api/files/${companion.avatarKey})`
              : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {!companion.avatarUrl && !companion.avatarKey && companion.name.charAt(0)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium truncate">{companion.name}</h2>
          <CompanionStatusTag status={companion.status} />
        </div>
        {companion.headline && (
          <p className="text-sm text-muted-foreground truncate">{companion.headline}</p>
        )}
      </div>

      {onEdit && (
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-4 w-4 mr-1" />
          编辑
        </Button>
      )}
      {onFreshChat && (
        <Button variant="outline" size="sm" onClick={onFreshChat} title="清空聊天记录，保留长期记忆">
          <MessageSquarePlus className="h-4 w-4 mr-1" />
          新聊天
        </Button>
      )}
      {onOpenCare && (
        <Button variant="outline" size="sm" onClick={onOpenCare}>
          <Heart className="h-4 w-4 mr-1" />
          关怀
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={onOpenMemories}>
        <Brain className="h-4 w-4 mr-1" />
        记忆库
      </Button>
    </div>
  )
}
