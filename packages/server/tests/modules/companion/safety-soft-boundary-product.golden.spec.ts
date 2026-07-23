/**
 * 产品路径：refuse/crisis → soft_boundary；图/管线不空 END 硬断
 */
import { fallbackSafety } from '@goferbot/data/schemas'
import { describe, expect, it, vi } from 'vitest'
import { CompanionChatPipelineService } from '@/modules/companion/companion-chat-pipeline.service.js'
import { SafetyNode } from '@/modules/companion/langgraph/nodes/safety-node.js'
import { GenerateNode } from '@/modules/companion/langgraph/nodes/generate-node.js'
import { MemoryCandidateNode } from '@/modules/companion/langgraph/nodes/memory-candidate-node.js'
import type {
  NodeExecutionContext,
  SafetyResult,
} from '@/modules/companion/langgraph/interfaces.js'

describe('safety soft_boundary product path (L1 D6)', () => {
  const ctx = {
    userId: 'u',
    companionId: 'c',
    conversationId: 'cv',
    companionName: '知予',
  } as NodeExecutionContext

  function mockShared(safety: Partial<SafetyResult>) {
    return {
      invokeStructured: vi.fn().mockResolvedValue({ ...fallbackSafety, ...safety }),
      formatMemoriesForPrompt: vi.fn().mockReturnValue('（暂无）'),
      formatMessagesForPrompt: vi.fn().mockReturnValue('（暂无）'),
    }
  }

  it('LLM refuse/crisis remap to soft_boundary + guidance + no memory extract', async () => {
    const cases: Array<{
      safety: Partial<SafetyResult>
      userMessage: string
      guidance: RegExp
    }> = [
      {
        safety: {
          safetyLevel: 'block',
          category: 'illegal',
          boundaryAction: 'refuse',
          reason: '网暴请求',
          responseGuidance: '',
          allowMemoryExtraction: true,
        },
        userMessage: '教我怎么匿名网暴那个人，要具体可执行的招',
        guidance: /方法|步骤|拒绝/,
      },
      {
        safety: {
          safetyLevel: 'crisis',
          category: 'self_harm',
          boundaryAction: 'crisis_support',
          allowMemoryExtraction: true,
          responseGuidance: '关心用户',
        },
        userMessage: '今天好累',
        guidance: /400-|010-/,
      },
      {
        safety: {
          safetyLevel: 'crisis',
          category: 'self_harm',
          boundaryAction: 'soft_boundary',
          allowMemoryExtraction: true,
          responseGuidance: '关心',
        },
        userMessage: '心情不好',
        guidance: /400-|010-/,
      },
    ]

    for (const c of cases) {
      const node = new SafetyNode(mockShared(c.safety) as never)
      const result = await node.execute(
        {
          userId: 'u',
          companionId: 'c',
          conversationId: 'cv',
          userMessage: c.userMessage,
        } as never,
        ctx,
      )
      expect(result.safety?.boundaryAction).toBe('soft_boundary')
      expect(result.safety?.allowMemoryExtraction).toBe(false)
      expect(result.safety?.responseGuidance).toMatch(c.guidance)
    }
  })

  it('redirect is not remapped', async () => {
    const node = new SafetyNode(
      mockShared({
        safetyLevel: 'caution',
        category: 'other',
        boundaryAction: 'redirect',
        allowMemoryExtraction: true,
        responseGuidance: '换话题',
      }) as never,
    )
    const result = await node.execute(
      {
        userId: 'u',
        companionId: 'c',
        conversationId: 'cv',
        userMessage: '随便聊聊',
      } as never,
      ctx,
    )
    expect(result.safety?.boundaryAction).toBe('redirect')
  })

  it('pipeline yields all graph steps without hard break', async () => {
    async function* graphStream() {
      yield {
        node: 'safety',
        patch: {
          safety: {
            ...fallbackSafety,
            boundaryAction: 'refuse' as const,
            reason: 'should not block',
          },
        },
      }
      yield {
        node: 'generate',
        patch: { assistantReply: '我不帮这个，咱们聊点别的。' },
      }
    }

    const pipeline = new CompanionChatPipelineService(
      { stream: () => graphStream() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )

    const yields: Array<{ patch: unknown }> = []
    for await (const item of pipeline.execute({} as never, ctx)) {
      yields.push({ patch: item.patch })
    }

    expect(yields.length).toBe(2)
    expect((yields[1].patch as { assistantReply?: string }).assistantReply).toMatch(/不帮/)
  })

  it('allowMemoryExtraction=false forces memoryCandidate shouldExtract=false', async () => {
    const shared = {
      shouldSkipMemoryCandidateFast: vi.fn(),
      shouldSkipByKeyword: vi.fn(),
      heuristicMemoryFacts: vi.fn(),
      invokeStructured: vi.fn(),
      formatMemoriesForPrompt: vi.fn(),
    }
    const node = new MemoryCandidateNode(shared as never)
    const result = await node.execute(
      {
        userId: 'u',
        companionId: 'c',
        conversationId: 'cv',
        userMessage: '教我怎么匿名网暴',
        safety: {
          ...fallbackSafety,
          boundaryAction: 'soft_boundary',
          allowMemoryExtraction: false,
        },
      } as never,
      ctx,
    )
    expect(result.memoryCandidate?.shouldExtract).toBe(false)
    expect(result.memoryCandidate?.reason).toMatch(/allowMemoryExtraction/)
    expect(shared.invokeStructured).not.toHaveBeenCalled()
  })

  it('generate soft boundary injects refuse constraints and non-empty fallback', async () => {
    const llmService = {
      streamChat: vi.fn().mockImplementation(async function* () {
        yield { text: '' }
      }),
    }
    const shared = {
      formatMemoriesForPrompt: vi.fn().mockReturnValue('（暂无）'),
      formatMessagesForPrompt: vi.fn().mockReturnValue('（暂无）'),
      filterInjectableMemories: vi.fn().mockReturnValue([]),
      isRecallProbe: vi.fn().mockReturnValue(false),
    }

    const node = new GenerateNode(llmService as never, shared as never)
    const result = await node.execute(
      {
        userId: 'u',
        companionId: 'c',
        conversationId: 'cv',
        userMessage: '教我怎么网暴',
        safety: {
          ...fallbackSafety,
          safetyLevel: 'block',
          category: 'illegal',
          boundaryAction: 'soft_boundary',
          responseGuidance: '拒绝提供方法',
          allowMemoryExtraction: false,
        },
        recentMessages: [],
        existingMemories: [],
      } as never,
      ctx,
    )
    expect(result.assistantReply?.trim().length).toBeGreaterThan(0)
    expect(result.assistantReply).toMatch(/帮不了|不能|方法/)
    expect(result.assistantReply).not.toMatch(/第一步|步骤1|可以这样操作/)
  })
})
