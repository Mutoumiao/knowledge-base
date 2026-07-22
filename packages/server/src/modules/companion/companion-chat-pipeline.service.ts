import { Injectable, Logger } from '@nestjs/common'
import { CompanionService } from './companion.service.js'
import {
  MEMORY_INJECTION_LIMIT,
  MESSAGE_FEEDBACK_INJECTION_LIMIT,
  RECENT_MESSAGE_LIMIT,
} from './langchain/constants.js'
import { CompanionGraphService } from './langgraph/graph.js'
import type { CompanionState, NodeExecutionContext } from './langgraph/interfaces.js'
import { SharedNodeFactory } from './langgraph/nodes/_shared.js'
import { CompanionRepository } from './repositories/companion.repository.js'
import { CompanionConversationRepository } from './repositories/companion-conversation.repository.js'
import { CompanionFeedbackRepository } from './repositories/companion-feedback.repository.js'
import { CompanionMemoryRepository } from './repositories/companion-memory.repository.js'
import { CompanionMessageRepository } from './repositories/companion-message.repository.js'

@Injectable()
export class CompanionChatPipelineService {
  private readonly logger = new Logger(CompanionChatPipelineService.name)

  constructor(
    private readonly graphService: CompanionGraphService,
    private readonly companionRepo: CompanionRepository,
    private readonly conversationRepo: CompanionConversationRepository,
    private readonly messageRepo: CompanionMessageRepository,
    private readonly memoryRepo: CompanionMemoryRepository,
    private readonly feedbackRepo: CompanionFeedbackRepository,
    private readonly companionService: CompanionService,
    private readonly shared: SharedNodeFactory,
  ) {}

  async prepareContext(params: {
    userId: string
    companionId: string
    conversationId?: string
    message: string
  }): Promise<{
    companion: Awaited<ReturnType<CompanionRepository['findById']>>
    conversationId: string
    initialState: Partial<CompanionState>
    ctx: NodeExecutionContext
  }> {
    const companion = await this.companionRepo.findByIdAndAuthorize(
      params.companionId,
      params.userId,
      'chat',
    )
    if (!companion) {
      throw new Error('ERR_COMPANION_NOT_FOUND')
    }
    if (companion.status === 'archived') {
      throw new Error('ERR_COMPANION_ARCHIVED')
    }
    // user 源 draft 允许所有者调试；system 非 published 已在 authorize 拒绝

    const conversation = await this.conversationRepo.getOrCreate(
      params.conversationId,
      params.userId,
      params.companionId,
    )

    // 先加载历史再落库本轮用户消息，避免 recentMessages 与 userMessage 重复计入 prompt
    const [memories, recentMessages, feedbacks, resolvedPrompt] = await Promise.all([
      this.memoryRepo.findByUser(params.userId, params.companionId, MEMORY_INJECTION_LIMIT),
      this.messageRepo.findRecent(conversation.id, RECENT_MESSAGE_LIMIT),
      this.feedbackRepo.findRecentByCompanion(
        params.userId,
        params.companionId,
        MESSAGE_FEEDBACK_INJECTION_LIMIT,
      ),
      this.companionService.resolvePromptForChat(companion),
    ])

    /**
     * 用户消息尽早提交（设计 A）：
     * - 成功：user + assistant 各落库，messageCount +2
     * - safety 拦截 / 管线失败 / 空回复：仅保留 user（半会话），messageCount +1；助手错误文案是否落库由 stream 层决定
     * - archived / not found：在此之前已抛错，不得落库
     * 本轮正文只在 state.userMessage，不得再出现在 recentMessages 中。
     */
    await this.messageRepo.save({
      conversationId: conversation.id,
      userId: params.userId,
      companionId: params.companionId,
      role: 'user',
      content: params.message,
    })
    // 含本轮用户消息的会话累计数，供 relationship 等节点使用（非 recent 窗口长度）
    const afterUser = await this.conversationRepo.incrementMessageCount(conversation.id)

    const initialState: Partial<CompanionState> = {
      userId: params.userId,
      companionId: params.companionId,
      conversationId: conversation.id,
      userMessage: params.message,
      messageCount: afterUser.messageCount,
      // 注入前去噪：过滤历史探针/问句残片，避免旧污染进入 prompt
      existingMemories: this.shared
        .filterInjectableMemories(
          memories.map((m) => ({
            id: m.id,
            type: m.type,
            content: m.content,
            importance: m.importance,
          })),
        )
        .map((m) => ({
          id: m.id,
          type: m.type,
          content: m.content,
          importance: m.importance,
        })),
      recentMessages: recentMessages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt,
      })),
      feedbacks: feedbacks.map((f) => ({
        rating: f.rating as 'positive' | 'negative',
        reason: f.reason ?? undefined,
      })),
    }

    const ctx: NodeExecutionContext = {
      userId: params.userId,
      companionId: params.companionId,
      conversationId: conversation.id,
      companionName: companion.name,
      companionPersonality: companion.personality ?? undefined,
      companionTone: companion.tone ?? undefined,
      companionBoundaries: companion.boundaries ?? undefined,
      companionGuardrails: companion.guardrailsPrompt ?? undefined,
      // 运行时权威：user 源安全节随全局配置刷新，禁止仅信库内陈旧 defaultPrompt
      companionDefaultPrompt: resolvedPrompt,
      signal: new AbortController().signal,
    }

    return { companion, conversationId: conversation.id, initialState, ctx }
  }

  async *execute(
    initialState: CompanionState,
    ctx: NodeExecutionContext,
  ): AsyncGenerator<{
    patch: Partial<CompanionState>
    safetyBlocked: boolean
    safetyReason: string
    node?: string
    nodeMs?: number
  }> {
    let stepStarted = Date.now()
    for await (const { node, patch } of this.graphService.stream(initialState, ctx)) {
      const nodeMs = Date.now() - stepStarted
      stepStarted = Date.now()
      if (
        patch.safety?.boundaryAction === 'refuse' ||
        patch.safety?.boundaryAction === 'crisis_support'
      ) {
        yield {
          patch,
          safetyBlocked: true,
          safetyReason: patch.safety.reason,
          node,
          nodeMs,
        }
        break
      }

      yield { patch, safetyBlocked: false, safetyReason: '', node, nodeMs }
    }
  }

  assertFinalState(state: Partial<CompanionState>): asserts state is CompanionState {
    const missing: string[] = []
    const required: Array<keyof CompanionState> = [
      'safety',
      'intent',
      'emotion',
      'route',
      'policy',
      'quality',
      'assistantReply',
    ]
    for (const key of required) {
      if (state[key] === undefined) missing.push(String(key))
    }
    if (missing.length > 0) {
      this.logger.error(`final state integrity violation missing=${missing.join(',')}`)
      throw new Error(`State missing critical fields: ${missing.join(',')}`)
    }
  }

  async persistMemories(
    userId: string,
    companionId: string,
    items: Array<{ type: string; content: string; importance: number }>,
  ): Promise<void> {
    try {
      const data = items.map((m) => ({
        userId,
        companionId,
        type: m.type as
          | 'preference'
          | 'boundary'
          | 'relationship_goal'
          | 'conversation_style'
          | 'important_fact',
        content: m.content,
        importance: m.importance,
        status: 'active' as const,
      }))
      await this.memoryRepo.bulkCreate(data)
    } catch (err) {
      this.logger.error(`persistMemories failed: ${(err as Error).message}`)
    }
  }

  async persistAssistantMessage(
    conversationId: string,
    state: CompanionState,
    opts?: { latencyMs?: number },
  ): Promise<void> {
    try {
      const content = state.assistantReply ?? ''
      await this.messageRepo.save({
        conversationId,
        userId: state.userId,
        companionId: state.companionId,
        role: 'assistant',
        content,
        metadata: this.buildPipelineMetadataSnapshot(state, opts),
      })
      await this.conversationRepo.incrementMessageCount(conversationId)
      // 列表/预览字段：与 care generate 对齐，聊天成功后必须刷新
      await this.companionRepo.update(state.companionId, {
        lastAssistantMessage: content,
        lastAssistantMessageAtMs: BigInt(Date.now()),
      })
      if (state.summary) {
        await this.conversationRepo.updateSummary(conversationId, state.summary.text)
      }
    } catch (err) {
      this.logger.error(`persistAssistantMessage failed: ${(err as Error).message}`)
    }
  }

  /** 助手消息 metadata 快照：quality 必含，不含完整 system prompt */
  buildPipelineMetadataSnapshot(
    state: CompanionState,
    opts?: { latencyMs?: number },
  ): string {
    const snapshot = {
      safety: state.safety
        ? {
            safetyLevel: state.safety.safetyLevel,
            boundaryAction: state.safety.boundaryAction,
            reason: state.safety.reason,
          }
        : undefined,
      intent: state.intent
        ? {
            primary: state.intent.primary,
            userNeed: state.intent.userNeed,
          }
        : undefined,
      emotion: state.emotion
        ? {
            primaryEmotion: state.emotion.primaryEmotion,
            intensity: state.emotion.intensity,
            replyTone: state.emotion.replyTone,
          }
        : undefined,
      relationship: state.relationship
        ? {
            stage: state.relationship.stage,
            intimacyPermission: state.relationship.intimacyPermission,
          }
        : undefined,
      route: state.route
        ? {
            route: state.route.route,
            responseLength: state.route.responseLength,
          }
        : undefined,
      policySummary: state.policy
        ? {
            policy: state.policy.policy,
            openingMove: state.policy.openingMove,
          }
        : undefined,
      quality: state.quality ?? null,
      summaryText: state.summary?.text?.slice(0, 200),
      extractedMemoryCount: state.extractedMemories?.length ?? 0,
      ...(typeof opts?.latencyMs === 'number' ? { latencyMs: opts.latencyMs } : {}),
    }
    return JSON.stringify(snapshot)
  }
}
