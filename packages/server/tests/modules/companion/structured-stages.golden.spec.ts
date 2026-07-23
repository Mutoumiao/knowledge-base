/**
 * O11：SharedNodeFactory 三态打点 + writeCompanionObs → spanAttrs（mock，无 live LLM）
 */
import { conversationSafetySchema, fallbackSafety } from '@goferbot/data/schemas'
import { describe, expect, it, vi } from 'vitest'
import { CompanionChatStreamService } from '@/modules/companion/companion-chat-stream.service.js'
import { SharedNodeFactory } from '@/modules/companion/langgraph/nodes/_shared.js'
import type { NodeExecutionContext } from '@/modules/companion/langgraph/interfaces.js'

describe('structured stages (O11)', () => {
  const prompt = {
    invoke: vi.fn().mockResolvedValue('prompt text'),
  }

  const baseState = {
    userId: 'u',
    companionId: 'c',
    conversationId: 'cv',
    userMessage: 'hi',
  }

  function makeCtx(): NodeExecutionContext {
    return {
      userId: 'u',
      companionId: 'c',
      conversationId: 'cv',
      companionName: 'Bot',
      structuredRepairBudget: { used: 0, budget: 1 },
      structuredStages: {},
    } as NodeExecutionContext
  }

  it('records success outcome on structuredStages', async () => {
    const structuredOutputService = {
      invokeWithFallback: vi.fn().mockResolvedValue({
        data: { ...fallbackSafety, safetyLevel: 'safe', boundaryAction: 'continue' },
        outcome: 'success' as const,
      }),
    }
    const shared = new SharedNodeFactory(
      structuredOutputService as never,
      { invoke: vi.fn() } as never,
    )
    const ctx = makeCtx()
    const data = await shared.invokeStructured(
      conversationSafetySchema,
      {
        name: 'safetyNode',
        prompt: prompt as never,
        buildVariables: async () => ({}),
      },
      fallbackSafety,
      baseState as never,
      ctx,
    )
    expect(data.safetyLevel).toBe('safe')
    expect(ctx.structuredStages?.safetyNode).toEqual({ outcome: 'success' })
  })

  it('records coerced outcome with reason', async () => {
    const structuredOutputService = {
      invokeWithFallback: vi.fn().mockResolvedValue({
        data: { ...fallbackSafety, safetyLevel: 'safe' },
        outcome: 'coerced' as const,
        reason: 'invalid_enum:safetyLevel',
      }),
    }
    const shared = new SharedNodeFactory(
      structuredOutputService as never,
      { invoke: vi.fn() } as never,
    )
    const ctx = makeCtx()
    await shared.invokeStructured(
      conversationSafetySchema,
      {
        name: 'intentNode',
        prompt: prompt as never,
        buildVariables: async () => ({}),
      },
      fallbackSafety,
      baseState as never,
      ctx,
    )
    expect(ctx.structuredStages?.intentNode).toEqual({
      outcome: 'coerced',
      reason: 'invalid_enum:safetyLevel',
    })
  })

  it('records fallback with reason and returns independent clone', async () => {
    const structuredOutputService = {
      invokeWithFallback: vi.fn().mockRejectedValue(new Error('structured fail')),
    }
    const shared = new SharedNodeFactory(
      structuredOutputService as never,
      { invoke: vi.fn() } as never,
    )
    const ctx = makeCtx()
    const data = await shared.invokeStructured(
      conversationSafetySchema,
      {
        name: 'safetyNode',
        prompt: prompt as never,
        buildVariables: async () => ({}),
      },
      fallbackSafety,
      baseState as never,
      ctx,
    )
    expect(ctx.structuredStages?.safetyNode).toEqual({
      outcome: 'fallback',
      reason: 'structured fail',
    })
    expect(data).not.toBe(fallbackSafety)
    expect(data.safetyLevel).toBe(fallbackSafety.safetyLevel)
  })

  it('writeCompanionObs mounts structuredStages onto spanAttrs', () => {
    const recordTurn = vi.fn().mockResolvedValue(undefined)
    const stream = new CompanionChatStreamService(
      {} as never,
      { recordTurn } as never,
    )
    const structuredStages = {
      safetyNode: { outcome: 'success' },
      intentNode: { outcome: 'coerced', reason: 'invalid_enum:primary' },
      emotionNode: { outcome: 'fallback', reason: 'jsonMode parse failed' },
    }
    ;(
      stream as unknown as {
        writeCompanionObs: (input: Record<string, unknown>) => void
      }
    ).writeCompanionObs({
      traceId: 't1',
      userId: 'u1',
      conversationId: 'c1',
      status: 'error',
      latencyMs: 12,
      spanMs: {},
      fullState: {},
      timeout: true,
      structuredStages,
    })
    expect(recordTurn).toHaveBeenCalledTimes(1)
    const arg = recordTurn.mock.calls[0][0] as {
      spanAttrs: { structuredStages?: typeof structuredStages; timeout?: boolean }
    }
    expect(arg.spanAttrs.structuredStages).toEqual(structuredStages)
    expect(arg.spanAttrs.timeout).toBe(true)
  })

  it('writeCompanionObs omits empty structuredStages', () => {
    const recordTurn = vi.fn().mockResolvedValue(undefined)
    const stream = new CompanionChatStreamService(
      {} as never,
      { recordTurn } as never,
    )
    ;(
      stream as unknown as {
        writeCompanionObs: (input: Record<string, unknown>) => void
      }
    ).writeCompanionObs({
      traceId: 't2',
      userId: 'u1',
      status: 'error',
      latencyMs: 1,
      spanMs: {},
      fullState: {},
      structuredStages: {},
    })
    const arg = recordTurn.mock.calls[0][0] as {
      spanAttrs: { structuredStages?: unknown }
    }
    expect(arg.spanAttrs.structuredStages).toBeUndefined()
  })
})
