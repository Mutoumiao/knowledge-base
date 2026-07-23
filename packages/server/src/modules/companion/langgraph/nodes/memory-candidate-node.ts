import { agentMemoryCandidateSchema } from '@goferbot/data/schemas'
import { Injectable } from '@nestjs/common'
import type { CompanionState, MemoryCandidate, NodeExecutionContext } from '../interfaces.js'
import { agentMemoryCandidatePrompt } from '../prompts.js'
import { SharedNodeFactory } from './_shared.js'

@Injectable()
export class MemoryCandidateNode {
  constructor(private readonly shared: SharedNodeFactory) {}

  async execute(
    state: CompanionState,
    ctx: NodeExecutionContext,
  ): Promise<Partial<CompanionState>> {
    // soft 边界拒绝轮：禁止把「教我网暴/违法」等抽成长期记忆（safety 出口会设 false）
    if (state.safety?.allowMemoryExtraction === false) {
      return {
        memoryCandidate: {
          shouldExtract: false,
          confidence: 1,
          category: 'unsafe',
          stability: 'stable',
          importance: 0,
          reason: 'safety.allowMemoryExtraction=false',
          candidateFacts: [],
        },
      }
    }

    // 规则快速跳过（空/短/寒暄/重复/敏感/回忆探针）
    const fastSkip = this.shared.shouldSkipMemoryCandidateFast({
      userText: state.userMessage,
      assistantText: state.assistantReply,
      existingMemories: state.existingMemories,
    })
    if (fastSkip) {
      return { memoryCandidate: fastSkip }
    }

    const hasKeyword = this.shared.shouldSkipByKeyword(state.userMessage)
    const heuristicFacts = this.shared.heuristicMemoryFacts(state.userMessage)
    const fallbackCandidate: MemoryCandidate = {
      shouldExtract: hasKeyword,
      confidence: hasKeyword ? 0.9 : 0.3,
      category: hasKeyword ? 'preference' : 'unclear',
      stability: hasKeyword ? 'stable' : 'unclear',
      importance: hasKeyword ? 4 : 1,
      reason: hasKeyword ? '关键词命中强制抽取' : 'fallback',
      candidateFacts: heuristicFacts,
    }
    const result = await this.shared.invokeStructured<MemoryCandidate>(
      agentMemoryCandidateSchema,
      {
        name: 'memoryCandidateNode',
        prompt: agentMemoryCandidatePrompt,
        buildVariables: async (s, c) => ({
          agentName: c.companionName,
          existingMemories: this.shared.formatMemoriesForPrompt(
            s.existingMemories,
            s.userMessage,
          ),
          conversationSummary: s.summary?.text ?? '（暂无）',
          userText: s.userMessage,
          assistantText: s.assistantReply ?? '（暂无）',
        }),
      },
      fallbackCandidate,
      state,
      ctx,
    )

    // 防御：LLM 若误判回忆探针为 shouldExtract，硬覆盖
    if (this.shared.isRecallProbe(state.userMessage)) {
      return {
        memoryCandidate: {
          shouldExtract: false,
          confidence: 0.97,
          category: 'unclear',
          stability: 'unclear',
          importance: 0,
          reason: '回忆探针硬拦截，禁止抽取。',
          candidateFacts: [],
        },
      }
    }

    const mergedFacts = this.shared.sanitizeMemoryFacts([
      ...(result.candidateFacts ?? []),
      ...heuristicFacts,
    ])

    const finalCandidate: MemoryCandidate = hasKeyword
      ? {
          ...result,
          shouldExtract: true,
          confidence: Math.max(result.confidence, 0.9),
          candidateFacts: mergedFacts.length > 0 ? mergedFacts : result.candidateFacts,
          importance: Math.max(result.importance, 4),
        }
      : {
          ...result,
          candidateFacts:
            (result.candidateFacts?.length ?? 0) > 0
              ? this.shared.sanitizeMemoryFacts(result.candidateFacts ?? [])
              : mergedFacts,
          // 无干净事实且非关键词时，关闭抽取，避免噪声落库
          shouldExtract:
            result.shouldExtract &&
            (this.shared.sanitizeMemoryFacts(result.candidateFacts ?? []).length > 0 ||
              mergedFacts.length > 0 ||
              hasKeyword),
        }

    // 二次：shouldExtract 但 facts 全被洗空 → 除非关键词强制
    if (
      finalCandidate.shouldExtract &&
      (finalCandidate.candidateFacts?.length ?? 0) === 0 &&
      !hasKeyword
    ) {
      finalCandidate.shouldExtract = false
      finalCandidate.reason = `${finalCandidate.reason}；候选事实去噪后为空，跳过抽取。`
    }

    return { memoryCandidate: finalCandidate }
  }
}
