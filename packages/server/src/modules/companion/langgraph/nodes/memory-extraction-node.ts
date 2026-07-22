import { agentMemoryExtractionSchema, MEMORY_EXTRACTION_LIMIT } from '@goferbot/data/schemas'
import { Injectable, Logger } from '@nestjs/common'
import type {
  CompanionState,
  MemoryExtraction,
  MemoryItem,
  NodeExecutionContext,
} from '../interfaces.js'
import { agentMemoryExtractionPrompt } from '../prompts.js'
import { SharedNodeFactory } from './_shared.js'

const CATEGORY_TO_TYPE: Record<string, MemoryItem['type']> = {
  preference: 'preference',
  boundary: 'boundary',
  relationship_goal: 'relationship_goal',
  conversation_style: 'conversation_style',
  important_fact: 'important_fact',
  identity_profile: 'important_fact',
}

@Injectable()
export class MemoryExtractionNode {
  private readonly logger = new Logger(MemoryExtractionNode.name)

  constructor(private readonly shared: SharedNodeFactory) {}

  async execute(
    state: CompanionState,
    ctx: NodeExecutionContext,
  ): Promise<Partial<CompanionState>> {
    if (!state.memoryCandidate?.shouldExtract) {
      return { extractedMemories: [] }
    }
    // 回忆探针双重保险
    if (this.shared.isRecallProbe(state.userMessage)) {
      this.logger.log('[memoryExtractionNode] stage=skip_recall_probe')
      return { extractedMemories: [] }
    }

    const result = await this.shared.invokeStructured<MemoryExtraction>(
      agentMemoryExtractionSchema,
      {
        name: 'memoryExtractionNode',
        prompt: agentMemoryExtractionPrompt,
        buildVariables: async (s, c) => ({
          agentName: c.companionName,
          existingMemories: this.shared.formatMemoriesForPrompt(
            s.existingMemories,
            s.userMessage,
          ),
          memoryCandidate: s.memoryCandidate ? JSON.stringify(s.memoryCandidate) : '（暂无）',
          conversationSummary: s.summary?.text ?? '（暂无）',
          userText: s.userMessage,
          assistantText: s.assistantReply ?? '（暂无）',
        }),
      },
      { memories: [] },
      state,
      ctx,
    )
    let memories = this.cleanMemoryItems(result.memories).slice(0, MEMORY_EXTRACTION_LIMIT)

    // LLM 空抽时：用候选 facts / 规则从用户句合成，避免「应抽未落库」
    if (memories.length === 0) {
      memories = this.fallbackFromCandidate(state)
      if (memories.length > 0) {
        this.logger.log(
          `[memoryExtractionNode] stage=fallback_candidate count=${memories.length}`,
        )
      }
    }

    memories = this.dedupeAgainstExisting(memories, state.existingMemories)
    return { extractedMemories: memories.slice(0, MEMORY_EXTRACTION_LIMIT) }
  }

  private cleanMemoryItems(
    items: Array<{ type: MemoryItem['type']; content: string; importance: number }>,
  ): MemoryItem[] {
    const out: MemoryItem[] = []
    const seen = new Set<string>()
    for (const item of items) {
      const content = this.shared.sanitizeMemoryFact(item.content)
      if (!content) continue
      const key = this.shared.normalizeMemoryContent(content)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        type: item.type,
        content: content.slice(0, 80),
        importance: Math.min(5, Math.max(1, item.importance || 3)),
      })
    }
    return out
  }

  private fallbackFromCandidate(state: CompanionState): MemoryItem[] {
    const candidate = state.memoryCandidate
    if (!candidate?.shouldExtract) return []

    const defaultType =
      CATEGORY_TO_TYPE[candidate.category] ??
      (this.shared.shouldSkipByKeyword(state.userMessage) ? 'preference' : 'important_fact')
    const importance = Math.min(5, Math.max(1, candidate.importance || 3))

    const facts = this.shared.sanitizeMemoryFacts(candidate.candidateFacts ?? [])

    // 多事实时按条推断 type：避免「记住两件事」全部打成 preference
    if (facts.length > 0) {
      return facts.slice(0, MEMORY_EXTRACTION_LIMIT).map((content) => ({
        type: this.shared.inferMemoryTypeFromContent(content) || defaultType,
        content: content.slice(0, 80),
        importance,
      }))
    }

    const heuristic = this.shared.heuristicMemoryFacts(state.userMessage)
    return heuristic.slice(0, MEMORY_EXTRACTION_LIMIT).map((content) => ({
      type: this.shared.inferMemoryTypeFromContent(content) || defaultType,
      content: content.slice(0, 80),
      importance,
    }))
  }

  private dedupeAgainstExisting(
    items: MemoryItem[],
    existing: CompanionState['existingMemories'],
  ): MemoryItem[] {
    const seen = new Set(
      (existing ?? []).map((m) => this.shared.normalizeMemoryContent(m.content)),
    )
    const out: MemoryItem[] = []
    for (const item of items) {
      const key = this.shared.normalizeMemoryContent(item.content)
      if (!key || seen.has(key)) continue
      // 子串近似去重：新事实被旧记忆完全包含则跳过
      let subsumed = false
      for (const old of seen) {
        if (old.includes(key) || key.includes(old)) {
          if (Math.abs(old.length - key.length) <= 8) {
            subsumed = true
            break
          }
        }
      }
      if (subsumed) continue
      seen.add(key)
      out.push(item)
    }
    return out
  }
}
