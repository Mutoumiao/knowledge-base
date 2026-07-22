import type {
  AvailableProvidersResponse,
  CreateSessionRequest,
  MessageListResponse,
  ModelProvider,
  Session,
  SessionListResponse,
} from '@goferbot/data'
import { alovaInstance } from '@/utils/server'

export type ChatAvailableProvider = ModelProvider
export type ChatAvailableProvidersResponse = AvailableProvidersResponse

/** 获取当前用户可用的 chat 模型列表（内置 + 自定义预留） */
export const getChatProviders = () =>
  alovaInstance.Get<ChatAvailableProvidersResponse>('/settings/chat/providers')

/** 获取消息历史 — Dify 风格 */
export const getMessages = (conversationId: string, page = 1, size = 20) =>
  alovaInstance.Get<MessageListResponse>('/chat-messages', {
    params: { conversation_id: conversationId, page, size },
  })

/** 获取会话列表 */
export const getSessions = (page = 1, size = 20) =>
  alovaInstance.Get<SessionListResponse>('/sessions', {
    params: { page, size },
  })

/** 根据 ID 获取单个会话详情 */
export const getSessionById = (sessionId: string) =>
  alovaInstance.Get<Session>(`/sessions/${sessionId}`)

/** 创建新会话 */
export const createSession = (data?: CreateSessionRequest) =>
  alovaInstance.Post<Session>('/sessions', data ?? {})

/** 删除会话 */
export const deleteSession = (sessionId: string) => alovaInstance.Delete(`/sessions/${sessionId}`)

/** 重命名会话 */
export const renameSession = (sessionId: string, title: string) =>
  alovaInstance.Post<Session>(`/sessions/${sessionId}/rename`, { title })

/** 知识库问答显式反馈（仅 Chat，非 Companion） */
export const submitChatMessageFeedback = (body: {
  messageId: string
  sessionId: string
  rating: 'helpful' | 'not_helpful'
  reason?: string
  traceId?: string
}) =>
  alovaInstance.Post<{ ok: true; messageId: string; rating: string }>(
    '/chat-messages/feedback',
    body,
  )
