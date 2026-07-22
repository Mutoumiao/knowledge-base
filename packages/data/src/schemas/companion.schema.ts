import { z } from 'zod'

/** Web 自定义简表：仅 name/description/personality 必填 + 可选开场/头像；多余键 strip */
export const createCompanionSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(2000),
    personality: z.string().min(1).max(2000),
    openingMessage: z.string().max(500).optional(),
    avatarKey: z.string().max(500).optional(),
  })
  .strip()

export const updateCompanionSchema = createCompanionSchema.partial().strip()

/** Admin 内置伴侣全量人设（含安全字段） */
export const createAdminCompanionSchema = z.object({
  name: z.string().min(1).max(100),
  headline: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  personality: z.string().max(2000).optional(),
  tone: z.string().max(500).optional(),
  boundaries: z.string().max(2000).optional(),
  guardrailsPrompt: z.string().max(3000).optional(),
  /** 服务端拼接权威；Admin 可预览 */
  defaultPrompt: z.string().max(12000).optional(),
  avatarKey: z.string().max(500).optional(),
  backgroundStory: z.string().max(5000).optional(),
  openingMessage: z.string().max(500).optional(),
  visibility: z.string().max(50).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
})

export const updateAdminCompanionSchema = createAdminCompanionSchema.partial()

export const companionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  size: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  /** official=system+published；mine=当前用户 user 源（默认排除 archived） */
  tab: z.enum(['official', 'mine']).optional(),
  source: z.enum(['system', 'user']).optional(),
})

/** Web 列表/详情响应中剥离的安全与完整 prompt 字段 */
export const WEB_COMPANION_OMIT_FIELDS = [
  'boundaries',
  'guardrailsPrompt',
  'defaultPrompt',
] as const

export const createConversationSchema = z.object({
  companionId: z.string().min(1),
  title: z.string().max(200).optional(),
  /**
   * 在 user×companion 唯一会话约束下，true 表示「开启新聊天」：
   * 复用会话行，清空消息/摘要/计数，保留长期记忆（跨会话记忆依赖此语义）。
   */
  fresh: z.boolean().optional(),
})

export const conversationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  size: z.coerce.number().int().min(1).max(100).optional(),
  companionId: z.string().min(1).optional(),
})

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().min(1).max(10000),
})

export const messageListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  size: z.coerce.number().int().min(1).max(100).optional(),
})

export const createMemorySchema = z.object({
  companionId: z.string().min(1),
  type: z.enum([
    'preference',
    'boundary',
    'relationship_goal',
    'conversation_style',
    'important_fact',
  ]),
  content: z.string().min(1).max(5000),
  importance: z.number().int().min(1).max(5).default(3),
})

export const memoryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  size: z.coerce.number().int().min(1).max(100).optional(),
  companionId: z.string().min(1).optional(),
  status: z.enum(['active', 'disabled', 'deleted']).optional(),
  type: z
    .enum(['preference', 'boundary', 'relationship_goal', 'conversation_style', 'important_fact'])
    .optional(),
})

export const updateMemorySchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  type: z
    .enum(['preference', 'boundary', 'relationship_goal', 'conversation_style', 'important_fact'])
    .optional(),
  status: z.enum(['active', 'disabled', 'deleted']).optional(),
})

/** 反馈 rating 契约主类型：positive | negative（禁止 up/down 或 1/-1 作为 API 主类型） */
export const feedbackRatingSchema = z.enum(['positive', 'negative'])

/**
 * POST /companion/messages/:id/feedback
 * companionId/conversationId 可由服务端从 messageId 推导，故可选。
 */
export const createFeedbackSchema = z.object({
  companionId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  rating: feedbackRatingSchema,
  reason: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
})

export const updateCompanionStatusSchema = z.object({
  status: z.enum(['draft', 'published', 'archived']),
})

/** 助手消息 pipeline metadata 快照（完整 system prompt 不得入库） */
export const companionMessageMetadataSchema = z.object({
  safety: z
    .object({
      safetyLevel: z.string().optional(),
      boundaryAction: z.string().optional(),
      reason: z.string().optional(),
    })
    .optional(),
  intent: z
    .object({
      primary: z.string().optional(),
      userNeed: z.string().optional(),
    })
    .optional(),
  emotion: z
    .object({
      primaryEmotion: z.string().optional(),
      intensity: z.number().optional(),
      replyTone: z.string().optional(),
    })
    .optional(),
  relationship: z
    .object({
      stage: z.string().optional(),
      intimacyPermission: z.string().optional(),
    })
    .optional(),
  route: z
    .object({
      route: z.string().optional(),
      responseLength: z.string().optional(),
    })
    .optional(),
  policySummary: z
    .object({
      policy: z.string().optional(),
      openingMove: z.string().optional(),
    })
    .optional(),
  quality: z.unknown().nullable().optional(),
  summaryText: z.string().max(200).optional(),
  extractedMemoryCount: z.number().int().min(0).optional(),
  /** 关怀消息标记 */
  care: z
    .object({
      scene: z.string(),
      eventId: z.string().optional(),
    })
    .optional(),
})

export const careSceneSchema = z.enum([
  'morning',
  'night',
  'long_absence',
  'stress_support',
  'relationship_warmup',
  'anniversary',
])

export const careToneSchema = z.enum(['light', 'gentle', 'intimate'])

export const careFrequencySchema = z.enum(['daily', 'weekly', 'monthly', 'custom'])

export const carePlanSchema = z.object({
  id: z.string().optional(),
  companionId: z.string().min(1),
  enabled: z.boolean().default(true),
  frequency: careFrequencySchema.default('daily'),
  preferredTime: z.string().max(32).nullable().optional(),
  scenes: z.array(careSceneSchema).min(1).default(['morning', 'night']),
  tone: careToneSchema.default('gentle'),
  customPrompt: z.string().max(1000).nullable().optional(),
  nextRunAtMs: z.number().int().nullable().optional(),
  /** GET 无行时为 true，表示未持久化默认对象 */
  isDefault: z.boolean().optional(),
})

export const updateCarePlanSchema = z.object({
  enabled: z.boolean().optional(),
  frequency: careFrequencySchema.optional(),
  preferredTime: z.string().max(32).nullable().optional(),
  scenes: z.array(careSceneSchema).min(1).optional(),
  tone: careToneSchema.optional(),
  customPrompt: z.string().max(1000).nullable().optional(),
})

export const generateCareEventSchema = z.object({
  scene: careSceneSchema.optional(),
  tone: careToneSchema.optional(),
  customPrompt: z.string().max(1000).optional(),
})

export const careEventSchema = z.object({
  id: z.string(),
  companionId: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  scene: careSceneSchema,
  status: z.enum(['pending', 'sent', 'read', 'failed']),
  message: z.string(),
  generatedAtMs: z.number().int(),
})

/** Companion SSE 事件名（服务端权威；Transport 映射依据） */
export const companionSseEventTypeSchema = z.enum([
  'token',
  'done',
  'error',
  'summary',
  'memories',
  'heartbeat',
])
