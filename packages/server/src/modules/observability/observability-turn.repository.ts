import type { ObservabilityTurnWrite } from '@goferbot/data'
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../processors/database/prisma.service.js'

export type ObservabilityTurnRow = {
  id: string
  traceId: string
  route: string
  userId: string | null
  sessionId: string | null
  conversationId: string | null
  messageId: string | null
  status: string
  latencyMs: number
  postProcessMs: number | null
  flags: unknown
  spanMs: unknown
  spanAttrs: unknown
  inputTokens: number | null
  outputTokens: number | null
  createdAt: Date
  updatedAt: Date
}

@Injectable()
export class ObservabilityTurnRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertByTraceId(input: ObservabilityTurnWrite): Promise<ObservabilityTurnRow> {
    const data = {
      route: input.route,
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      status: input.status,
      latencyMs: input.latencyMs,
      postProcessMs: input.postProcessMs ?? null,
      flags: (input.flags ?? undefined) as Prisma.InputJsonValue | undefined,
      spanMs: (input.spanMs ?? undefined) as Prisma.InputJsonValue | undefined,
      spanAttrs: (input.spanAttrs ?? undefined) as Prisma.InputJsonValue | undefined,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
    }

    return this.prisma.observabilityTurn.upsert({
      where: { traceId: input.traceId },
      create: {
        traceId: input.traceId,
        ...data,
      },
      update: {
        ...data,
      },
    }) as Promise<ObservabilityTurnRow>
  }

  async findByTraceId(traceId: string): Promise<ObservabilityTurnRow | null> {
    return this.prisma.observabilityTurn.findUnique({
      where: { traceId },
    }) as Promise<ObservabilityTurnRow | null>
  }

  async listByRouteSince(
    route: 'chat' | 'companion',
    since: Date,
    take = 10_000,
  ): Promise<ObservabilityTurnRow[]> {
    return this.prisma.observabilityTurn.findMany({
      where: {
        route,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take,
    }) as Promise<ObservabilityTurnRow[]>
  }

  async listSlow(
    route: 'chat' | 'companion',
    since: Date,
    topN: number,
  ): Promise<ObservabilityTurnRow[]> {
    return this.prisma.observabilityTurn.findMany({
      where: {
        route,
        createdAt: { gte: since },
        status: { not: 'cancelled' },
      },
      orderBy: { latencyMs: 'desc' },
      take: topN,
    }) as Promise<ObservabilityTurnRow[]>
  }

  /**
   * 批删过期行；返回删除数。多实例并发幂等。
   */
  async deleteOlderThan(cutoff: Date, batchSize = 500): Promise<number> {
    let total = 0
    for (;;) {
      const ids = await this.prisma.observabilityTurn.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: batchSize,
      })
      if (ids.length === 0) break
      const res = await this.prisma.observabilityTurn.deleteMany({
        where: { id: { in: ids.map((r) => r.id) } },
      })
      total += res.count
      if (ids.length < batchSize) break
    }
    return total
  }

  async mergeFlags(
    traceId: string,
    flagsPatch: Record<string, unknown>,
  ): Promise<ObservabilityTurnRow | null> {
    const existing = await this.findByTraceId(traceId)
    if (!existing) return null
    const prev =
      existing.flags && typeof existing.flags === 'object' && !Array.isArray(existing.flags)
        ? (existing.flags as Record<string, unknown>)
        : {}
    return this.prisma.observabilityTurn.update({
      where: { traceId },
      data: {
        flags: { ...prev, ...flagsPatch } as Prisma.InputJsonValue,
      },
    }) as Promise<ObservabilityTurnRow>
  }
}
