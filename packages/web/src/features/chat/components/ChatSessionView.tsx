import { XMarkdown } from '@ant-design/x-markdown'
import type { ChatSourceItem } from '@goferbot/data'
import type { UIMessage } from 'ai'
import { AlertCircleIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ChatPendingIndicator } from '@/components/chat-pending-indicator'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/utils/cn'
import { getMessageSources, getRetrievalEmpty, textFromUiMessage } from '../message-sources'
import { fetchProviders } from '../services'
import { useChatStore } from '../store'
import { ChatComposer } from './ChatComposer'
import { MessageFeedbackCta } from './MessageFeedbackCta'
import { SourceCitations, SourceDocsFloatingPanel } from './SourceCitations'

function retryFetchProviders() {
  void fetchProviders({ force: true })
}

interface ChatSessionViewProps {
  conversationId: string
  messages: UIMessage[]
  isStreaming: boolean
  onSend: (text: string) => void
  onRetry: () => void
  onAbort: () => void
  selectedProviderKey: string | null
  onChangeProvider: (key: string | null) => void
  selectedKbIds: string[]
  onChangeKbIds: (ids: string[]) => void
}

export function ChatSessionView({
  conversationId,
  messages,
  isStreaming,
  onSend,
  onRetry,
  onAbort,
  selectedProviderKey,
  onChangeProvider,
  selectedKbIds,
  onChangeKbIds,
}: ChatSessionViewProps) {
  const [inputValue, setInputValue] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  /** 右上角参考文档浮层（按消息点击展开） */
  const [panelSources, setPanelSources] = useState<ChatSourceItem[] | null>(null)
  const [panelMessageId, setPanelMessageId] = useState<string | null>(null)

  // 细粒度订阅，避免 loadHistory / setActiveSession 等无关字段触发整页重渲染
  const isLoadingHistory = useChatStore((s) => s.isLoadingHistory)
  const error = useChatStore((s) => s.error)
  const availableProviders = useChatStore((s) => s.availableProviders)
  const isInitLoading = useChatStore((s) => s.isInitLoading)
  const initError = useChatStore((s) => s.initError)
  const clearError = useChatStore((s) => s.clearError)

  const handleSubmit = useCallback(
    (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return
      if (selectedKbIds.length === 0) {
        setErrorMessage('请先选择至少一个知识库')
        return
      }
      setErrorMessage(null)
      setInputValue('')
      onSend(trimmed)
    },
    [selectedKbIds, onSend],
  )

  const handleOpenSources = useCallback((sources: ChatSourceItem[], messageId: string) => {
    setPanelSources(sources)
    setPanelMessageId(messageId)
  }, [])

  const handleCloseSources = useCallback(() => {
    setPanelSources(null)
    setPanelMessageId(null)
  }, [])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => clearError(), 5000)
    return () => clearTimeout(timer)
  }, [error, clearError])

  // 切换会话时关闭浮层
  useEffect(() => {
    setPanelSources(null)
    setPanelMessageId(null)
  }, [conversationId])

  const displayMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  const lastDisplay = displayMessages[displayMessages.length - 1]
  const lastAssistantEmpty =
    lastDisplay?.role === 'assistant' && !textFromUiMessage(lastDisplay).trim()
  /** 已提交/流式中，但尚无正文：首 token 前展示等待态 */
  const showPendingBubble =
    isStreaming && (lastDisplay?.role === 'user' || lastAssistantEmpty || !lastDisplay)

  return (
    <div className="relative flex h-full flex-col bg-surface-1" data-testid="chat-session-view">
      {/* 右上角参考文档浮层 */}
      {panelSources && (
        <SourceDocsFloatingPanel sources={panelSources} onClose={handleCloseSources} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-4 py-8">
          {isLoadingHistory && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}

          {!isLoadingHistory && displayMessages.length === 0 && !isStreaming && (
            <div className="flex h-64 items-center justify-center">
              <div className="text-center">
                <h3 className="text-lg font-medium text-text-primary">开始知识库问答</h3>
                <p className="mt-2 text-sm text-text-secondary">
                  请先选择知识库，再输入问题（强制绑定 KB）
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4" data-testid="chat-message-list">
            {displayMessages.map((msg, index) => {
              const isUser = msg.role === 'user'
              const content = textFromUiMessage(msg)
              const isLast = index === displayMessages.length - 1
              const streamingThis = isStreaming && isLast && msg.role === 'assistant'
              const sources = !isUser ? getMessageSources(msg) : undefined
              const retrievalEmpty = !isUser ? getRetrievalEmpty(msg) : false
              const messageKey = msg.id || `msg-${conversationId}-${index}`
              const sourcesPanelOpen = panelMessageId === messageKey
              const waitingFirstToken = streamingThis && !content.trim()

              return (
                <div
                  key={messageKey}
                  className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}
                  data-testid={isUser ? 'chat-msg-user' : 'chat-msg-assistant'}
                  data-message-id={msg.id}
                >
                  <div
                    className={cn(
                      'max-w-[85%] text-sm leading-relaxed',
                      isUser
                        ? 'rounded-2xl bg-brand-primary px-4 py-2.5 text-white'
                        : 'text-text-primary',
                    )}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{content}</p>
                    ) : waitingFirstToken ? (
                      <ChatPendingIndicator label="正在检索与生成…" />
                    ) : (
                      <div>
                        <SourceCitations
                          sources={sources}
                          retrievalEmpty={retrievalEmpty}
                          panelOpen={sourcesPanelOpen}
                          onOpenPanel={(s) => handleOpenSources(s, messageKey)}
                        />
                        <XMarkdown
                          content={content}
                          streaming={{
                            hasNextChunk: streamingThis,
                          }}
                        />
                        {/* 仅知识库问答 CTA；Companion 无此组件 */}
                        {!streamingThis && content.trim() && conversationId && msg.id && (
                          <MessageFeedbackCta
                            messageId={msg.id}
                            sessionId={conversationId}
                            disabled={isStreaming}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* 用户消息已上屏、助手气泡尚未出现时的独立等待气泡 */}
            {showPendingBubble && lastDisplay?.role !== 'assistant' && (
              <div
                className="flex w-full justify-start"
                data-testid="chat-pending-bubble"
              >
                <div className="max-w-[85%] text-sm leading-relaxed text-text-primary">
                  <ChatPendingIndicator label="正在检索与生成…" />
                </div>
              </div>
            )}
          </div>

          {errorMessage && (
            <div
              className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4"
              data-testid="error-banner"
              role="alert"
            >
              <p className="text-sm text-destructive-foreground">{errorMessage}</p>
              {errorMessage.includes('知识库') ? null : (
                <Button
                  data-testid="error-retry-btn"
                  variant="destructive"
                  size="sm"
                  onClick={onRetry}
                  className="mt-2"
                >
                  重试
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 底部统一输入胶囊（与首页 ChatEmptyHome 同一组件） */}
      <div className="flex justify-center px-4 pb-6 pt-2">
        <ChatComposer
          value={inputValue}
          onChange={(v) => {
            setInputValue(v)
            if (errorMessage) setErrorMessage(null)
          }}
          onSubmit={handleSubmit}
          onAbort={onAbort}
          loading={isStreaming}
          selectedKbIds={selectedKbIds}
          onChangeKbIds={onChangeKbIds}
          selectedProviderKey={selectedProviderKey}
          onChangeProvider={onChangeProvider}
          providers={availableProviders}
          isInitLoading={isInitLoading}
          initError={initError}
          onRetryProviders={retryFetchProviders}
          error={errorMessage}
          showDisclaimer
          placeholder={selectedKbIds.length === 0 ? '请先选择知识库，再输入问题…' : '继续提问…'}
          sendTestId="session-send-btn"
        />
      </div>

      {error && (
        <div
          className="absolute bottom-28 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-error/20 bg-surface-1 px-4 py-2.5 text-sm text-error shadow-xl"
          role="status"
        >
          <AlertCircleIcon className="size-4" />
          <span>{error}</span>
          <Button
            data-testid="error-toast-close"
            variant="ghost"
            size="icon-xs"
            onClick={clearError}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
