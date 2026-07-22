/**
 * Companion 模块 API 调用层。
 *
 * 复用项目已有的 alova 实例（`@/utils/server`），不引入新 HTTP 库。
 * 所有方法返回 alova Method 实例，调用方通过 `.send()` 触发请求。
 */
import { alovaInstance } from '@/utils/server'
import type {
  CareEvent,
  CarePlan,
  Companion,
  CompanionListResponse,
  Conversation,
  ConversationListResponse,
  CreateCompanionPayload,
  CreateConversationPayload,
  CreateFeedbackPayload,
  Feedback,
  FetchParams,
  GenerateCareEventPayload,
  Memory,
  MemoryListResponse,
  MemoryType,
  MessageListResponse,
  UpdateCarePlanPayload,
  UpdateCompanionPayload,
  UpdateCompanionStatusPayload,
  UpdateMemoryPayload,
} from './types'

// alova baseURL 已含 /api，此处只写业务 path，避免 /api/api 双前缀

// ---- 伴侣 CRUD ----

export function createCompanion(payload: CreateCompanionPayload) {
  return alovaInstance.Post<Companion>('/companions', payload)
}

export function listCompanions(params?: FetchParams) {
  return alovaInstance.Get<CompanionListResponse>('/companions', {
    params,
  })
}

export function getCompanion(id: string) {
  return alovaInstance.Get<Companion>(`/companions/${id}`)
}

export function updateCompanion(id: string, payload: UpdateCompanionPayload) {
  return alovaInstance.Put<Companion>(`/companions/${id}`, payload)
}

export function deleteCompanion(id: string) {
  return alovaInstance.Delete<void>(`/companions/${id}`)
}

export function updateCompanionStatus(id: string, payload: UpdateCompanionStatusPayload) {
  return alovaInstance.Patch<Companion>(`/companions/${id}/status`, payload)
}

// ---- 会话管理 ----

export function createConversation(payload: CreateConversationPayload) {
  return alovaInstance.Post<Conversation>('/companion/conversations', payload)
}

export function listConversations(companionId: string, params?: { page?: number; size?: number }) {
  return alovaInstance.Get<ConversationListResponse>('/companion/conversations', {
    params: { ...params, companionId },
  })
}

export function getConversation(id: string) {
  return alovaInstance.Get<Conversation>(`/companion/conversations/${id}`)
}

/** 清空会话消息与摘要，保留长期记忆 */
export function resetConversation(id: string) {
  return alovaInstance.Post<Conversation>(`/companion/conversations/${id}/reset`, {})
}

// ---- 聊天 / 消息 / 反馈 / 记忆 ----

export function listMessages(conversationId: string, params?: { page?: number; size?: number }) {
  return alovaInstance.Get<MessageListResponse>(
    `/companion/conversations/${conversationId}/messages`,
    { params },
  )
}

export function submitFeedback(messageId: string, payload: CreateFeedbackPayload) {
  return alovaInstance.Post<Feedback>(`/companion/messages/${messageId}/feedback`, payload)
}

export function listMemories(
  companionId: string,
  params?: { page?: number; size?: number; type?: MemoryType; status?: string },
) {
  return alovaInstance.Get<MemoryListResponse>('/companion/memories', {
    params: { ...params, companionId },
  })
}

export function updateMemory(memoryId: string, payload: UpdateMemoryPayload) {
  return alovaInstance.Patch<Memory>(`/companion/memories/${memoryId}`, payload)
}

export function deleteMemory(memoryId: string) {
  return alovaInstance.Delete<{ success: boolean }>(`/companion/memories/${memoryId}`)
}

// ---- 头像上传 ----

export function uploadCompanionAvatar(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return alovaInstance.Post<{
    avatarKey: string
    avatarUrl?: string
    width: number
    height: number
  }>('/companions/avatar', formData)
}

// ---- Care ----

export function getCarePlan(companionId: string) {
  return alovaInstance.Get<CarePlan>(`/companions/${companionId}/care-plan`)
}

export function updateCarePlan(companionId: string, payload: UpdateCarePlanPayload) {
  return alovaInstance.Patch<CarePlan>(`/companions/${companionId}/care-plan`, payload)
}

export function generateCareEvent(companionId: string, payload?: GenerateCareEventPayload) {
  return alovaInstance.Post<CareEvent>(
    `/companions/${companionId}/care-events/generate`,
    payload ?? {},
  )
}
