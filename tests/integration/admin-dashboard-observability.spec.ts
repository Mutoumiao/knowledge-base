/**
 * Admin Dashboard / Observability 集成测试
 *
 * 覆盖：
 * - GET /api/admin/dashboard/summary（dashboard:read）形状与口径
 * - GET /api/admin/observability/rag|companion（system:metrics）
 * - 无 system:metrics 时 observability → 403；仍可读 summary
 * - 未登录 → 401
 * - companion_obs_events 表存在（迁移）
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  dashboardSummarySchema,
  observabilityDetailSchema,
} from '../../packages/data/src/schemas/dashboard.schema.js'
import { PrismaService } from '../../packages/server/src/processors/database/prisma.service.js'
import { AuthFixtures, adminAuthHeader } from './helpers/auth.fixtures.js'
import { TestAppFactory } from './helpers/test-app.factory.js'
import { TestDatabaseManager } from './helpers/test-database.manager.js'
import { createIpGenerator } from './helpers/test-utils.js'

const nextIp = createIpGenerator(61)

function unwrap<T = Record<string, unknown>>(body: { data?: T } | T): T {
  const b = body as { data?: T }
  return (b.data ?? body) as T
}

const KPI_STATUSES = new Set([
  'ready',
  'pending_instrumentation',
  'insufficient_samples',
])

function expectKpiShape(kpi: { status?: string; value?: number }) {
  expect(KPI_STATUSES.has(kpi.status ?? '')).toBe(true)
  if (kpi.status === 'ready') {
    expect(typeof kpi.value === 'number' || kpi.value === undefined).toBe(true)
  }
}

describe('Admin Dashboard Observability (integration)', () => {
  let app: NestFastifyApplication
  let dbManager: TestDatabaseManager
  let dbUrl: string
  let dbName: string
  let prisma: PrismaService

  let fullAdminToken: string
  let dashOnlyToken: string
  let adminUserId: string

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_ADMIN_URL) {
      process.env.TEST_DATABASE_ADMIN_URL =
        process.env.DATABASE_URL?.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1') ||
        'postgresql://gofer:gofer_dev_pass@127.0.0.1:5432/postgres'
    }

    dbManager = new TestDatabaseManager()
    dbUrl = await dbManager.createDatabase('dash_obs')
    dbName = new URL(dbUrl).pathname.slice(1)
    app = await TestAppFactory.create(dbUrl)
    prisma = app.get(PrismaService)

    const ts = Date.now()
    const fullEmail = `dash-full-${ts}@test.gofer`
    const limitedEmail = `dash-limited-${ts}@test.gofer`

    // 完整权限：super_admin（登录门闸 + 全量权限）
    await AuthFixtures.createUser(
      app,
      { email: fullEmail, password: 'Test1234!', name: 'Dash Full' },
      { remoteAddress: nextIp() },
    )
    const fullUser = await prisma.user.findUniqueOrThrow({ where: { email: fullEmail } })
    adminUserId = fullUser.id
    await prisma.userRole.create({
      data: { userId: fullUser.id, roleCode: 'super_admin', app: 'admin' },
    })
    fullAdminToken = await AuthFixtures.loginAsAdmin(
      app,
      { email: fullEmail, password: 'Test1234!' },
      { remoteAddress: nextIp() },
    )

    // 有限权限：须带 admin 角色码才能登录；将 admin 角色权限裁成仅 dashboard:read
    // （super_admin 不受影响，仍走 isSuperAdmin 全放行）
    const dashPerm = await prisma.permission.findUniqueOrThrow({
      where: { code: 'dashboard:read' },
    })
    await prisma.rolePermission.deleteMany({
      where: { roleCode: 'admin', app: 'admin' },
    })
    await prisma.rolePermission.create({
      data: {
        roleCode: 'admin',
        permissionId: dashPerm.id,
        app: 'admin',
      },
    })

    await AuthFixtures.createUser(
      app,
      { email: limitedEmail, password: 'Test1234!', name: 'Dash Limited' },
      { remoteAddress: nextIp() },
    )
    const limitedUser = await prisma.user.findUniqueOrThrow({ where: { email: limitedEmail } })
    await prisma.userRole.create({
      data: { userId: limitedUser.id, roleCode: 'admin', app: 'admin' },
    })
    dashOnlyToken = await AuthFixtures.loginAsAdmin(
      app,
      { email: limitedEmail, password: 'Test1234!' },
      { remoteAddress: nextIp() },
    )

    // 埋点样本：索引失败 + Chat metadata + Companion latency/quality + 硬中断事件 + 负反馈
    const kb = await prisma.knowledgeBase.create({
      data: { name: 'obs-kb', userId: adminUserId },
    })
    await prisma.document.create({
      data: {
        kbId: kb.id,
        name: 'failed.pdf',
        storageKey: 'mock/failed.pdf',
        status: 'failed',
      },
    })

    const session = await prisma.session.create({
      data: { userId: adminUserId, title: 'obs-session' },
    })
    await prisma.message.createMany({
      data: [
        {
          sessionId: session.id,
          role: 'assistant',
          content: 'a',
          status: 'completed',
          metadata: { retrieval_empty: true, degraded: false },
        },
        {
          sessionId: session.id,
          role: 'assistant',
          content: 'b',
          status: 'completed',
          metadata: { retrieval_empty: false, degraded: true },
        },
      ],
    })

    // W2 为 turn 级 empty/degraded 真源（不混扫 message.metadata）
    await prisma.observabilityTurn.createMany({
      data: [
        {
          traceId: `w2-empty-${ts}`,
          route: 'chat',
          userId: adminUserId,
          sessionId: session.id,
          status: 'ok',
          latencyMs: 800,
          flags: { retrievalEmpty: true, contractSuccess: false },
          spanMs: { 'knowledge.ai': 600 },
        },
        {
          traceId: `w2-degraded-${ts}`,
          route: 'chat',
          userId: adminUserId,
          sessionId: session.id,
          status: 'ok',
          latencyMs: 1200,
          flags: { degraded: true, contractSuccess: true },
          spanMs: { 'knowledge.ai': 900 },
        },
        {
          traceId: `w2-cancelled-${ts}`,
          route: 'chat',
          userId: adminUserId,
          sessionId: session.id,
          status: 'cancelled',
          latencyMs: 99999,
          flags: {},
        },
      ],
    })

    const companion = await prisma.companion.create({
      data: {
        userId: adminUserId,
        name: 'obs-companion',
        status: 'published',
        source: 'user',
      },
    })
    const conversation = await prisma.companionConversation.create({
      data: {
        userId: adminUserId,
        companionId: companion.id,
        title: 'obs-conv',
      },
    })
    await prisma.companionMessage.create({
      data: {
        conversationId: conversation.id,
        userId: adminUserId,
        companionId: companion.id,
        role: 'user',
        content: 'hello',
      },
    })
    const assistantMsg = await prisma.companionMessage.create({
      data: {
        conversationId: conversation.id,
        userId: adminUserId,
        companionId: companion.id,
        role: 'assistant',
        content: 'hi',
        metadata: JSON.stringify({
          quality: { status: 'pass' },
          latencyMs: 1500,
          emotion: { primaryEmotion: 'calm' },
        }),
      },
    })
    await prisma.companionMessageFeedback.create({
      data: {
        userId: adminUserId,
        companionId: companion.id,
        conversationId: conversation.id,
        messageId: assistantMsg.id,
        rating: 'negative',
      },
    })
    await prisma.companionObsEvent.create({
      data: {
        type: 'safety_hard_stop',
        companionId: companion.id,
        conversationId: conversation.id,
        userId: adminUserId,
        boundaryAction: 'refuse',
        reason: 'test',
      },
    })
  }, 120_000)

  afterAll(async () => {
    if (app) await app.close()
    if (dbManager && dbName) await dbManager.dropDatabase(dbName)
  })

  it('migration exposes companion_obs_events table', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'companion_obs_events'
    `
    expect(rows.map((r) => r.table_name)).toContain('companion_obs_events')
  })

  it('GET /api/admin/dashboard/summary returns 200 + contract shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/summary?window=24h',
      headers: { ...adminAuthHeader(fullAdminToken), 'x-app-context': 'admin' },
      remoteAddress: nextIp(),
    })
    expect(res.statusCode).toBe(200)
    const data = unwrap(res.json())
    const parsed = dashboardSummarySchema.safeParse(data)
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true)

    expect(data.window).toBe('24h')
    expect(data.health?.components?.length).toBeGreaterThan(0)
    expect(data.inventory?.userCount).toBeGreaterThanOrEqual(2)
    expect(data.rag?.indexFailureCount).toMatchObject({ status: 'ready', value: 1 })
    expectKpiShape(data.rag.emptyRate)
    expectKpiShape(data.rag.degradedRate)
    expectKpiShape(data.companion.p95LatencyMs)
    expectKpiShape(data.companion.safetyHardStopRate)
    // 埋点样本就绪
    expect(data.rag.emptyRate.status).toBe('ready')
    expect(data.rag.degradedRate.status).toBe('ready')
    expect(data.companion.p95LatencyMs.status).toBe('ready')
    expect(data.companion.safetyHardStopRate.status).toBe('ready')
    expect(data.companion.negativeFeedbackRate.status).toBe('ready')
    expect(data.companion.negativeFeedbackRate.value).toBe(1)
  })

  it('summary rejects unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/summary',
      headers: { 'x-app-context': 'admin' },
      remoteAddress: nextIp(),
    })
    expect([401, 403]).toContain(res.statusCode)
  })

  it('observability detail requires system:metrics (403 without it)', async () => {
    for (const path of ['/api/admin/observability/rag', '/api/admin/observability/companion']) {
      const res = await app.inject({
        method: 'GET',
        url: `${path}?window=24h`,
        headers: { ...adminAuthHeader(dashOnlyToken), 'x-app-context': 'admin' },
        remoteAddress: nextIp(),
      })
      expect(res.statusCode, path).toBe(403)
    }

    // 仅 dashboard:read 仍可读 summary
    const summary = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/summary?window=1h',
      headers: { ...adminAuthHeader(dashOnlyToken), 'x-app-context': 'admin' },
      remoteAddress: nextIp(),
    })
    expect(summary.statusCode).toBe(200)
  })

  it('GET observability/rag returns sections index/retrieve/quality_deps', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/observability/rag?window=24h',
      headers: { ...adminAuthHeader(fullAdminToken), 'x-app-context': 'admin' },
      remoteAddress: nextIp(),
    })
    expect(res.statusCode).toBe(200)
    const data = unwrap(res.json())
    const parsed = observabilityDetailSchema.safeParse(data)
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true)
    expect(data.sections.index).toBeDefined()
    expect(data.sections.retrieve).toBeDefined()
    expect(data.sections.quality_deps).toBeDefined()
    expect(data.kpis.length).toBeGreaterThanOrEqual(3)
  })

  it('GET observability/companion keeps retrieval pending and exposes cost_safety', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/observability/companion?window=7d',
      headers: { ...adminAuthHeader(fullAdminToken), 'x-app-context': 'admin' },
      remoteAddress: nextIp(),
    })
    expect(res.statusCode).toBe(200)
    const data = unwrap(res.json())
    expect(data.window).toBe('7d')
    const parsed = observabilityDetailSchema.safeParse(data)
    expect(parsed.success).toBe(true)
    expect(data.sections.retrieval?.status).toBe('pending_instrumentation')
    expect(data.sections.latency).toBeDefined()
    expect(data.sections.emotion).toBeDefined()
    expect(data.sections.cost_safety).toBeDefined()
    expect(
      data.sections.cost_safety.metrics.some((m: { key: string }) => m.key === 'safety_hard_stop_rate'),
    ).toBe(true)
  })
})
