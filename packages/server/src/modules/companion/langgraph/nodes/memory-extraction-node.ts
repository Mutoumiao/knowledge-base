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

    // LLM 空抽或部分漏抽：用候选/启发式补齐（O8：双要点「偏好+生活事实」只落一条）
    const beforePad = memories.length
    memories = this.padWithCandidateFacts(memories, state)
    if (memories.length > beforePad) {
      this.logger.log(
        `[memoryExtractionNode] stage=pad_candidate before=${beforePad} after=${memories.length}`,
      )
    }

    memories = this.dedupeAgainstExisting(memories, state.existingMemories)
    return { extractedMemories: memories.slice(0, MEMORY_EXTRACTION_LIMIT) }
  }

  /**
   * 在已有 LLM 结果上补齐未覆盖的 candidate/heuristic 事实，直到 MEMORY_EXTRACTION_LIMIT。
   * 仅当 candidate.shouldExtract 时启用；优先补 important_fact，避免近义偏好占坑挤掉生活事实。
   */
  private padWithCandidateFacts(memories: MemoryItem[], state: CompanionState): MemoryItem[] {
    if (memories.length >= MEMORY_EXTRACTION_LIMIT) return memories
    if (!state.memoryCandidate?.shouldExtract) return memories

    const extras = this.fallbackFromCandidate(state)
    if (extras.length === 0) return memories

    const seen = new Set(memories.map((m) => this.shared.normalizeMemoryContent(m.content)))
    const uncovered = extras
      .filter((ex) => !this.shared.isMemoryContentCovered(ex.content, seen))
      .sort((a, b) => this.padPriority(b) - this.padPriority(a))

    const out = [...memories]
    for (const ex of uncovered) {
      if (out.length >= MEMORY_EXTRACTION_LIMIT) break
      if (this.shared.isMemoryContentCovered(ex.content, seen)) continue
      out.push(ex)
      seen.add(this.shared.normalizeMemoryContent(ex.content))
    }
    return out
  }

  /** pad 排序：生活事实强信号优先于偏好/其它，减轻 LIMIT=2 近义占坑 */
  private padPriority(item: MemoryItem): number {
    const strong = this.shared.inferStrongMemoryTypeFromContent(item.content)
    if (strong === 'important_fact' || item.type === 'important_fact') return 3
    if (strong === 'boundary' || item.type === 'boundary') return 2
    if (strong === 'preference' || item.type === 'preference') return 1
    return 0
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
        // 落库前纠偏：内容启发式优先，避免「加班失眠」等事实被 LLM 标成 preference
        type: this.resolveMemoryType(content, item.type),
        content: content.slice(0, 80),
        importance: Math.min(5, Math.max(1, item.importance || 3)),
      })
    }
    return out
  }

  /**
   * resolvedType = strongInfer || llm || default
   * 仅内容强信号覆盖 LLM；无强信号时保留 LLM/category 映射
   */
  private resolveMemoryType(
    content: string,
    llmType?: MemoryItem['type'] | string | null,
  ): MemoryItem['type'] {
    const strong = this.shared.inferStrongMemoryTypeFromContent(content)
    if (strong) return strong
    if (llmType && llmType in CATEGORY_TO_TYPE) {
      return CATEGORY_TO_TYPE[llmType] ?? (llmType as MemoryItem['type'])
    }
    if (
      llmType === 'preference' ||
      llmType === 'boundary' ||
      llmType === 'relationship_goal' ||
      llmType === 'conversation_style' ||
      llmType === 'important_fact'
    ) {
      return llmType
    }
    return 'important_fact'
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
        type: this.resolveMemoryType(content, defaultType),
        content: content.slice(0, 80),
        importance,
      }))
    }

    const heuristic = this.shared.heuristicMemoryFacts(state.userMessage)
    return heuristic.slice(0, MEMORY_EXTRACTION_LIMIT).map((content) => ({
      type: this.resolveMemoryType(content, defaultType),
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
      if (this.shared.isMemoryContentCovered(item.content, seen)) continue
      const key = this.shared.normalizeMemoryContent(item.content)
      if (!key) continue
      seen.add(key)
      out.push(item)
    }
    return out
  }
}
