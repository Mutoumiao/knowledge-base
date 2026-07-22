import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardObservabilityService } from '@/modules/admin/services/dashboard-observability.service.js'

function createMocks() {
  const prisma = {
    user: { count: vi.fn().mockResolvedValue(3) },
    knowledgeBase: { count: vi.fn().mockResolvedValue(2) },
    document: {
      count: vi.fn().mockImplementation((args?: { where?: { status?: string } }) => {
        if (args?.where?.status === 'failed') return Promise.resolve(5)
        return Promise.resolve(20)
      }),
    },
    companion: { count: vi.fn().mockResolvedValue(4) },
    message: {
      findMany: vi.fn().mockResolvedValue([
        { metadata: { retrieval_empty: true, degraded: false } },
        { metadata: { retrieval_empty: false, degraded: true } },
        { metadata: { retrieval_empty: false } },
      ]),
      count: vi.fn().mockResolvedValue(3),
    },
    companionMessage: {
      findMany: vi.fn().mockResolvedValue([
        {
          metadata: JSON.stringify({
            quality: { status: 'fail' },
            latencyMs: 1200,
            emotion: { primaryEmotion: 'calm' },
          }),
        },
        {
          metadata: JSON.stringify({
            quality: { status: 'pass' },
            latencyMs: 800,
            emotion: { primaryEmotion: 'happy' },
          }),
        },
      ]),
      count: vi.fn().mockResolvedValue(2),
    },
    companionMessageFeedback: {
      count: vi.fn().mockImplementation((args?: { where?: { rating?: string } }) => {
        if (args?.where?.rating === 'negative') return Promise.resolve(1)
        return Promise.resolve(4)
      }),
    },
    companionObsEvent: {
      count: vi.fn().mockResolvedValue(1),
    },
  }

  const healthService = {
    check: vi.fn().mockResolvedValue({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      components: [
        { name: 'postgres', status: 'ok', latencyMs: 2 },
        { name: 'redis', status: 'ok', latencyMs: 1 },
        { name: 'minio', status: 'ok', latencyMs: 3 },
      ],
    }),
  }

  const knowledgeAi = {
    health: vi.fn().mockResolvedValue({ status: 'ok' }),
  }

  return { prisma, healthService, knowledgeAi }
}

describe('DashboardObservabilityService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getSummary returns hub shape with ready KPIs', async () => {
    const { prisma, healthService, knowledgeAi } = createMocks()
    const svc = new DashboardObservabilityService(
      prisma as never,
      healthService as never,
      knowledgeAi as never,
    )

    const summary = await svc.getSummary('24h')
    expect(summary.window).toBe('24h')
    expect(summary.generatedAt).toBeTruthy()
    expect(summary.health.status).toBe('ok')
    expect(summary.health.components.map((c) => c.name)).toContain('knowledge-ai')
    expect(summary.inventory).toEqual({
      userCount: 3,
      knowledgeBaseCount: 2,
      documentCount: 20,
      companionCount: 4,
    })
    expect(summary.rag.indexFailureCount).toMatchObject({ status: 'ready', value: 5 })
    // 无 W2 时 empty/degraded 不混扫消息 metadata
    expect(summary.rag.emptyRate.status).toBe('pending_instrumentation')
    expect(summary.rag.p95LatencyMs?.status).toBe('pending_instrumentation')
    expect(summary.companion.negativeFeedbackRate).toMatchObject({
      status: 'ready',
      value: 0.25,
    })
    expect(summary.companion.safetyHardStopRate.status).toBe('ready')
    // Companion e2e 仍可从消息 metadata latencyMs fallback
    expect(summary.companion.p95LatencyMs.status).toBe('ready')
  })

  it('reads chat emptyRate from W2 when samples exist', async () => {
    const { prisma, healthService, knowledgeAi } = createMocks()
    const obsTurn = {
      listByRouteSince: vi.fn().mockImplementation((route: string) => {
        if (route === 'chat') {
          return Promise.resolve([
            {
              status: 'ok',
              latencyMs: 100,
              flags: { retrievalEmpty: true, contractSuccess: false },
              spanMs: { 'knowledge.ai': 80 },
              spanAttrs: null,
              inputTokens: 10,
              outputTokens: 20,
            },
            {
              status: 'ok',
              latencyMs: 200,
              flags: { retrievalEmpty: false, contractSuccess: true },
              spanMs: { 'knowledge.ai': 120 },
              spanAttrs: null,
              inputTokens: null,
              outputTokens: null,
            },
            {
              status: 'cancelled',
              latencyMs: 9999,
              flags: {},
              spanMs: null,
              spanAttrs: null,
              inputTokens: null,
              outputTokens: null,
            },
          ])
        }
        return Promise.resolve([])
      }),
      listSlowItems: vi.fn().mockResolvedValue([]),
    }
    const svc = new DashboardObservabilityService(
      prisma as never,
      healthService as never,
      knowledgeAi as never,
      obsTurn as never,
    )
    const summary = await svc.getSummary('24h')
    expect(summary.rag.emptyRate.status).toBe('ready')
    expect(summary.rag.emptyRate.value).toBe(0.5)
    expect(summary.rag.p95LatencyMs?.status).toBe('ready')
    // cancelled 不进 e2e
    expect(summary.rag.p95LatencyMs?.sampleSize).toBe(2)
  })

  it('synthesizes degraded when Knowledge AI is down but core is ok', async () => {
    const { prisma, healthService, knowledgeAi } = createMocks()
    knowledgeAi.health.mockRejectedValue(new Error('connection refused'))
    const svc = new DashboardObservabilityService(
      prisma as never,
      healthService as never,
      knowledgeAi as never,
    )

    const summary = await svc.getSummary()
    expect(summary.health.status).toBe('degraded')
    expect(summary.health.components.find((c) => c.name === 'knowledge-ai')?.status).toBe('down')
  })

  it('getRagDetail exposes index/retrieve/latency/slow_turns/quality_deps sections', async () => {
    const { prisma, healthService, knowledgeAi } = createMocks()
    const svc = new DashboardObservabilityService(
      prisma as never,
      healthService as never,
      knowledgeAi as never,
    )
    const detail = await svc.getRagDetail('1h')
    expect(detail.window).toBe('1h')
    expect(detail.sections.index).toBeDefined()
    expect(detail.sections.retrieve).toBeDefined()
    expect(detail.sections.latency).toBeDefined()
    expect(detail.sections.slow_turns).toBeDefined()
    expect(detail.sections.quality_deps).toBeDefined()
    expect(detail.kpis.length).toBeGreaterThanOrEqual(3)
  })

  it('getCompanionDetail keeps retrieval pending and reuses single metadata scan', async () => {
    const { prisma, healthService, knowledgeAi } = createMocks()
    const svc = new DashboardObservabilityService(
      prisma as never,
      healthService as never,
      knowledgeAi as never,
    )
    const detail = await svc.getCompanionDetail()
    expect(detail.sections.retrieval?.status).toBe('pending_instrumentation')
    expect(detail.sections.latency).toBeDefined()
    expect(detail.sections.emotion?.status).toBe('ready')
    expect(detail.sections.emotion?.metrics.some((m) => m.key === 'calm')).toBe(true)
    expect(detail.sections.cost_safety).toBeDefined()
    // 详页只应扫描 companion 助手 metadata 一次（emotion 复用同次结果）
    expect(prisma.companionMessage.findMany).toHaveBeenCalledTimes(1)
  })

  it('marks safetyHardStopRate pending when obs event table is unavailable', async () => {
    const { prisma, healthService, knowledgeAi } = createMocks()
    prisma.companionObsEvent.count.mockRejectedValue(new Error('relation does not exist'))
    const svc = new DashboardObservabilityService(
      prisma as never,
      healthService as never,
      knowledgeAi as never,
    )
    const summary = await svc.getSummary()
    expect(summary.companion.safetyHardStopRate.status).toBe('pending_instrumentation')
    expect(summary.companion.safetyHardStopRate.value).toBeUndefined()
  })

  it('does not mix-scan message metadata for empty/degraded when W2 empty', async () => {
    const { prisma, healthService, knowledgeAi } = createMocks()
    const svc = new DashboardObservabilityService(
      prisma as never,
      healthService as never,
      knowledgeAi as never,
    )
    const summary = await svc.getSummary()
    // 无 W2 时不混扫 message.metadata 冒充 turn 级 empty/degraded
    expect(summary.rag.emptyRate.status).toBe('pending_instrumentation')
    expect(summary.rag.degradedRate.status).toBe('pending_instrumentation')
    expect(prisma.message.findMany).not.toHaveBeenCalled()
  })

  it('marks quality_deps partial when health is degraded', async () => {
    const { prisma, healthService, knowledgeAi } = createMocks()
    knowledgeAi.health.mockRejectedValue(new Error('ka down'))
    const svc = new DashboardObservabilityService(
      prisma as never,
      healthService as never,
      knowledgeAi as never,
    )
    const detail = await svc.getRagDetail()
    expect(detail.sections.quality_deps?.status).toBe('partial')
  })
})
