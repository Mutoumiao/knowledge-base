/**
 * Companion 模块类型定义。
 *
 * 严格对齐后端 CompanionChatController / CompanionManagementController 的 DTO 结构。
 */

export interface PaginationMeta {
  page: number
  size: number
  total: number
  totalPages: number
}

export type CompanionSource = 'system' | 'user'

export interface Companion {
  id: string
  /** system=官方目录；user=自定义 */
  source?: CompanionSource
  userId?: string | null
  name: string
  headline?: string
  description?: string
  personality?: string
  tone?: string
  /** Web API 不再下发 boundaries/guardrails/defaultPrompt */
  avatarKey?: string
  /** 服务端解析的可访问头像 URL（优先于 /api/files 拼 key） */
  avatarUrl?: string | null
  backgroundStory?: string
  openingMessage?: string
  visibility?: string
  status: CompanionStatus
  lastAssistantMessage?: string
  createdAt: string
  updatedAt: string
}

export type CompanionStatus = 'draft' | 'published' | 'archived'

export interface CompanionListResponse {
  items: Companion[]
  pagination: PaginationMeta
}

/** Web 自定义简表 */
export interface CreateCompanionPayload {
  name: string
  description: string
  personality: string
  openingMessage?: string
  avatarKey?: string
}

export type UpdateCompanionPayload = Partial<CreateCompanionPayload>

export interface UpdateCompanionStatusPayload {
  status: CompanionStatus
}

export interface CreateConversationPayload {
  companionId: string
  title?: string
  /** 清空聊天历史、保留长期记忆（唯一会话模型下的「新会话」） */
  fresh?: boolean
}

export interface Conversation {
  id: string
  companionId: string
  userId: string
  status: 'active' | 'archived'
  lastMessageAt: string
  createdAt: string
}

export interface ConversationListResponse {
  items: Conversation[]
  pagination: PaginationMeta
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  metadata?: string | null
  feedback?: CompanionMessageFeedback | null
}

export interface MessageListResponse {
  items: Message[]
  pagination: PaginationMeta
}

/** API 契约主类型（与 Prisma FeedbackRating / packages/data 一致） */
export type FeedbackRating = 'positive' | 'negative'

export interface CreateFeedbackPayload {
  rating: FeedbackRating
  reason?: string
  note?: string
}

export interface Feedback {
  id: string
  messageId: string
  rating: FeedbackRating
  reason?: string | null
  note?: string | null
  createdAt?: string
}

export interface Memory {
  id: string
  companionId: string
  type: MemoryType
  content: string
  importance: number
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
  sourceMessageId?: string
}

export interface MemoryListResponse {
  items: Memory[]
  pagination: PaginationMeta
}

export interface ChatPayload {
  conversationId: string
  content: string
}

export interface FetchParams {
  page?: number
  size?: number
  status?: CompanionStatus
  /** official | mine */
  tab?: 'official' | 'mine'
  source?: CompanionSource
}

export type CompanionMessageRole = 'user' | 'assistant' | 'system'

export interface CompanionMessage {
  id: string
  conversationId: string
  role: CompanionMessageRole
  content: string
  createdAt: string
  feedback?: CompanionMessageFeedback | null
  streaming?: boolean
  /** 关怀消息标记 */
  isCare?: boolean
  careScene?: string
}

export interface CompanionMessageFeedback {
  rating: FeedbackRating
  reason?: string
  note?: string
}

/** UI 拇指图标 ↔ API rating 映射（仅客户端，不得泄漏为 HTTP 主类型） */
export function uiThumbToRating(thumb: 'up' | 'down'): FeedbackRating {
  return thumb === 'up' ? 'positive' : 'negative'
}

export function ratingToUiThumb(rating: FeedbackRating): 'up' | 'down' {
  return rating === 'positive' ? 'up' : 'down'
}

export type MemoryType =
  | 'preference'
  | 'boundary'
  | 'relationship_goal'
  | 'conversation_style'
  | 'important_fact'

export type MemoryFilter = 'all' | MemoryType

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  preference: '偏好',
  boundary: '边界',
  relationship_goal: '关系目标',
  conversation_style: '对话风格',
  important_fact: '重要事实',
}

export interface UpdateMemoryPayload {
  content?: string
  importance?: number
  type?: MemoryType
  status?: 'active' | 'disabled' | 'deleted'
}

export type CareScene =
  | 'morning'
  | 'night'
  | 'long_absence'
  | 'stress_support'
  | 'relationship_warmup'
  | 'anniversary'

export type CareTone = 'light' | 'gentle' | 'intimate'
export type CareFrequency = 'daily' | 'weekly' | 'monthly' | 'custom'

export interface CarePlan {
  id?: string
  companionId: string
  enabled: boolean
  frequency: CareFrequency
  preferredTime?: string | null
  scenes: CareScene[]
  tone: CareTone
  customPrompt?: string | null
  nextRunAtMs?: number | null
  isDefault?: boolean
}

export interface UpdateCarePlanPayload {
  enabled?: boolean
  frequency?: CareFrequency
  preferredTime?: string | null
  scenes?: CareScene[]
  tone?: CareTone
  customPrompt?: string | null
}

export interface GenerateCareEventPayload {
  scene?: CareScene
  tone?: CareTone
  customPrompt?: string
}

export interface CareEvent {
  id: string
  companionId: string
  conversationId: string
  messageId: string
  scene: CareScene
  status: string
  message: string
  generatedAtMs: number
}

export const CARE_SCENE_LABELS: Record<CareScene, string> = {
  morning: '早安问候',
  night: '晚安陪伴',
  long_absence: '久未聊天',
  stress_support: '压力陪伴',
  relationship_warmup: '关系升温',
  anniversary: '特别纪念',
}

export const CARE_TONE_LABELS: Record<CareTone, string> = {
  light: '轻盈',
  gentle: '温柔',
  intimate: '亲密',
}
