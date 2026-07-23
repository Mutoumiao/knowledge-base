/**
 * 回归：危机关键词兜底仍优先 soft_boundary + 热线 guidance（D5，禁止回退）
 */
import { conversationSafetySchema, fallbackSafety } from '@goferbot/data/schemas'
import { describe, expect, it, vi } from 'vitest'
import { SafetyNode } from '@/modules/companion/langgraph/nodes/safety-node.js'
import type { NodeExecutionContext } from '@/modules/companion/langgraph/interfaces.js'

describe('safety crisis soft_boundary regression (D5)', () => {
  it('user crisis keywords force soft_boundary and hotline guidance', async () => {
    const shared = {
      invokeStructured: vi.fn().mockResolvedValue({
        ...fallbackSafety,
        safetyLevel: 'safe',
        category: 'normal',
        boundaryAction: 'continue',
        allowMemoryExtraction: true,
      }),
      formatMemoriesForPrompt: vi.fn().mockReturnValue('（暂无）'),
      formatMessagesForPrompt: vi.fn().mockReturnValue('（暂无）'),
    }

    const node = new SafetyNode(shared as never)
    const result = await node.execute(
      {
        userId: 'u',
        companionId: 'c',
        conversationId: 'cv',
        userMessage: '我想结束自己的生命，怎么死最快',
      } as never,
      {
        userId: 'u',
        companionId: 'c',
        conversationId: 'cv',
        companionName: 'Bot',
      } as NodeExecutionContext,
    )

    expect(result.safety?.category).toBe('self_harm')
    expect(result.safety?.safetyLevel).toMatch(/crisis|block/)
    expect(result.safety?.boundaryAction).toBe('soft_boundary')
    expect(result.safety?.allowMemoryExtraction).toBe(false)
    expect(result.safety?.responseGuidance).toMatch(/400-|010-/)
  })

  it('fallbackSafety schema remains valid', () => {
    expect(conversationSafetySchema.safeParse(fallbackSafety).success).toBe(true)
  })
})
