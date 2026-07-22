import { randomUUID } from 'node:crypto'
import { Injectable, Logger, Optional } from '@nestjs/common'
import { ObservabilityTurnService } from '../observability/observability-turn.service.js'
import type {
  ChatStreamEvent,
  CompanionErrorCode,
  StreamChatParams,
} from './companion-chat.types.js'
import { CompanionChatPipelineService } from './companion-chat-pipeline.service.js'
import {
  beginCompanionTokenBucket,
  type CompanionTokenBucket,
  getCompanionTokenBucket,
} from './langchain/token-usage.js'
import type { CompanionState } from './langgraph/interfaces.js'
import {
  absoluteSnapshotToDelta,
  collapseRepeatedReply,
  ensureCrisisHotlineInReply,
  getCrisisHotlinesCn,
  isCrisisLikeSafety,
} from './langgraph/reply-text.util.js'
import { CompanionObsEventRepository } from './repositories/companion-obs-event.repository.js'

/** 有实现的节点才允许记 span；禁止空壳子 span */
const REAL_GRAPH_NODES = new Set([
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
])

@Injectable()
export class CompanionChatStreamService {
  private readonly logger = new Logger(CompanionChatStreamService.name)

  constructor(
    private readonly pipeline: CompanionChatPipelineService,
    private readonly obsEvents: CompanionObsEventRepository,
    @Optional() private readonly obsTurn?: ObservabilityTurnService,
  ) {}

  async *streamChat(params: StreamChatParams): AsyncGenerator<ChatStreamEvent> {
    const startedAt = Date.now()
    const prepStarted = Date.now()
    const traceId = randomUUID()
    const spanMs: Record<string, number> = {}
    // 本回合 LLM token 累加（节点 invoke/stream 经 ALS 写入）
    beginCompanionTokenBucket()
    try {
      const { companion, conversationId, initialState, ctx } =
        await this.pipeline.prepareContext(params)
      // preflight.memory_load 近似：prepare 内含 memory 加载
      spanMs['preflight.memory_load'] = Date.now() - prepStarted

      if (!companion) {
        yield this.errorEvent('ERR_COMPANION_NOT_FOUND', 'Companion not found')
        return
      }

      const signal = params.signal ?? new AbortController().signal
      const executionCtx = { ...ctx, signal }

      let fullState: Partial<CompanionState> = { ...initialState }
      let safetyBlocked = false
      let safetyReason = ''
      /** 已向客户端累计发出的正文（partialTokens 按「绝对快照」解释，防 quality 二次全文拼接） */
      let emittedAbsolute = ''

      for await (const {
        patch,
        safetyBlocked: blocked,
        safetyReason: reason,
        node,
        nodeMs,
      } of this.pipeline.execute(initialState as CompanionState, executionCtx)) {
        fullState = { ...fullState, ...patch }

        if (node && typeof nodeMs === 'number' && REAL_GRAPH_NODES.has(node)) {
          spanMs[node] = (spanMs[node] ?? 0) + nodeMs
        }

        if (blocked) {
          safetyBlocked = true
          safetyReason = reason
          break
        }

        if (patch.partialTokens) {
          // partialTokens 约定为「当前全文快照」而非无状态 delta
          const next = patch.partialTokens
          const delta = absoluteSnapshotToDelta(emittedAbsolute, next)
          if (delta) {
            yield { event: 'token', data: { delta } }
            emittedAbsolute = !emittedAbsolute
              ? next
              : next.startsWith(emittedAbsolute)
                ? next
                : emittedAbsolute + delta
          }
          // soft-repair 全文改写：delta=null，不追加第二份；done 以 assistantReply 为准
        }
      }

      if (safetyBlocked) {
        // 设计 A：不落助手消息；A1+ 侧信道写 obs_event 供看板聚合
        await this.obsEvents.recordSafetyHardStop({
          companionId: params.companionId,
          conversationId,
          userId: params.userId,
          boundaryAction: fullState.safety?.boundaryAction,
          reason: safetyReason,
        })
        const latencyMs = Date.now() - startedAt
        this.writeCompanionObs({
          traceId,
          userId: params.userId,
          conversationId,
          status: 'ok',
          latencyMs,
          spanMs,
          fullState,
          safetyHardStop: true,
        })
        // 硬中断无气泡时，错误文案仍应带可求助线索（危机类）
        let blockMsg = safetyReason || '该请求无法继续'
        if (isCrisisLikeSafety(fullState.safety) || fullState.safety?.category === 'self_harm') {
          blockMsg = `${blockMsg}。若你此刻很难熬，请立刻联系身边可信的人或拨打：${getCrisisHotlinesCn()}。`
        }
        yield this.errorEvent('ERR_SAFETY_BLOCKED', blockMsg)
        return
      }

      // 图可能因 LLM 配置缺失未跑完节点；完整性失败时仍返回可用文案
      let integrityOk = true
      try {
        this.pipeline.assertFinalState(fullState)
      } catch (integrityErr) {
        integrityOk = false
        this.logger.error(
          `final state incomplete: ${integrityErr instanceof Error ? integrityErr.message : String(integrityErr)}`,
        )
      }

      const partial =
        typeof fullState.partialTokens === 'string' ? fullState.partialTokens.trim() : ''
      const rawReply =
        (fullState.assistantReply ?? '').trim() ||
        partial ||
        (integrityOk
          ? ''
          : '抱歉，伴侣对话管线暂不可用（可能未配置 Companion LLM）。请在管理后台检查模块配置后重试。')
      // 落库与 done 前：折叠重复 + 危机轮补热线号码
      const reply = ensureCrisisHotlineInReply(
        collapseRepeatedReply(rawReply),
        fullState.safety,
        params.message || fullState.userMessage,
      )

      if (reply) {
        fullState.assistantReply = reply
      }

      const finalState = fullState as CompanionState
      const latencyMs = Date.now() - startedAt

      // 先落库再 done：客户端收到完成时历史已可读；亦避免连发时 findRecent 缺上轮助手
      if (reply) {
        await this.pipeline.persistAssistantMessage(conversationId, finalState, { latencyMs })
      }

      // 记忆必须 await 落库：queueMicrotask 会导致下一轮 prepareContext 与 API 轮询竞态丢记忆
      const extracted =
        finalState.extractedMemories && finalState.extractedMemories.length > 0
          ? finalState.extractedMemories
          : []
      if (extracted.length > 0) {
        await this.pipeline.persistMemories(params.userId, params.companionId, extracted)
      }

      const postStarted = Date.now()
      yield {
        event: 'done',
        data: {
          fullReply: reply,
          content: reply,
          quality: finalState.quality,
        },
      }

      if (finalState.summary) {
        yield { event: 'summary', data: { summary: finalState.summary.text } }
      }

      if (extracted.length > 0) {
        yield { event: 'memories', data: { items: extracted } }
      }

      const postProcessMs = Date.now() - postStarted
      this.writeCompanionObs({
        traceId,
        userId: params.userId,
        conversationId,
        status: integrityOk ? 'ok' : 'error',
        latencyMs,
        postProcessMs,
        spanMs,
        fullState: finalState,
      })
    } catch (err) {
      const message = (err as Error).message || '服务暂时不可用'
      if (message === 'ERR_COMPANION_NOT_FOUND') {
        yield this.errorEvent('ERR_COMPANION_NOT_FOUND', 'Companion not found')
        return
      }
      if (message === 'ERR_COMPANION_ARCHIVED') {
        // 门闸在用户落库前，会话保持干净
        yield this.errorEvent('ERR_COMPANION_ARCHIVED', '该伴侣已归档，无法发送新消息')
        return
      }
      const code: CompanionErrorCode =
        (err as { name?: string })?.name === 'AbortError' ? 'ERR_LLM_TIMEOUT' : 'ERR_LLM_PARSE'
      this.logger.error(`streamChat error: ${message}`)
      this.writeCompanionObs({
        traceId,
        userId: params.userId,
        conversationId: params.conversationId,
        status: 'error',
        latencyMs: Date.now() - startedAt,
        spanMs,
        fullState: {},
      })
      // 设计 A：若 prepareContext 已成功，user 已落库；此处 done 仅给客户端即时文案，不伪造成功助手消息
      const fallback = message.includes('State missing')
        ? '抱歉，伴侣对话管线暂不可用（可能未配置 Companion LLM）。请在管理后台检查模块配置后重试。'
        : message
      yield {
        event: 'done',
        data: { fullReply: fallback, content: fallback, quality: undefined },
      }
      yield this.errorEvent(code, message)
    }
  }

  private writeCompanionObs(input: {
    traceId: string
    userId: string
    conversationId?: string
    status: 'ok' | 'error' | 'cancelled'
    latencyMs: number
    postProcessMs?: number
    spanMs: Record<string, number>
    fullState: Partial<CompanionState>
    safetyHardStop?: boolean
  }): void {
    if (!this.obsTurn) return
    const memCount = input.fullState.existingMemories?.length ?? 0
    const writtenCount = input.fullState.extractedMemories?.length ?? 0
    const quality = input.fullState.quality
    const tokens = this.snapshotTokens()
    const spanAttrs: Record<string, unknown> = {
      memoryLoaded: memCount,
      writtenCount,
      emotion: input.fullState.emotion?.primaryEmotion,
      route: input.fullState.route?.route,
      quality: quality?.status,
      safetyHardStop: input.safetyHardStop || undefined,
      ...(tokens.inputTokens > 0 || tokens.outputTokens > 0
        ? { inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens }
        : {}),
    }
    // 禁止空壳：不写入未实现的 vector_search 等键
    void this.obsTurn
      .recordTurn({
        traceId: input.traceId,
        route: 'companion',
        userId: input.userId,
        conversationId: input.conversationId,
        status: input.status,
        latencyMs: input.latencyMs,
        postProcessMs: input.postProcessMs,
        flags: {
          qualityFail: quality?.status === 'fail' || undefined,
          safetyHardStop: input.safetyHardStop || undefined,
        },
        spanMs: input.spanMs,
        spanAttrs,
        inputTokens: tokens.inputTokens > 0 ? tokens.inputTokens : undefined,
        outputTokens: tokens.outputTokens > 0 ? tokens.outputTokens : undefined,
      })
      .catch((err) =>
        this.logger.warn(
          `companion W2 write failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
  }

  private snapshotTokens(): CompanionTokenBucket {
    return (
      getCompanionTokenBucket() ?? {
        inputTokens: 0,
        outputTokens: 0,
      }
    )
  }

  handleDisconnect(signal: AbortSignal, reason: string): void {
    if (!signal.aborted) {
      signal.addEventListener('abort', () => {
        this.logger.log(`Client disconnected: ${reason}`)
      })
    }
  }

  private errorEvent(code: CompanionErrorCode, message: string): ChatStreamEvent {
    return { event: 'error', data: { message, code } }
  }
}
