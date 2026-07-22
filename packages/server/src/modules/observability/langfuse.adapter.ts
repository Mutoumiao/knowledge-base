import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'

export type LangfuseExportInput = {
  traceId: string
  name: 'chat.turn' | 'companion.turn'
  sessionId?: string | null
  userId?: string | null
  route: 'chat' | 'companion'
  status: string
  latencyMs: number
  tags?: string[]
  metadata?: Record<string, unknown>
}

/**
 * 可插拔 Langfuse 导出（无 SDK 硬依赖）。
 * 未配置 PUBLIC+SECRET → no-op；失败仅打日志。
 */
@Injectable()
export class LangfuseAdapter {
  private readonly logger = new Logger(LangfuseAdapter.name)

  isEnabled(): boolean {
    return Boolean(
      process.env.LANGFUSE_PUBLIC_KEY?.trim() && process.env.LANGFUSE_SECRET_KEY?.trim(),
    )
  }

  getHost(): string | null {
    const host = process.env.LANGFUSE_HOST?.trim()
    return host ? host.replace(/\/$/, '') : null
  }

  buildTraceUrl(traceId: string): string | null {
    const host = this.getHost()
    if (!host) return null
    return `${host}/trace/${encodeURIComponent(traceId)}`
  }

  hashUserId(userId: string | null | undefined): string | undefined {
    if (!userId) return undefined
    return createHash('sha256').update(userId).digest('hex').slice(0, 32)
  }

  /**
   * TH2 采样：基础率 + 强制规则
   */
  shouldSample(input: {
    route: 'chat' | 'companion'
    status: string
    latencyMs: number
    spanMs?: Record<string, number> | null
    flags?: Record<string, unknown> | null
  }): boolean {
    if (!this.isEnabled()) return false

    const base = Number(process.env.TRACE_SAMPLE_RATE ?? '0.1')
    const forceChatE2e = Number(process.env.TRACE_FORCE_CHAT_E2E_MS ?? '5000')
    const forceChatKa = Number(process.env.TRACE_FORCE_CHAT_KA_MS ?? '3000')
    const forceCompanionE2e = Number(process.env.TRACE_FORCE_COMPANION_E2E_MS ?? '4000')
    const forceCompanionGen = Number(process.env.TRACE_FORCE_COMPANION_GENERATE_MS ?? '2500')

    if (input.status === 'error') return true
    if (input.route === 'chat') {
      if (input.latencyMs > forceChatE2e) return true
      const ka = input.spanMs?.['knowledge.ai']
      if (typeof ka === 'number' && ka > forceChatKa) return true
      if (input.flags?.retrievalEmpty || input.flags?.degraded) return true
    }
    if (input.route === 'companion') {
      if (input.latencyMs > forceCompanionE2e) return true
      const gen = input.spanMs?.generate
      if (typeof gen === 'number' && gen > forceCompanionGen) return true
    }
    // cancelled 一般不强制
    if (input.status === 'cancelled') {
      return Math.random() < Math.min(1, Math.max(0, base))
    }
    return Math.random() < Math.min(1, Math.max(0, base))
  }

  /**
   * Best-effort 导出：P1 仅 metadata，无正文。
   */
  async exportTrace(input: LangfuseExportInput): Promise<void> {
    if (!this.isEnabled()) return
    const host = this.getHost() ?? 'https://cloud.langfuse.com'
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim()
    const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim()
    if (!publicKey || !secretKey) return
    const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64')

    const tags = [
      `route:${input.route}`,
      ...(input.tags ?? []),
      ...(input.status === 'error' ? ['error'] : []),
    ]

    // 最小 ingestion batch（trace-create）
    const body = {
      batch: [
        {
          id: input.traceId,
          type: 'trace-create',
          timestamp: new Date().toISOString(),
          body: {
            id: input.traceId,
            name: input.name,
            sessionId: input.sessionId ?? undefined,
            userId: this.hashUserId(input.userId),
            tags,
            metadata: {
              ...(input.metadata ?? {}),
              status: input.status,
              latencyMs: input.latencyMs,
              route: input.route,
            },
          },
        },
      ],
    }

    const controller = new AbortController()
    const timeoutMs = Number(process.env.LANGFUSE_EXPORT_TIMEOUT_MS ?? '3000')
    const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs))
    try {
      const res = await fetch(`${host}/api/public/ingestion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        this.logger.warn(
          `Langfuse export failed: ${res.status} ${text.slice(0, 200)} traceId=${input.traceId}`,
        )
      }
    } catch (err) {
      this.logger.warn(
        `Langfuse export error: ${err instanceof Error ? err.message : String(err)} traceId=${input.traceId}`,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
