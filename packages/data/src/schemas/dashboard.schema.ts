import { z } from 'zod'

/** 观测时间窗 */
export const observabilityWindowSchema = z.enum(['1h', '24h', '7d'])

/** KPI 就绪三态（Hub / 详页顶栏） */
export const kpiStatusSchema = z.enum([
  'ready',
  'pending_instrumentation',
  'insufficient_samples',
])

/** 详页 section 状态（可含 partial） */
export const sectionStatusSchema = z.enum([
  'ready',
  'pending_instrumentation',
  'partial',
])

export const kpiSchema = z.object({
  key: z.string().optional(),
  label: z.string().optional(),
  status: kpiStatusSchema,
  value: z.number().optional(),
  unit: z.string().optional(),
  note: z.string().optional(),
  sampleSize: z.number().int().nonnegative().optional(),
  partial: z.boolean().optional(),
})

export const healthComponentSchema = z.object({
  name: z.string(),
  status: z.enum(['ok', 'degraded', 'down']),
  latencyMs: z.number().optional(),
})

export const hubHealthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  components: z.array(healthComponentSchema),
  slowest: z
    .object({
      name: z.string(),
      latencyMs: z.number(),
    })
    .optional(),
})

export const hubRagSchema = z.object({
  emptyRate: kpiSchema,
  degradedRate: kpiSchema,
  indexFailureCount: kpiSchema,
  /** W2：Chat e2e P95（排除 cancelled） */
  p95LatencyMs: kpiSchema.optional(),
  /** W2：knowledge.ai 阶段 P95 */
  p95KnowledgeAiMs: kpiSchema.optional(),
  /** 契约成功率（completed 且非 empty 失败等） */
  contractSuccessRate: kpiSchema.optional(),
  /** 显式负反馈率（有反馈样本时） */
  explicitNegativeRate: kpiSchema.optional(),
  /** 平均 token（有数据时） */
  avgTokens: kpiSchema.optional(),
})

export const hubCompanionSchema = z.object({
  p95LatencyMs: kpiSchema,
  qualityFailRate: kpiSchema,
  safetyHardStopRate: kpiSchema,
  negativeFeedbackRate: kpiSchema,
  /** W2：generate 节点 P95 */
  p95GenerateMs: kpiSchema.optional(),
  /** 平均注入记忆条数 */
  avgMemoryLoaded: kpiSchema.optional(),
  /** 平均 token（有数据时） */
  avgTokens: kpiSchema.optional(),
})

export const hubInventorySchema = z.object({
  userCount: z.number().int().nonnegative(),
  knowledgeBaseCount: z.number().int().nonnegative(),
  documentCount: z.number().int().nonnegative(),
  companionCount: z.number().int().nonnegative(),
})

/** GET /admin/dashboard/summary */
export const dashboardSummarySchema = z.object({
  window: observabilityWindowSchema,
  generatedAt: z.string(),
  health: hubHealthSchema,
  rag: hubRagSchema,
  companion: hubCompanionSchema,
  inventory: hubInventorySchema,
})

export const dashboardSummaryQuerySchema = z.object({
  window: observabilityWindowSchema.optional().default('24h'),
})

export const observabilityMetricSchema = z.object({
  key: z.string(),
  /** 展示名（如 rank / 节点名）；缺省时用 key */
  label: z.string().optional(),
  status: z.enum([
    'ready',
    'pending_instrumentation',
    'insufficient_samples',
    'partial',
  ]),
  value: z.number().optional(),
  unit: z.string().optional(),
  note: z.string().optional(),
  /** 外链（如 Langfuse trace） */
  href: z.string().optional().nullable(),
})

export const observabilitySectionSchema = z.object({
  status: sectionStatusSchema,
  metrics: z.array(observabilityMetricSchema),
  note: z.string().optional(),
})

/** 详页外壳：window + generatedAt + kpis + sections */
export const observabilityDetailSchema = z.object({
  window: observabilityWindowSchema,
  generatedAt: z.string(),
  kpis: z.array(kpiSchema),
  sections: z.record(z.string(), observabilitySectionSchema),
})

export const observabilityDetailQuerySchema = z.object({
  window: observabilityWindowSchema.optional().default('24h'),
})

// ── 聚合口径常量（前后端与文档共用） ──────────────────────────

/** 负反馈率 = negative / feedbackCount */
export const FEEDBACK_RATE_DENOMINATOR = 'feedbackCount' as const

/** 硬中断率 = hard_stop_count / companion user messages in window */
export const HARD_STOP_RATE_DENOMINATOR = 'companion_user_messages' as const

/** 索引失败：status=failed 且 updatedAt ∈ window */
export const INDEX_FAILURE_FILTER = 'status=failed && updatedAt∈window' as const
