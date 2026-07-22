import type {
  ObservabilitySlowTurnItem,
  ObservabilityTurnMinimalWrite,
  ObservabilityTurnWrite,
} from '@goferbot/data'
import { Injectable, Logger } from '@nestjs/common'
import { LangfuseAdapter } from './langfuse.adapter.js'
import { ObservabilityTurnRepository } from './observability-turn.repository.js'

@Injectable()
export class ObservabilityTurnService {
  private readonly logger = new Logger(ObservabilityTurnService.name)

  constructor(
    private readonly repo: ObservabilityTurnRepository,
    private readonly langfuse: LangfuseAdapter,
  ) {}

  /**
   * 完整写入 + 可选 Langfuse（best-effort，不抛到业务路径）
   */
  async recordTurn(input: ObservabilityTurnWrite): Promise<void> {
    try {
      await this.repo.upsertByTraceId(input)
    } catch (err) {
      this.logger.error(
        `W2 upsert failed traceId=${input.traceId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return
    }

    try {
      if (
        this.langfuse.shouldSample({
          route: input.route,
          status: input.status,
          latencyMs: input.latencyMs,
          spanMs: input.spanMs ?? null,
          flags: (input.flags as Record<string, unknown> | null) ?? null,
        })
      ) {
        const tags: string[] = []
        if (input.flags && typeof input.flags === 'object') {
          const f = input.flags as Record<string, unknown>
          if (f.degraded) tags.push('degraded')
          if (f.retrievalEmpty) tags.push('empty')
        }
        await this.langfuse.exportTrace({
          traceId: input.traceId,
          name: input.route === 'chat' ? 'chat.turn' : 'companion.turn',
          sessionId: input.sessionId ?? input.conversationId,
          userId: input.userId,
          route: input.route,
          status: input.status,
          latencyMs: input.latencyMs,
          tags,
          metadata: {
            spanMs: input.spanMs ?? undefined,
            // P1：仅 meta keys，不展开正文
            flagKeys: input.flags ? Object.keys(input.flags) : [],
            inputTokens: input.inputTokens ?? undefined,
            outputTokens: input.outputTokens ?? undefined,
          },
        })
      }
    } catch (err) {
      this.logger.warn(
        `Langfuse path failed traceId=${input.traceId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** error/超慢：最小行加固 */
  async recordMinimal(input: ObservabilityTurnMinimalWrite): Promise<void> {
    await this.recordTurn({
      traceId: input.traceId,
      route: input.route,
      status: input.status,
      latencyMs: input.latencyMs,
      userId: input.userId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      messageId: input.messageId,
    })
  }

  async patchFlags(traceId: string, flags: Record<string, unknown>): Promise<void> {
    try {
      await this.repo.mergeFlags(traceId, flags)
    } catch (err) {
      this.logger.warn(
        `W2 mergeFlags failed traceId=${traceId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async listSlowItems(
    route: 'chat' | 'companion',
    since: Date,
    topN?: number,
  ): Promise<ObservabilitySlowTurnItem[]> {
    const n = topN ?? Number(process.env.OBS_SLOW_TOP_N ?? '20')
    const rows = await this.repo.listSlow(route, since, n)
    return rows.map((r) => {
      const sessionOrConv = route === 'chat' ? r.sessionId : r.conversationId
      return {
        traceId: r.traceId,
        route: r.route as 'chat' | 'companion',
        status: r.status as ObservabilitySlowTurnItem['status'],
        latencyMs: r.latencyMs,
        createdAt: r.createdAt.toISOString(),
        sessionId: r.sessionId,
        conversationId: r.conversationId,
        messageId: r.messageId,
        langfuseUrl: this.langfuse.buildTraceUrl(r.traceId),
        deepLink: sessionOrConv
          ? {
              kind: route === 'chat' ? 'chat_session' : 'companion_conversation',
              id: sessionOrConv,
              messageId: r.messageId ?? undefined,
            }
          : null,
      }
    })
  }

  listByRouteSince(route: 'chat' | 'companion', since: Date) {
    return this.repo.listByRouteSince(route, since)
  }
}
