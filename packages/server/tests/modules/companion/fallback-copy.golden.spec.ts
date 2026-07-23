import { fallbackSafety, fallbackIntent, fallbackEmotion } from '@goferbot/data/schemas'
import { describe, expect, it, vi } from 'vitest'
import { SharedNodeFactory } from '@/modules/companion/langgraph/nodes/_shared.js'
import type { NodeExecutionContext } from '@/modules/companion/langgraph/interfaces.js'

describe('fallback independent copy (D5/D12)', () => {
  function makeShared() {
    const structuredOutputService = {
      invokeWithFallback: vi.fn().mockRejectedValue(new Error('structured fail')),
    }
    const llmService = { invoke: vi.fn() }
    return new SharedNodeFactory(
      structuredOutputService as never,
      llmService as never,
    )
  }

  const ctx = {
    userId: 'u',
    companionId: 'c',
    conversationId: 'cv',
    companionName: 'Bot',
    structuredRepairBudget: { used: 0, budget: 1 },
  } as NodeExecutionContext

  const state = {
    userId: 'u',
    companionId: 'c',
    conversationId: 'cv',
    userMessage: 'hi',
  }

  const prompt = {
    invoke: vi.fn().mockResolvedValue('prompt text'),
  }

  it('two consecutive fallbacks do not mutate module-level fallbackSafety', async () => {
    const original = { ...fallbackSafety }
    const shared = makeShared()

    const r1 = await shared.invokeStructured(
      {},
      {
        name: 'safetyNode',
        prompt: prompt as never,
        buildVariables: async () => ({}),
      },
      fallbackSafety,
      state as never,
      ctx,
    )
    ;(r1 as typeof fallbackSafety).safetyLevel = 'crisis'
    ;(r1 as typeof fallbackSafety).boundaryAction = 'refuse'

    const r2 = await shared.invokeStructured(
      {},
      {
        name: 'safetyNode',
        prompt: prompt as never,
        buildVariables: async () => ({}),
      },
      fallbackSafety,
      state as never,
      ctx,
    )

    expect(fallbackSafety.safetyLevel).toBe(original.safetyLevel)
    expect(fallbackSafety.boundaryAction).toBe(original.boundaryAction)
    expect(r2).not.toBe(fallbackSafety)
    expect((r2 as typeof fallbackSafety).safetyLevel).toBe(original.safetyLevel)
    expect(r1).not.toBe(r2)

    // 同类 fallback 单例也不应被引用污染（调用方纪律）
    expect(fallbackIntent.primary).toBe('unclear')
    expect(fallbackEmotion.primaryEmotion).toBe('neutral')
  })

  it('nested replyExpectation / secondary mutations do not pollute fallbackIntent singleton', async () => {
    const originalDepth = fallbackIntent.replyExpectation.depth
    const originalWarmth = fallbackIntent.replyExpectation.warmth
    const originalSecondaryLen = fallbackIntent.secondary.length
    const shared = makeShared()

    const r1 = await shared.invokeStructured(
      {},
      {
        name: 'intentNode',
        prompt: prompt as never,
        buildVariables: async () => ({}),
      },
      fallbackIntent,
      state as never,
      ctx,
    )

    const copy = r1 as typeof fallbackIntent
    copy.replyExpectation.depth = 'deep'
    copy.replyExpectation.warmth = 'high'
    copy.secondary.push('small_talk' as never)
    copy.primary = 'vent' as never

    const r2 = await shared.invokeStructured(
      {},
      {
        name: 'intentNode',
        prompt: prompt as never,
        buildVariables: async () => ({}),
      },
      fallbackIntent,
      state as never,
      ctx,
    )

    expect(fallbackIntent.replyExpectation.depth).toBe(originalDepth)
    expect(fallbackIntent.replyExpectation.warmth).toBe(originalWarmth)
    expect(fallbackIntent.secondary).toHaveLength(originalSecondaryLen)
    expect(fallbackIntent.primary).toBe('unclear')
    expect(r2).not.toBe(fallbackIntent)
    expect((r2 as typeof fallbackIntent).replyExpectation).not.toBe(fallbackIntent.replyExpectation)
    expect((r2 as typeof fallbackIntent).secondary).not.toBe(fallbackIntent.secondary)
    expect((r2 as typeof fallbackIntent).replyExpectation.depth).toBe(originalDepth)
  })
})
