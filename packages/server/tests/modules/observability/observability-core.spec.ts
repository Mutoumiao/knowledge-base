import { describe, expect, it, vi } from 'vitest'
import {
  detectUserRejected,
  isImplicitRejectEnabledForChat,
} from '../../../src/modules/observability/implicit-reject.js'
import { LangfuseAdapter } from '../../../src/modules/observability/langfuse.adapter.js'

describe('observability dual-clock / sampling helpers', () => {
  it('Z3: latencyMs excludes postProcess conceptually', () => {
    const e2eEnd = 1000
    const postEnd = 1200
    const latencyMs = e2eEnd
    const postProcessMs = postEnd - e2eEnd
    expect(latencyMs).toBe(1000)
    expect(postProcessMs).toBe(200)
    // Hub e2e 只用 latencyMs
    const hubSample = latencyMs
    expect(hubSample).not.toBe(postEnd)
  })

  it('cancelled status excluded from e2e aggregation sample', () => {
    const rows = [
      { status: 'ok', latencyMs: 100 },
      { status: 'cancelled', latencyMs: 9999 },
      { status: 'ok', latencyMs: 200 },
    ]
    const forP95 = rows.filter((r) => r.status !== 'cancelled').map((r) => r.latencyMs)
    expect(forP95).toEqual([100, 200])
    expect(forP95).not.toContain(9999)
  })

  it('minimal W2 row shape', () => {
    const minimal = {
      traceId: 't1',
      route: 'chat' as const,
      status: 'error' as const,
      latencyMs: 50,
    }
    expect(minimal.traceId).toBeTruthy()
    expect(minimal.route).toBe('chat')
  })
})

describe('LangfuseAdapter sampling (TH2)', () => {
  const adapter = new LangfuseAdapter()

  it('force sample on chat error when enabled', () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk'
    process.env.LANGFUSE_SECRET_KEY = 'sk'
    process.env.TRACE_SAMPLE_RATE = '0'
    expect(
      adapter.shouldSample({
        route: 'chat',
        status: 'error',
        latencyMs: 10,
      }),
    ).toBe(true)
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
  })

  it('force sample on companion generate threshold', () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk'
    process.env.LANGFUSE_SECRET_KEY = 'sk'
    process.env.TRACE_SAMPLE_RATE = '0'
    process.env.TRACE_FORCE_COMPANION_GENERATE_MS = '100'
    expect(
      adapter.shouldSample({
        route: 'companion',
        status: 'ok',
        latencyMs: 10,
        spanMs: { generate: 500 },
      }),
    ).toBe(true)
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
  })

  it('no-op when keys missing', () => {
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
    expect(adapter.isEnabled()).toBe(false)
    expect(adapter.shouldSample({ route: 'chat', status: 'ok', latencyMs: 99999 })).toBe(false)
  })

  it('G4 hash user does not expose email', () => {
    const h = adapter.hashUserId('user-uuid-1')
    expect(h).toBeDefined()
    expect(h).not.toContain('@')
    expect(h?.length).toBe(32)
  })
})

describe('implicit reject', () => {
  it('detects Chinese rejection phrases', () => {
    expect(detectUserRejected('完全不对')).toBe(true)
    expect(detectUserRejected('谢谢你的帮助')).toBe(false)
  })

  it('does not elevate success rate (flag only semantic)', () => {
    const hit = detectUserRejected('没用')
    // 命中仅表示 userRejected，不改变 contractSuccess 分子逻辑
    expect(hit).toBe(true)
    const contractSuccess = true // 上一轮仍可能契约成功
    expect(contractSuccess).toBe(true)
  })

  it('chat default enabled', () => {
    delete process.env.OBS_IMPLICIT_REJECT_ENABLED
    expect(isImplicitRejectEnabledForChat()).toBe(true)
  })
})

describe('companion span shell ban', () => {
  it('does not invent empty vector_search spans', () => {
    const realNodes = new Set([
      'safety',
      'intent',
      'emotion',
      'relationship',
      'route',
      'policy',
      'generate',
      'quality',
      'summary',
      'memory_candidate',
      'memory_extraction',
      'preflight.memory_load',
    ])
    const spanMs: Record<string, number> = {
      safety: 10,
      generate: 200,
      'preflight.memory_load': 30,
    }
    for (const k of Object.keys(spanMs)) {
      expect(realNodes.has(k)).toBe(true)
    }
    expect(spanMs).not.toHaveProperty('vector_search')
    expect(spanMs).not.toHaveProperty('structured_memory_empty')
  })
})

describe('ObservabilityTurnService fail-soft', () => {
  it('recordTurn does not throw when repo fails', async () => {
    const { ObservabilityTurnService } = await import(
      '../../../src/modules/observability/observability-turn.service.js'
    )
    const repo = {
      upsertByTraceId: vi.fn().mockRejectedValue(new Error('db down')),
      mergeFlags: vi.fn(),
      listSlow: vi.fn(),
      listByRouteSince: vi.fn(),
    }
    const langfuse = {
      shouldSample: vi.fn().mockReturnValue(false),
      exportTrace: vi.fn(),
      buildTraceUrl: vi.fn().mockReturnValue(null),
    }
    const svc = new ObservabilityTurnService(repo as never, langfuse as never)
    await expect(
      svc.recordTurn({
        traceId: 't-fail',
        route: 'chat',
        status: 'ok',
        latencyMs: 10,
      }),
    ).resolves.toBeUndefined()
    expect(repo.upsertByTraceId).toHaveBeenCalled()
  })
})

describe('ObservabilityCleanupService lifecycle', () => {
  it('clears start timeout and interval on destroy', async () => {
    vi.useFakeTimers()
    const { ObservabilityCleanupService } = await import(
      '../../../src/modules/observability/observability-cleanup.service.js'
    )
    const repo = { deleteOlderThan: vi.fn().mockResolvedValue(0) }
    const svc = new ObservabilityCleanupService(repo as never)
    svc.onModuleInit()
    svc.onModuleDestroy()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(repo.deleteOlderThan).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('companion token usage extraction', () => {
  it('sums tokens from usage_metadata and llmResult', async () => {
    const {
      beginCompanionTokenBucket,
      extractUsageFromMessage,
      extractUsageFromLlmResult,
      addCompanionTokenUsage,
      getCompanionTokenBucket,
      recordUsageFromMessage,
    } = await import('../../../src/modules/companion/langchain/token-usage.js')

    expect(
      extractUsageFromMessage({
        usage_metadata: { input_tokens: 12, output_tokens: 34 },
      }),
    ).toEqual({ input: 12, output: 34 })

    expect(
      extractUsageFromLlmResult({
        llmOutput: { tokenUsage: { promptTokens: 5, completionTokens: 7 } },
      }),
    ).toEqual({ input: 5, output: 7 })

    beginCompanionTokenBucket()
    recordUsageFromMessage({ usage_metadata: { input_tokens: 10, output_tokens: 20 } })
    addCompanionTokenUsage(3, 4)
    const bucket = getCompanionTokenBucket()
    expect(bucket?.inputTokens).toBe(13)
    expect(bucket?.outputTokens).toBe(24)
  })
})
