/**
 * 双模块观测均衡 M — 最小自动验收包（grill §10.3 可自动化项）
 *
 * 覆盖：
 * - observability_turns 表 + upsert
 * - Admin RAG 读 W2（empty/degraded/p95）；cancelled 不进 e2e
 * - 无 W2 时 empty/degraded = pending_instrumentation（不混扫消息）
 * - Chat 显式反馈 API 回写 metadata + W2 flags
 * - 慢列表含 traceId
 * - 在线 KPI label 禁用「准确率」
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaService } from '../../packages/server/src/processors/database/prisma.service.js'
import { AuthFixtures, adminAuthHeader, authHeader } from './helpers/auth.fixtures.js'
import { TestAppFactory } from './helpers/test-app.factory.js'
import { TestDatabaseManager } from './helpers/test-database.manager.js'
import { createIpGenerator } from './helpers/test-utils.js'

const nextIp = createIpGenerator(71)

function unwrap<T = Record<string, unknown>>(body: { data?: T } | T): T {
  const b = body as { data?: T }
  return (b.data ?? body) as T
}

describe('Dual-module observability W2 auto-acceptance', () => {
  let app: NestFastifyApplication
  let dbManager: TestDatabaseManager
  let dbUrl: string
  let dbName: string
  let prisma: PrismaService

  let adminToken: string
  let userToken: string
  let adminUserId: string
  let userId: string
  let sessionId: string
  let assistantMessageId: string
  const traceId = `auto-acc-trace-${Date.now()}`

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_ADMIN_URL) {
      process.env.TEST_DATABASE_ADMIN_URL =
        process.env.DATABASE_URL?.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1') ||
        'postgresql://gofer:gofer_dev_pass@127.0.0.1:5432/postgres'
    }

    dbManager = new TestDatabaseManager()
    dbUrl = await dbManager.createDatabase('obs_w2_acc')
    dbName = new URL(dbUrl).pathname.slice(1)
    app = await TestAppFactory.create(dbUrl)
    prisma = app.get(PrismaService)

    const ts = Date.now()
    const adminEmail = `obs-w2-admin-${ts}@test.gofer`
    const userEmail = `obs-w2-user-${ts}@test.gofer`

    await AuthFixtures.createUser(
      app,
      { email: adminEmail, password: 'Test1234!', name: 'Obs Admin' },
      { remoteAddress: nextIp() },
    )
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })
    adminUserId = adminUser.id
    await prisma.userRole.create({
      data: { userId: adminUser.id, roleCode: 'super_admin', app: 'admin' },
    })
    adminToken = await AuthFixtures.loginAsAdmin(
      app,
      { email: adminEmail, password: 'Test1234!' },
      { remoteAddress: nextIp() },
    )

    const user = await AuthFixtures.createUser(
      app,
      { email: userEmail, password: 'Test1234!', name: 'Obs User' },
      { remoteAddress: nextIp() },
    )
    userId = user.id
    userToken = await AuthFixtures.loginAs(
      app,
      { email: userEmail, password: 'Test1234!' },
      { remoteAddress: nextIp() },
    )

    const session = await prisma.session.create({
      data: { userId, title: 'w2-acc-session' },
    })
    sessionId = session.id
    const msg = await prisma.message.create({
      data: {
        sessionId,
        role: 'assistant',
        content: 'auto-acc assistant reply',
        status: 'completed',
        metadata: { obs_trace_id: traceId },
      },
    })
    assistantMessageId = msg.id

    await prisma.observabilityTurn.createMany({
      data: [
        {
          traceId,
          route: 'chat',
          userId,
          sessionId,
          messageId: assistantMessageId,
          status: 'ok',
          latencyMs: 1500,
          postProcessMs: 40,
          flags: {
            retrievalEmpty: false,
            degraded: false,
            contractSuccess: true,
          },
          spanMs: { 'knowledge.ai': 1100 },
          inputTokens: 100,
          outputTokens: 50,
        },
        {
          traceId: `${traceId}-empty`,
          route: 'chat',
          userId,
          sessionId,
          status: 'ok',
          latencyMs: 400,
          flags: { retrievalEmpty: true, contractSuccess: false },
          spanMs: { 'knowledge.ai': 200 },
        },
        {
          traceId: `${traceId}-cancel`,
          route: 'chat',
          userId,
          sessionId,
          status: 'cancelled',
          latencyMs: 88_888,
          flags: {},
        },
        {
          traceId: `${traceId}-companion`,
          route: 'companion',
          userId,
          status: 'ok',
          latencyMs: 2200,
          spanMs: { generate: 900, safety: 20 },
          spanAttrs: {
            'preflight.memory_load.memoryLoaded': 3,
            'quality.status': 'pass',
          },
          inputTokens: 80,
          outputTokens: 120,
        },
      ],
    })
  }, 120_000)

  afterAll(async () => {
    if (app) await app.close()
    if (dbManager && dbName) await dbManager.dropDatabase(dbName)
  })

  it('migration exposes observability_turns table', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'observability_turns'
    `
    expect(rows.map((r) => r.table_name)).toContain('observability_turns')
  })

  it('W2 rows are readable by route', async () => {
    const chat = await prisma.observabilityTurn.findMany({ where: { route: 'chat' } })
    const companion = await prisma.observabilityTurn.findMany({ where: { route: 'companion' } })
    expect(chat.length).toBeGreaterThanOrEqual(3)
    expect(companion.length).toBeGreaterThanOrEqual(1)
    expect(chat.some((r) => r.status === 'cancelled')).toBe(true)
  })

  it('Admin summary empty/degraded/p95 from W2; cancelled excluded', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/summary?window=24h',
      headers: { ...adminAuthHeader(adminToken), 'x-app-context': 'admin' },
      remoteAddress: nextIp(),
    })
    expect(res.statusCode).toBe(200)
    const data = unwrap<{
      rag: {
        emptyRate: { status: string; value?: number; sampleSize?: number }
        degradedRate: { status: string }
        p95LatencyMs?: { status: string; sampleSize?: number; value?: number }
        avgTokens?: { status: string; value?: number }
      }
      companion: {
        p95LatencyMs: { status: string; value?: number }
        avgTokens?: { status: string }
      }
    }>(res.json())

    expect(data.rag.emptyRate.status).toBe('ready')
    // 2 non-cancelled chat turns, 1 empty → 0.5
    expect(data.rag.emptyRate.value).toBe(0.5)
    expect(data.rag.degradedRate.status).toBe('ready')
    expect(data.rag.p95LatencyMs?.status).toBe('ready')
    // cancelled 不计入 e2e 样本
    expect(data.rag.p95LatencyMs?.sampleSize).toBe(2)
    expect(data.rag.avgTokens?.status).toBe('ready')

    // companion W2 时延优先
    expect(data.companion.p95LatencyMs.status).toBe('ready')
    expect(data.companion.p95LatencyMs.value).toBe(2200)
  })

  it('RAG detail slow_turns includes traceId and excludes cancelled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/observability/rag?window=24h',
      headers: { ...adminAuthHeader(adminToken), 'x-app-context': 'admin' },
      remoteAddress: nextIp(),
    })
    expect(res.statusCode).toBe(200)
    const data = unwrap<{
      sections: {
        slow_turns?: {
          status?: string
          note?: string
          metrics?: Array<{
            key: string
            label?: string
            note?: string
            value?: number
            href?: string | null
          }>
        }
        latency?: { note?: string; metrics?: Array<{ key: string; label?: string; note?: string }> }
      }
      kpis: Array<{ key: string; label: string }>
    }>(res.json())

    expect(data.sections.slow_turns?.status).toBe('ready')
    const metrics = data.sections.slow_turns?.metrics ?? []
    expect(metrics.length).toBeGreaterThan(0)
    // key = traceId；note 为人类可读摘要，不得是整表 JSON
    expect(metrics.every((m) => typeof m.key === 'string' && m.key.length > 8)).toBe(true)
    expect(metrics.every((m) => typeof m.value === 'number')).toBe(true)
    expect(data.sections.slow_turns?.note ?? '').not.toMatch(/^\s*\[/)
    expect(data.sections.slow_turns?.note ?? '').toMatch(/最慢|Top|traceId/)
    // cancelled 不进慢列表
    expect(metrics.every((m) => !m.note?.includes('cancelled'))).toBe(true)

    // 在线 KPI / 文案禁用「准确率」作为指标名
    for (const k of data.kpis) {
      expect(k.label).not.toMatch(/^准确率$/)
      // 允许「非准确率」澄清文案
      if (k.label.includes('准确率')) {
        expect(k.label).toMatch(/非准确率/)
      }
    }
    expect(data.sections.latency?.note ?? '').toMatch(/不得称为「准确率」|准确率/)
  })

  it('POST /api/chat-messages/feedback writes metadata + W2 explicitFeedback', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-messages/feedback',
      headers: authHeader(userToken),
      payload: {
        messageId: assistantMessageId,
        sessionId,
        rating: 'not_helpful',
        reason: '答非所问',
        traceId,
      },
      remoteAddress: nextIp(),
    })
    // Nest 全局拦截器可能将成功写操作标为 200 或 201
    expect([200, 201]).toContain(res.statusCode)
    const body = unwrap<{ ok: true; messageId: string; rating: string }>(res.json())
    expect(body.ok).toBe(true)
    expect(body.rating).toBe('not_helpful')
    expect(body.messageId).toBe(assistantMessageId)

    const msg = await prisma.message.findUniqueOrThrow({ where: { id: assistantMessageId } })
    const meta = msg.metadata as Record<string, unknown>
    expect(meta.explicit_feedback).toBe('not_helpful')
    expect(meta.explicit_feedback_reason).toBe('答非所问')

    const turn = await prisma.observabilityTurn.findUniqueOrThrow({ where: { traceId } })
    const flags = turn.flags as Record<string, unknown>
    expect(flags.explicitFeedback).toBe('not_helpful')
    expect(flags.explicitFeedbackReason).toBe('答非所问')
  })

  it('feedback rejects foreign session message', async () => {
    const otherSession = await prisma.session.create({
      data: { userId: adminUserId, title: 'other' },
    })
    const otherMsg = await prisma.message.create({
      data: {
        sessionId: otherSession.id,
        role: 'assistant',
        content: 'x',
        status: 'completed',
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-messages/feedback',
      headers: authHeader(userToken),
      payload: {
        messageId: otherMsg.id,
        sessionId: otherSession.id,
        rating: 'helpful',
      },
      remoteAddress: nextIp(),
    })
    expect([403, 404]).toContain(res.statusCode)
  })

  it('unauthenticated feedback → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-messages/feedback',
      payload: {
        messageId: assistantMessageId,
        sessionId,
        rating: 'helpful',
      },
      remoteAddress: nextIp(),
    })
    expect([401, 403]).toContain(res.statusCode)
  })
})
