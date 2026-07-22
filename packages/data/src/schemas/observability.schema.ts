import { z } from 'zod'

/** W2 路由 */
export const observabilityRouteSchema = z.enum(['chat', 'companion'])

/** 回合状态（Z3） */
export const observabilityTurnStatusSchema = z.enum(['ok', 'error', 'cancelled'])

/** 显式反馈 */
export const chatExplicitFeedbackSchema = z.enum(['helpful', 'not_helpful'])

/** turn 级 flags（P1 元数据 only） */
export const observabilityTurnFlagsSchema = z
  .object({
    retrievalEmpty: z.boolean().optional(),
    degraded: z.boolean().optional(),
    contractSuccess: z.boolean().optional(),
    explicitFeedback: chatExplicitFeedbackSchema.optional(),
    explicitFeedbackReason: z.string().max(64).optional(),
    userRejected: z.boolean().optional(),
    qualityFail: z.boolean().optional(),
    safetyHardStop: z.boolean().optional(),
  })
  .passthrough()

/** 写入 W2 的回合摘要 */
export const observabilityTurnWriteSchema = z.object({
  traceId: z.string().min(1),
  route: observabilityRouteSchema,
  userId: z.string().optional().nullable(),
  sessionId: z.string().optional().nullable(),
  conversationId: z.string().optional().nullable(),
  messageId: z.string().optional().nullable(),
  status: observabilityTurnStatusSchema,
  latencyMs: z.number().int().nonnegative(),
  postProcessMs: z.number().int().nonnegative().optional().nullable(),
  flags: observabilityTurnFlagsSchema.optional().nullable(),
  spanMs: z.record(z.string(), z.number()).optional().nullable(),
  spanAttrs: z.record(z.string(), z.unknown()).optional().nullable(),
  inputTokens: z.number().int().nonnegative().optional().nullable(),
  outputTokens: z.number().int().nonnegative().optional().nullable(),
})

/** 最小行（error/超慢加固） */
export const observabilityTurnMinimalWriteSchema = z.object({
  traceId: z.string().min(1),
  route: observabilityRouteSchema,
  status: observabilityTurnStatusSchema,
  latencyMs: z.number().int().nonnegative(),
  userId: z.string().optional().nullable(),
  sessionId: z.string().optional().nullable(),
  conversationId: z.string().optional().nullable(),
  messageId: z.string().optional().nullable(),
})

/** Admin 慢列表项 */
export const observabilitySlowTurnItemSchema = z.object({
  traceId: z.string(),
  route: observabilityRouteSchema,
  status: observabilityTurnStatusSchema,
  latencyMs: z.number(),
  createdAt: z.string(),
  sessionId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  messageId: z.string().nullable().optional(),
  langfuseUrl: z.string().url().nullable().optional(),
  /** 有权限时前端可跳转会话/消息 */
  deepLink: z
    .object({
      kind: z.enum(['chat_session', 'companion_conversation']),
      id: z.string(),
      messageId: z.string().optional(),
    })
    .nullable()
    .optional(),
})

/** Chat 显式反馈请求 */
export const chatMessageFeedbackRequestSchema = z.object({
  messageId: z.string().min(1),
  sessionId: z.string().min(1),
  rating: chatExplicitFeedbackSchema,
  reason: z.string().max(64).optional(),
  traceId: z.string().optional(),
})

export const chatMessageFeedbackResponseSchema = z.object({
  ok: z.literal(true),
  messageId: z.string(),
  rating: chatExplicitFeedbackSchema,
})
