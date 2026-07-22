import type {
  DashboardSummary,
  HubHealth,
  Kpi,
  ObservabilityDetail,
  ObservabilitySection,
  ObservabilitySlowTurnItem,
  ObservabilityWindow,
} from '@goferbot/data'
import { Injectable, Logger, Optional } from '@nestjs/common'
import { PrismaService } from '../../../processors/database/prisma.service.js'
import { KnowledgeAiClient } from '../../../processors/knowledge-ai/knowledge-ai.client.js'
import { COMPANION_OBS_SAFETY_HARD_STOP } from '../../companion/repositories/companion-obs-event.repository.js'
import { HealthService } from '../../health/health.service.js'
import type { ObservabilityTurnRow } from '../../observability/observability-turn.repository.js'
import { ObservabilityTurnService } from '../../observability/observability-turn.service.js'
import {
  buildCountKpi,
  buildP95Kpi,
  buildRateKpi,
  DEFAULT_METADATA_SCAN_LIMIT,
  hasQualitySnapshot,
  isTruthyFlag,
  parseJsonObject,
  qualityIsFail,
  readNumberField,
  windowStart,
} from './dashboard-observability.utils.js'

const SCAN_TIMEOUT_MS = 8_000

type CompanionMetaAgg = {
  latencies: number[]
  latencyInstrumented: boolean
  qualityFailCount: number
  qualitySampleCount: number
  partial: boolean
  /** primaryEmotion → count（同次扫描附带，避免详页二次全表扫） */
  emotionCounts: Record<string, number>
  emotionSampleCount: number
}

@Injectable()
export class DashboardObservabilityService {
  private readonly logger = new Logger(DashboardObservabilityService.name)
  private readonly scanLimit =
    Number(process.env.DASHBOARD_METADATA_SCAN_LIMIT) || DEFAULT_METADATA_SCAN_LIMIT

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthService: HealthService,
    private readonly knowledgeAi: KnowledgeAiClient,
    @Optional() private readonly obsTurn?: ObservabilityTurnService,
  ) {}

  async getSummary(window: ObservabilityWindow = '24h'): Promise<DashboardSummary> {
    const since = windowStart(window)
    const [health, inventory, rag, companion] = await Promise.all([
      this.buildHealth(),
      this.buildInventory(),
      this.buildHubRag(since),
      this.buildHubCompanion(since),
    ])

    return {
      window,
      generatedAt: new Date().toISOString(),
      health,
      rag,
      companion,
      inventory,
    }
  }

  async getRagDetail(window: ObservabilityWindow = '24h'): Promise<ObservabilityDetail> {
    const since = windowStart(window)
    const [rag, health, slowItems] = await Promise.all([
      this.buildHubRag(since),
      this.buildHealth(),
      this.obsTurn?.listSlowItems('chat', since) ?? Promise.resolve([]),
    ])
    const kpis: Kpi[] = [
      { key: 'emptyRate', label: '检索空结果率', ...rag.emptyRate },
      { key: 'degradedRate', label: '降级率', ...rag.degradedRate },
      { key: 'indexFailureCount', label: '索引失败数', ...rag.indexFailureCount },
    ]
    if (rag.p95LatencyMs) {
      kpis.push({ key: 'p95LatencyMs', label: '端到端 P95（非准确率）', ...rag.p95LatencyMs })
    }
    if (rag.contractSuccessRate) {
      kpis.push({
        key: 'contractSuccessRate',
        label: '契约成功率',
        ...rag.contractSuccessRate,
        note: '非准确率：完成且非空结果等契约条件',
      })
    }
    if (rag.explicitNegativeRate) {
      kpis.push({
        key: 'explicitNegativeRate',
        label: '显式负反馈率',
        ...rag.explicitNegativeRate,
      })
    }
    if (rag.avgTokens) {
      kpis.push({ key: 'avgTokens', label: '平均 Token', ...rag.avgTokens })
    }

    const emptyKpi = rag.emptyRate as Kpi
    const degradedKpi = rag.degradedRate as Kpi
    const retrievePartial = Boolean(emptyKpi.partial || degradedKpi.partial)
    const retrieveReady =
      emptyKpi.status === 'ready' ||
      degradedKpi.status === 'ready' ||
      emptyKpi.status === 'insufficient_samples' ||
      degradedKpi.status === 'insufficient_samples'

    const p95Lat = rag.p95LatencyMs as Kpi | undefined
    const p95Ka = rag.p95KnowledgeAiMs as Kpi | undefined
    const latencyMetrics = [
      {
        key: 'p95_e2e_ms',
        status: p95Lat?.status ?? ('pending_instrumentation' as const),
        value: p95Lat?.value,
        unit: 'ms',
        note: 'W2 latencyMs，排除 cancelled',
      },
      {
        key: 'p95_knowledge_ai_ms',
        status: p95Ka?.status ?? ('pending_instrumentation' as const),
        value: p95Ka?.value,
        unit: 'ms',
      },
    ]

    const sections: Record<string, ObservabilitySection> = {
      index: {
        status: rag.indexFailureCount.status === 'ready' ? 'ready' : 'pending_instrumentation',
        metrics: [
          {
            key: 'index_failure_count',
            status: rag.indexFailureCount.status,
            value: rag.indexFailureCount.value,
            unit: 'count',
          },
        ],
        note: '口径：Document.status=failed 且 updatedAt 落在时间窗内',
      },
      retrieve: {
        status: retrieveReady ? (retrievePartial ? 'partial' : 'ready') : 'pending_instrumentation',
        metrics: [
          {
            key: 'empty_rate',
            label: '空结果率',
            status: emptyKpi.status,
            value: emptyKpi.value,
            unit: 'ratio',
            note: emptyKpi.note,
          },
          {
            key: 'degraded_rate',
            label: '降级率',
            status: degradedKpi.status,
            value: degradedKpi.value,
            unit: 'ratio',
            note: degradedKpi.note,
          },
        ],
      },
      latency: {
        status: this.kpiToSectionStatus(
          (rag.p95LatencyMs as Kpi | undefined) ?? { status: 'pending_instrumentation' },
        ),
        metrics: latencyMetrics.map((m) => ({
          ...m,
          label:
            m.key === 'p95_e2e_ms'
              ? '端到端 P95'
              : m.key === 'p95_knowledge_ai_ms'
                ? 'Knowledge AI P95'
                : m.key,
        })),
        note: '在线时延 KPI 不得称为「准确率」',
      },
      slow_turns: this.composeSlowTurnsSection(slowItems, 'chat'),
      quality_deps: {
        // ok → ready；degraded/down → partial（不造数，只暴露组件健康）
        status: health.status === 'ok' ? 'ready' : 'partial',
        metrics: health.components.map((c) => ({
          key: c.name,
          label: c.name,
          status: c.status === 'ok' ? ('ready' as const) : ('partial' as const),
          value: c.latencyMs,
          unit: 'ms',
          note: c.status,
        })),
        note: '不伪造检索瀑布；依赖健康见组件状态',
      },
    }

    return {
      window,
      generatedAt: new Date().toISOString(),
      kpis,
      sections,
    }
  }

  async getCompanionDetail(window: ObservabilityWindow = '24h'): Promise<ObservabilityDetail> {
    const since = windowStart(window)
    // 单次 metadata 扫描同时服务 KPI + emotion，避免详页二次全量扫
    const [metaAgg, feedback, hardStop, userMsgCount, w2Rows, slowItems] = await Promise.all([
      this.scanCompanionAssistantMetadata(since),
      this.aggregateFeedback(since),
      this.aggregateHardStops(since),
      this.prisma.companionMessage.count({
        where: { role: 'user', createdAt: { gte: since } },
      }),
      this.obsTurn?.listByRouteSince('companion', since) ?? Promise.resolve([]),
      this.obsTurn?.listSlowItems('companion', since) ?? Promise.resolve([]),
    ])
    const companion = this.composeHubCompanion(metaAgg, feedback, hardStop, userMsgCount, w2Rows)

    const kpis: Kpi[] = [
      { key: 'p95LatencyMs', label: '端到端 P95（履约过程，非准确率）', ...companion.p95LatencyMs },
      {
        key: 'qualityFailRate',
        label: 'Quality fail 率（观测型）',
        ...companion.qualityFailRate,
        note: companion.qualityFailRate.note ?? '观测型：不表示主回复被丢弃',
      },
      { key: 'safetyHardStopRate', label: '安全硬中断率', ...companion.safetyHardStopRate },
      { key: 'negativeFeedbackRate', label: '负反馈率', ...companion.negativeFeedbackRate },
    ]
    if (companion.p95GenerateMs) {
      kpis.push({ key: 'p95GenerateMs', label: 'generate 节点 P95', ...companion.p95GenerateMs })
    }
    if (companion.avgMemoryLoaded) {
      kpis.push({ key: 'avgMemoryLoaded', label: '平均注入记忆条数', ...companion.avgMemoryLoaded })
    }
    if (companion.avgTokens) {
      kpis.push({ key: 'avgTokens', label: '平均 Token', ...companion.avgTokens })
    }

    const nodeP95Metrics = this.buildCompanionNodeP95Metrics(w2Rows)

    const sections: Record<string, ObservabilitySection> = {
      latency: {
        status: this.kpiToSectionStatus(companion.p95LatencyMs),
        metrics: [
          {
            key: 'p95_latency_ms',
            status: companion.p95LatencyMs.status,
            value: companion.p95LatencyMs.value,
            unit: 'ms',
            note: 'W2 优先；排除 cancelled',
          },
          {
            key: 'p95_generate_ms',
            status: companion.p95GenerateMs?.status ?? 'pending_instrumentation',
            value: companion.p95GenerateMs?.value,
            unit: 'ms',
          },
        ],
      },
      nodes: {
        status: nodeP95Metrics.length > 0 ? 'ready' : 'pending_instrumentation',
        metrics: nodeP95Metrics,
        note: '有实现的图节点 span；无空壳子 span',
      },
      retrieval: {
        status: 'pending_instrumentation',
        metrics: [],
        note: 'Companion 主路径未接知识检索，不伪造检索质量',
      },
      emotion: this.composeEmotionSection(metaAgg),
      slow_turns: this.composeSlowTurnsSection(slowItems, 'companion'),
      cost_safety: {
        status: this.composeCostSafetySectionStatus(companion),
        metrics: [
          {
            key: 'token_cost',
            status: (companion.avgTokens as Kpi | undefined)?.status ?? 'pending_instrumentation',
            value: (companion.avgTokens as Kpi | undefined)?.value,
            unit: (companion.avgTokens as Kpi | undefined)?.unit,
            note: (companion.avgTokens as Kpi | undefined)?.note ?? '有 token 数据时展示',
          },
          {
            key: 'quality_fail_rate',
            status: companion.qualityFailRate.status,
            value: companion.qualityFailRate.value,
            unit: 'ratio',
            note: '观测型',
          },
          {
            key: 'safety_hard_stop_rate',
            status: companion.safetyHardStopRate.status,
            value: companion.safetyHardStopRate.value,
            unit: 'ratio',
            note: '硬中断不出现在聊天记录，来自侧信道事件',
          },
          {
            key: 'negative_feedback_rate',
            status: companion.negativeFeedbackRate.status,
            value: companion.negativeFeedbackRate.value,
            unit: 'ratio',
            note: 'negative / feedbackCount',
          },
        ],
      },
    }

    return {
      window,
      generatedAt: new Date().toISOString(),
      kpis,
      sections,
    }
  }

  private buildCompanionNodeP95Metrics(
    rows: ObservabilityTurnRow[],
  ): Array<{ key: string; label: string; status: 'ready'; value: number; unit: string }> {
    const byNode: Record<string, number[]> = {}
    for (const r of rows) {
      if (r.status === 'cancelled') continue
      const span = parseJsonObject(r.spanMs)
      if (!span) continue
      for (const [k, v] of Object.entries(span)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (!byNode[k]) byNode[k] = []
          byNode[k].push(v)
        }
      }
    }
    return Object.entries(byNode)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, vals]) => {
        const sorted = vals.slice().sort((a, b) => a - b)
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1))
        const value = sorted[idx] ?? 0
        return {
          key: `node_${key}_p95`,
          label: key,
          status: 'ready' as const,
          value,
          unit: 'ms',
        }
      })
  }

  // ── health ──────────────────────────────────────────────

  private async buildHealth(): Promise<HubHealth> {
    const core = await this.healthService.check()
    const ka = await this.probeKnowledgeAi()
    const components = [
      ...core.components.map((c) => ({
        name: c.name,
        status: c.status,
        latencyMs: c.latencyMs,
      })),
      ka,
    ]

    const hasDown = components.some((c) => c.status === 'down' && c.name !== 'knowledge-ai')
    const kaDown = ka.status === 'down' || ka.status === 'degraded'
    // 关键依赖 down → down；仅 KA 不可达/降级 → degraded
    let status: HubHealth['status'] = 'ok'
    if (hasDown || core.status === 'down') {
      status = 'down'
    } else if (core.status === 'degraded' || kaDown) {
      status = 'degraded'
    }

    const withLatency = components.filter(
      (c): c is { name: string; status: HubHealth['status']; latencyMs: number } =>
        typeof c.latencyMs === 'number',
    )
    const slowest =
      withLatency.length > 0
        ? withLatency.reduce((a, b) => (a.latencyMs >= b.latencyMs ? a : b))
        : undefined

    return {
      status,
      components,
      slowest: slowest ? { name: slowest.name, latencyMs: slowest.latencyMs } : undefined,
    }
  }

  private async probeKnowledgeAi(): Promise<{
    name: string
    status: 'ok' | 'degraded' | 'down'
    latencyMs: number
  }> {
    const start = Date.now()
    try {
      const raw = (await this.knowledgeAi.health()) as { status?: string }
      const latencyMs = Date.now() - start
      const st = raw?.status
      if (st === 'ok') return { name: 'knowledge-ai', status: 'ok', latencyMs }
      if (st === 'degraded') return { name: 'knowledge-ai', status: 'degraded', latencyMs }
      // unavailable or unknown
      return { name: 'knowledge-ai', status: 'degraded', latencyMs }
    } catch (err) {
      this.logger.warn(
        `Knowledge AI health probe failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { name: 'knowledge-ai', status: 'down', latencyMs: Date.now() - start }
    }
  }

  // ── inventory ───────────────────────────────────────────

  private async buildInventory() {
    const [userCount, knowledgeBaseCount, documentCount, companionCount] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.knowledgeBase.count(),
      this.prisma.document.count(),
      this.prisma.companion.count(),
    ])
    return { userCount, knowledgeBaseCount, documentCount, companionCount }
  }

  // ── RAG hub ─────────────────────────────────────────────

  private async buildHubRag(since: Date) {
    const indexFailureCount = await this.prisma.document.count({
      where: {
        status: 'failed',
        updatedAt: { gte: since },
      },
    })

    // 优先 W2；无样本时 empty/degraded 不混扫消息表冒充 turn 指标（索引失败仍读 Document）
    const w2Rows = this.obsTurn ? await this.obsTurn.listByRouteSince('chat', since) : []
    if (w2Rows.length > 0) {
      return this.composeHubRagFromW2(w2Rows, indexFailureCount)
    }

    // 无 W2：empty/degraded 标 pending_instrumentation（不混扫）；索引仍可用
    return {
      emptyRate: {
        status: 'pending_instrumentation' as const,
        note: '等待 W2 ObservabilityTurn 样本（不混扫消息 metadata 冒充）',
      },
      degradedRate: {
        status: 'pending_instrumentation' as const,
        note: '等待 W2 ObservabilityTurn 样本',
      },
      indexFailureCount: buildCountKpi(indexFailureCount),
      p95LatencyMs: { status: 'pending_instrumentation' as const },
      p95KnowledgeAiMs: { status: 'pending_instrumentation' as const },
      contractSuccessRate: { status: 'pending_instrumentation' as const },
      explicitNegativeRate: { status: 'pending_instrumentation' as const },
      avgTokens: { status: 'pending_instrumentation' as const },
    }
  }

  private composeHubRagFromW2(rows: ObservabilityTurnRow[], indexFailureCount: number) {
    const nonCancelled = rows.filter((r) => r.status !== 'cancelled')
    const latencies = nonCancelled.map((r) => r.latencyMs)
    const kaMs: number[] = []
    let emptyCount = 0
    let degradedCount = 0
    let contractOk = 0
    let contractDenom = 0
    let explicitNeg = 0
    let explicitTotal = 0
    let tokenSum = 0
    let tokenSamples = 0

    for (const r of nonCancelled) {
      const flags = parseJsonObject(r.flags) ?? {}
      if (isTruthyFlag(flags, 'retrievalEmpty') || flags.retrievalEmpty === true) emptyCount += 1
      if (isTruthyFlag(flags, 'degraded') || flags.degraded === true) degradedCount += 1
      if (r.status === 'ok') {
        contractDenom += 1
        if (flags.contractSuccess === true) contractOk += 1
      }
      if (flags.explicitFeedback === 'helpful' || flags.explicitFeedback === 'not_helpful') {
        explicitTotal += 1
        if (flags.explicitFeedback === 'not_helpful') explicitNeg += 1
      }
      const span = parseJsonObject(r.spanMs)
      const ka = span ? readNumberField(span, 'knowledge.ai') : null
      if (ka != null) kaMs.push(ka)
      const it = r.inputTokens ?? 0
      const ot = r.outputTokens ?? 0
      if (r.inputTokens != null || r.outputTokens != null) {
        tokenSum += it + ot
        tokenSamples += 1
      }
    }

    return {
      emptyRate: buildRateKpi({
        numerator: emptyCount,
        denominator: nonCancelled.length,
        instrumented: true,
        note: 'W2 flags.retrievalEmpty',
      }),
      degradedRate: buildRateKpi({
        numerator: degradedCount,
        denominator: nonCancelled.length,
        instrumented: true,
        note: 'W2 flags.degraded',
      }),
      indexFailureCount: buildCountKpi(indexFailureCount),
      p95LatencyMs: buildP95Kpi(latencies, true),
      p95KnowledgeAiMs: buildP95Kpi(kaMs, kaMs.length > 0 || nonCancelled.length > 0),
      contractSuccessRate: buildRateKpi({
        numerator: contractOk,
        denominator: contractDenom,
        instrumented: true,
        note: '契约成功，非准确率',
      }),
      explicitNegativeRate: buildRateKpi({
        numerator: explicitNeg,
        denominator: explicitTotal,
        instrumented: true,
        note: explicitTotal === 0 ? '尚无显式反馈样本' : 'not_helpful / 有反馈回合',
      }),
      avgTokens:
        tokenSamples > 0
          ? {
              status: 'ready' as const,
              value: tokenSum / tokenSamples,
              sampleSize: tokenSamples,
              unit: 'tokens',
            }
          : { status: 'pending_instrumentation' as const, note: '尚无 token 埋点' },
    }
  }

  // ── Companion hub ───────────────────────────────────────

  private async buildHubCompanion(since: Date) {
    const [metaAgg, feedback, hardStop, userMsgCount, w2Rows] = await Promise.all([
      this.scanCompanionAssistantMetadata(since),
      this.aggregateFeedback(since),
      this.aggregateHardStops(since),
      this.prisma.companionMessage.count({
        where: {
          role: 'user',
          createdAt: { gte: since },
        },
      }),
      this.obsTurn?.listByRouteSince('companion', since) ?? Promise.resolve([]),
    ])
    return this.composeHubCompanion(metaAgg, feedback, hardStop, userMsgCount, w2Rows)
  }

  private composeHubCompanion(
    metaAgg: CompanionMetaAgg,
    feedback: { negative: number; total: number },
    hardStop: { count: number; instrumented: boolean },
    userMsgCount: number,
    w2Rows: ObservabilityTurnRow[] = [],
  ) {
    const w2NonCancel = w2Rows.filter((r) => r.status !== 'cancelled')
    const w2Latencies = w2NonCancel.map((r) => r.latencyMs)
    const genMs: number[] = []
    let memSum = 0
    let memN = 0
    let tokenSum = 0
    let tokenN = 0
    for (const r of w2NonCancel) {
      const span = parseJsonObject(r.spanMs)
      const g = span ? readNumberField(span, 'generate') : null
      if (g != null) genMs.push(g)
      const attrs = parseJsonObject(r.spanAttrs)
      const ml = attrs ? readNumberField(attrs, 'memoryLoaded') : null
      if (ml != null) {
        memSum += ml
        memN += 1
      }
      if (r.inputTokens != null || r.outputTokens != null) {
        tokenSum += (r.inputTokens ?? 0) + (r.outputTokens ?? 0)
        tokenN += 1
      }
    }

    // e2e：W2 优先（真源）；否则 fallback 消息 metadata
    const p95LatencyMs =
      w2Latencies.length > 0
        ? buildP95Kpi(w2Latencies, true)
        : buildP95Kpi(metaAgg.latencies, metaAgg.latencyInstrumented, metaAgg.partial)

    return {
      p95LatencyMs,
      p95GenerateMs: buildP95Kpi(genMs, genMs.length > 0 || w2NonCancel.length > 0),
      avgMemoryLoaded:
        memN > 0
          ? {
              status: 'ready' as const,
              value: memSum / memN,
              sampleSize: memN,
              unit: 'count',
            }
          : { status: 'pending_instrumentation' as const },
      avgTokens:
        tokenN > 0
          ? {
              status: 'ready' as const,
              value: tokenSum / tokenN,
              sampleSize: tokenN,
              unit: 'tokens',
            }
          : { status: 'pending_instrumentation' as const },
      qualityFailRate: buildRateKpi({
        numerator: metaAgg.qualityFailCount,
        denominator: metaAgg.qualitySampleCount,
        instrumented: true,
        partial: metaAgg.partial,
        note: '观测型 quality.status=fail，不表示主回复被丢弃',
      }),
      safetyHardStopRate: buildRateKpi({
        numerator: hardStop.count,
        denominator: userMsgCount,
        instrumented: hardStop.instrumented,
        note: hardStop.instrumented
          ? 'hard_stop / companion_user_messages；硬中断不出现在聊天记录'
          : '侧信道 companion_obs_event 未就绪',
      }),
      negativeFeedbackRate: buildRateKpi({
        numerator: feedback.negative,
        denominator: feedback.total,
        instrumented: true,
        note: 'negative / feedbackCount',
      }),
    }
  }

  private composeEmotionSection(metaAgg: CompanionMetaAgg): ObservabilitySection {
    if (metaAgg.partial && metaAgg.emotionSampleCount === 0) {
      return {
        status: 'partial',
        metrics: [],
        note: '情绪聚合超时或扫描未完成',
      }
    }
    if (metaAgg.emotionSampleCount === 0) {
      return {
        status: 'pending_instrumentation',
        metrics: [],
        note: '尚无 emotion 元数据样本',
      }
    }

    const metrics = Object.entries(metaAgg.emotionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key, value]) => ({
        key,
        label: key,
        status: 'ready' as const,
        value,
        unit: 'count',
      }))

    return {
      status: metaAgg.partial ? 'partial' : 'ready',
      metrics,
      note: `基于 ${metaAgg.emotionSampleCount} 条含 emotion 的助手消息`,
    }
  }

  /**
   * 慢请求 Top N：metrics 每行一条回合，禁止把整表 JSON 塞进 note（前端会原样渲染）。
   */
  private composeSlowTurnsSection(
    slowItems: ObservabilitySlowTurnItem[],
    route: 'chat' | 'companion',
  ): ObservabilitySection {
    if (slowItems.length === 0) {
      return {
        status: 'pending_instrumentation',
        metrics: [],
        note:
          route === 'chat'
            ? '暂无 W2 慢样本（未埋点或窗内无数据）'
            : '暂无 W2 慢样本',
      }
    }

    const topN = Number(process.env.OBS_SLOW_TOP_N ?? '20')
    return {
      status: 'ready',
      metrics: slowItems.map((s, i) => {
        const linkId =
          route === 'chat' ? s.sessionId : s.conversationId
        const parts = [
          s.status,
          s.createdAt,
          linkId
            ? route === 'chat'
              ? `session=${linkId}`
              : `conversation=${linkId}`
            : null,
          s.messageId ? `message=${s.messageId}` : null,
        ].filter(Boolean)
        return {
          key: s.traceId,
          label: `#${i + 1}`,
          status: 'ready' as const,
          value: s.latencyMs,
          unit: 'ms',
          note: parts.join(' · '),
          href: s.langfuseUrl ?? null,
        }
      }),
      note: `窗口内最慢 ${slowItems.length} 条（Top ${topN}，排除 cancelled）。key 为 traceId；配置 LANGFUSE_HOST 时可用外链。`,
    }
  }

  private kpiToSectionStatus(kpi: Kpi): ObservabilitySection['status'] {
    if (kpi.status === 'pending_instrumentation') return 'pending_instrumentation'
    if (kpi.status === 'ready' && kpi.partial) return 'partial'
    return 'ready'
  }

  private composeCostSafetySectionStatus(companion: {
    safetyHardStopRate: Kpi
    qualityFailRate: Kpi
  }): ObservabilitySection['status'] {
    const bothPending =
      companion.safetyHardStopRate.status === 'pending_instrumentation' &&
      companion.qualityFailRate.status === 'pending_instrumentation'
    if (bothPending) return 'pending_instrumentation'
    const partial = companion.safetyHardStopRate.partial || companion.qualityFailRate.partial
    return partial ? 'partial' : 'ready'
  }

  private async scanCompanionAssistantMetadata(since: Date): Promise<CompanionMetaAgg> {
    const empty: CompanionMetaAgg = {
      latencies: [],
      latencyInstrumented: false,
      qualityFailCount: 0,
      qualitySampleCount: 0,
      partial: true,
      emotionCounts: {},
      emotionSampleCount: 0,
    }
    return this.withTimeout<CompanionMetaAgg>(async () => {
      const rows = await this.prisma.companionMessage.findMany({
        where: {
          role: 'assistant',
          createdAt: { gte: since },
        },
        select: { metadata: true },
        orderBy: { createdAt: 'desc' },
        take: this.scanLimit,
      })

      const totalInWindow = await this.prisma.companionMessage.count({
        where: {
          role: 'assistant',
          createdAt: { gte: since },
        },
      })

      const latencies: number[] = []
      let qualityFailCount = 0
      let qualitySampleCount = 0
      const emotionCounts: Record<string, number> = {}
      let emotionSampleCount = 0

      for (const row of rows) {
        const meta = parseJsonObject(row.metadata)
        const lat = readNumberField(meta, 'latencyMs')
        if (lat != null) {
          latencies.push(lat)
        }
        if (hasQualitySnapshot(meta)) {
          qualitySampleCount += 1
          if (qualityIsFail(meta)) qualityFailCount += 1
        }
        const emotion = meta?.emotion
        if (emotion && typeof emotion === 'object' && !Array.isArray(emotion)) {
          const primary = (emotion as { primaryEmotion?: string }).primaryEmotion
          if (primary) {
            emotionSampleCount += 1
            emotionCounts[primary] = (emotionCounts[primary] ?? 0) + 1
          }
        }
      }

      return {
        latencies,
        // 助手定稿路径已写入 latencyMs；历史无字段的样本不计入 latencies
        latencyInstrumented: true,
        qualityFailCount,
        qualitySampleCount,
        partial: totalInWindow > rows.length,
        emotionCounts,
        emotionSampleCount,
      }
    }, empty)
  }

  private async aggregateFeedback(since: Date): Promise<{ negative: number; total: number }> {
    const [total, negative] = await Promise.all([
      this.prisma.companionMessageFeedback.count({
        where: { createdAt: { gte: since } },
      }),
      this.prisma.companionMessageFeedback.count({
        where: { createdAt: { gte: since }, rating: 'negative' },
      }),
    ])
    return { negative, total }
  }

  private async aggregateHardStops(since: Date): Promise<{ count: number; instrumented: boolean }> {
    try {
      // 表存在即可 instrumented（即便 count=0）
      const count = await this.prisma.companionObsEvent.count({
        where: {
          type: COMPANION_OBS_SAFETY_HARD_STOP,
          createdAt: { gte: since },
        },
      })
      return { count, instrumented: true }
    } catch (err) {
      this.logger.warn(
        `companion_obs_event unavailable: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { count: 0, instrumented: false }
    }
  }

  private async withTimeout<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`metadata scan timed out after ${SCAN_TIMEOUT_MS}ms`)),
            SCAN_TIMEOUT_MS,
          )
        }),
      ])
      return result
    } catch (err) {
      this.logger.warn(
        `metadata aggregation degraded: ${err instanceof Error ? err.message : String(err)}`,
      )
      return fallback
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
