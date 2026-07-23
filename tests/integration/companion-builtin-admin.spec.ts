/**
 * companion-builtin-admin 集成测（tasks 6.2 / 6.3）
 *
 * 覆盖：
 * - Web 创建即 published + DTO strip + 越权 403
 * - system 跨用户会话/聊天（mock pipeline）
 * - Admin 内置伴侣 CRUD 与归档
 * - companions 权限码挂载
 * - maxUserCompanions 上限生效
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CompanionChatPipelineService } from '../../packages/server/src/modules/companion/companion-chat-pipeline.service.js'
import type { CompanionState } from '../../packages/server/src/modules/companion/langgraph/interfaces.js'
import { SystemConfigService } from '../../packages/server/src/modules/settings/system-config.service.js'
import { PrismaService } from '../../packages/server/src/processors/database/prisma.service.js'
import { AuthFixtures, adminAuthHeader, authHeader } from './helpers/auth.fixtures.js'
import { TestAppFactory } from './helpers/test-app.factory.js'
import { TestDatabaseManager } from './helpers/test-database.manager.js'
import { createIpGenerator } from './helpers/test-utils.js'

const nextIp = createIpGenerator(43)

function mockFinalPatch(overrides: Partial<CompanionState> = {}): Partial<CompanionState> {
  return {
    safety: {
      safetyLevel: 'safe',
      category: 'normal',
      boundaryAction: 'continue',
      reason: 'ok',
      responseGuidance: '',
      allowMemoryExtraction: true,
    },
    intent: {
      primary: 'casual_chat',
      secondary: [],
      confidence: 0.9,
      userNeed: 'feel_connected',
      requestedAgentAction: 'answer_directly',
      relationshipSignal: 'neutral',
      replyExpectation: {
        depth: 'short',
        warmth: 'medium',
        directness: 'gentle',
        shouldAskQuestion: false,
      },
      shouldClarify: false,
      clarifyingQuestion: null,
      promptGuidance: '',
    },
    emotion: {
      primaryEmotion: 'neutral',
      secondaryEmotions: [],
      intensity: 0.3,
      valence: 'neutral',
      arousal: 'low',
      needsComfort: false,
      needsDeescalation: false,
      needsClarification: false,
      emotionalCue: '',
      replyTone: 'warm',
    },
    relationship: {
      stage: 'new_connection',
      intimacyPermission: 'low',
      trustLevel: 'building',
      boundaryPressure: 'none',
      recommendedDistance: 'friendly',
      notes: '',
    },
    route: {
      route: 'light_companion',
      responseLength: 'short',
      shouldUseMemory: false,
      shouldAskFollowUp: false,
      reason: 'test',
    },
    policy: {
      policy: 'be_warm',
      openingMove: 'greet',
      avoidList: [],
      mustDoList: [],
      lengthHint: 'short',
      questionPolicy: 'optional',
    },
    quality: {
      status: 'pass',
      score: 0.9,
      sentenceCount: 1,
      questionCount: 0,
      adviceCount: 0,
      violations: [],
    },
    assistantReply: '内置伴侣测试回复',
    partialTokens: '内置伴侣测试回复',
    summary: { text: '测试摘要', updatedAt: new Date().toISOString() },
    ...overrides,
  } as Partial<CompanionState>
}

function unwrap<T = Record<string, unknown>>(body: { data?: T } | T): T {
  const b = body as { data?: T }
  return (b.data ?? body) as T
}

describe('Companion builtin admin (integration)', () => {
  let app: NestFastifyApplication
  let dbManager: TestDatabaseManager
  let dbUrl: string
  let dbName: string
  let prisma: PrismaService
  let pipeline: CompanionChatPipelineService
  let systemConfig: SystemConfigService

  let adminToken: string
  let userAToken: string
  let userBToken: string
  let userAId: string
  let userBId: string
  let adminEmail: string
  let userAEmail: string
  let userBEmail: string

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_ADMIN_URL) {
      process.env.TEST_DATABASE_ADMIN_URL =
        process.env.DATABASE_URL?.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1') ||
        'postgresql://gofer:gofer_dev_pass@127.0.0.1:5432/postgres'
    }

    dbManager = new TestDatabaseManager()
    dbUrl = await dbManager.createDatabase('companion_builtin')
    dbName = new URL(dbUrl).pathname.slice(1)
    app = await TestAppFactory.create(dbUrl)
    prisma = app.get(PrismaService)
    pipeline = app.get(CompanionChatPipelineService)
    systemConfig = app.get(SystemConfigService)

    const ts = Date.now()
    adminEmail = `cba-admin-${ts}@test.gofer`
    userAEmail = `cba-user-a-${ts}@test.gofer`
    userBEmail = `cba-user-b-${ts}@test.gofer`

    await AuthFixtures.createUser(
      app,
      { email: adminEmail, password: 'Test1234!', name: 'CBA Admin' },
      { remoteAddress: nextIp() },
    )
    const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } })
    await prisma.userRole.create({
      data: { userId: adminUser!.id, roleCode: 'admin', app: 'admin' },
    })
    adminToken = await AuthFixtures.loginAsAdmin(
      app,
      { email: adminEmail, password: 'Test1234!' },
      { remoteAddress: nextIp() },
    )

    const userA = await AuthFixtures.createUser(
      app,
      { email: userAEmail, password: 'Test1234!', name: 'User A' },
      { remoteAddress: nextIp() },
    )
    userAId = userA.id
    userAToken = await AuthFixtures.loginAsWeb(
      app,
      { email: userAEmail, password: 'Test1234!' },
      { remoteAddress: nextIp() },
    )

    const userB = await AuthFixtures.createUser(
      app,
      { email: userBEmail, password: 'Test1234!', name: 'User B' },
      { remoteAddress: nextIp() },
    )
    userBId = userB.id
    userBToken = await AuthFixtures.loginAsWeb(
      app,
      { email: userBEmail, password: 'Test1234!' },
      { remoteAddress: nextIp() },
    )
  }, 120_000)

  afterAll(async () => {
    vi.restoreAllMocks()
    if (app) await app.close()
    if (dbManager && dbName) await dbManager.dropDatabase(dbName)
  })

  function mockPipelineExecute(patch: Partial<CompanionState> = mockFinalPatch()) {
    return vi.spyOn(pipeline, 'execute').mockImplementation(async function* () {
      yield { patch }
    })
  }

  async function createUserCompanion(
    token: string,
    name: string,
    extra: Record<string, unknown> = {},
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/companions',
      headers: authHeader(token),
      payload: {
        name,
        description: 'IT 简表描述',
        personality: '温和友好',
        openingMessage: '你好，我是测试伴侣。',
        // 应被 strip，不得写库生效
        boundaries: 'SHOULD_NOT_PERSIST',
        guardrailsPrompt: 'SHOULD_NOT_PERSIST',
        defaultPrompt: 'SHOULD_NOT_PERSIST',
        ...extra,
      },
      remoteAddress: nextIp(),
    })
    return res
  }

  async function createSystemCompanion(
    payload: Record<string, unknown> = {},
  ): Promise<{ id: string; status: string; source: string; name: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/companions',
      headers: { ...adminAuthHeader(adminToken), 'x-app-context': 'admin' },
      payload: {
        name: `sys-${Date.now()}`,
        headline: '官方推荐',
        description: '平台内置',
        personality: '沉稳',
        tone: '温和',
        boundaries: '不讨论违法内容',
        guardrailsPrompt: '保持安全边界',
        openingMessage: '你好，我是官方伴侣。',
        status: 'published',
        ...payload,
      },
      remoteAddress: nextIp(),
    })
    expect(res.statusCode, res.body).toBeLessThan(400)
    return unwrap(res.json()) as {
      id: string
      status: string
      source: string
      name: string
    }
  }

  // ── 6.3 权限码挂载 ──────────────────────────────────────────

  describe('IT-PERM: companions permissions seeded', () => {
    it('IT-PERM-codes: companions:read/write exist and mount on admin role', async () => {
      const codes = await prisma.permission.findMany({
        where: { code: { in: ['companions:read', 'companions:write'] } },
        select: { id: true, code: true },
      })
      expect(codes.map((c) => c.code).sort()).toEqual(['companions:read', 'companions:write'])

      const rolePerms = await prisma.rolePermission.findMany({
        where: {
          roleCode: 'admin',
          app: 'admin',
          permissionId: { in: codes.map((c) => c.id) },
        },
      })
      expect(rolePerms).toHaveLength(2)
    })

    it('IT-PERM-web-403: web token cannot access admin companions API', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/companions',
        headers: { ...authHeader(userAToken), 'x-app-context': 'admin' },
        remoteAddress: nextIp(),
      })
      expect([401, 403]).toContain(res.statusCode)
    })
  })

  // ── 6.2 Web 创建 / strip / 越权 ──────────────────────────────

  describe('IT-WEB: user companion create & authz', () => {
    it('IT-WEB-create-published: create returns published user source and strips safety fields', async () => {
      const res = await createUserCompanion(userAToken, `web-pub-${Date.now()}`)
      expect(res.statusCode, res.body).toBeLessThan(400)
      const body = unwrap(res.json()) as Record<string, unknown>

      expect(body.status).toBe('published')
      expect(body.source).toBe('user')
      expect(body.userId).toBe(userAId)
      expect(body).not.toHaveProperty('boundaries')
      expect(body).not.toHaveProperty('guardrailsPrompt')
      expect(body).not.toHaveProperty('defaultPrompt')

      const row = await prisma.companion.findUnique({ where: { id: body.id as string } })
      expect(row).toBeTruthy()
      expect(row!.status).toBe('published')
      expect(row!.source).toBe('user')
      // strip 后不得以客户端注入值落库
      expect(row!.boundaries).not.toBe('SHOULD_NOT_PERSIST')
      expect(row!.guardrailsPrompt).not.toBe('SHOULD_NOT_PERSIST')
      expect(row!.defaultPrompt).not.toBe('SHOULD_NOT_PERSIST')
      expect(row!.defaultPrompt?.length ?? 0).toBeGreaterThan(0)
    })

    it('IT-WEB-forbid: other user cannot read/write/archive owner companion', async () => {
      const createRes = await createUserCompanion(userAToken, `web-own-${Date.now()}`)
      expect(createRes.statusCode, createRes.body).toBeLessThan(400)
      const companion = unwrap(createRes.json()) as { id: string }

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/companions/${companion.id}`,
        headers: authHeader(userBToken),
        remoteAddress: nextIp(),
      })
      expect(getRes.statusCode).toBe(403)

      const putRes = await app.inject({
        method: 'PUT',
        url: `/api/companions/${companion.id}`,
        headers: authHeader(userBToken),
        payload: { name: 'hijack' },
        remoteAddress: nextIp(),
      })
      expect(putRes.statusCode).toBe(403)

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/companions/${companion.id}`,
        headers: authHeader(userBToken),
        remoteAddress: nextIp(),
      })
      expect(delRes.statusCode).toBe(403)

      const still = await prisma.companion.findUnique({ where: { id: companion.id } })
      expect(still?.status).toBe('published')
      expect(still?.name).not.toBe('hijack')
    })

    it('IT-WEB-system-write-403: user cannot update/delete system companion', async () => {
      const sys = await createSystemCompanion({ name: `sys-no-write-${Date.now()}` })

      const putRes = await app.inject({
        method: 'PUT',
        url: `/api/companions/${sys.id}`,
        headers: authHeader(userAToken),
        payload: { name: 'hack-system' },
        remoteAddress: nextIp(),
      })
      expect(putRes.statusCode).toBe(403)

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/companions/${sys.id}`,
        headers: authHeader(userAToken),
        remoteAddress: nextIp(),
      })
      expect(delRes.statusCode).toBe(403)

      const row = await prisma.companion.findUnique({ where: { id: sys.id } })
      expect(row?.status).toBe('published')
      expect(row?.name).toBe(sys.name)
    })

    it('IT-WEB-archive-owner: owner archives via DELETE; archived not in mine tab', async () => {
      const createRes = await createUserCompanion(userAToken, `web-arch-${Date.now()}`)
      const companion = unwrap(createRes.json()) as { id: string }

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/companions/${companion.id}`,
        headers: authHeader(userAToken),
        remoteAddress: nextIp(),
      })
      expect(delRes.statusCode, delRes.body).toBeLessThan(400)

      const row = await prisma.companion.findUnique({ where: { id: companion.id } })
      expect(row?.status).toBe('archived')

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/companions?tab=mine',
        headers: authHeader(userAToken),
        remoteAddress: nextIp(),
      })
      expect(listRes.statusCode).toBe(200)
      const list = unwrap(listRes.json()) as { items: Array<{ id: string }> }
      expect(list.items.some((i) => i.id === companion.id)).toBe(false)
    })
  })

  // ── 6.2 system 跨用户聊天 ───────────────────────────────────

  describe('IT-SYS: system companion cross-user chat', () => {
    it('IT-SYS-chat-both-users: published system allows conversation + chat for A and B', async () => {
      const sys = await createSystemCompanion({ name: `sys-chat-${Date.now()}` })
      const spy = mockPipelineExecute()

      try {
        for (const token of [userAToken, userBToken]) {
          const convRes = await app.inject({
            method: 'POST',
            url: '/api/companion/conversations',
            headers: authHeader(token),
            payload: { companionId: sys.id },
            remoteAddress: nextIp(),
          })
          expect(convRes.statusCode, convRes.body).toBeLessThan(400)
          const conv = unwrap(convRes.json()) as { id: string }

          const chatRes = await app.inject({
            method: 'POST',
            url: '/api/companion/chat',
            headers: {
              ...authHeader(token),
              'content-type': 'application/json',
            },
            payload: {
              conversationId: conv.id,
              content: '你好官方伴侣',
            },
            remoteAddress: nextIp(),
          })
          expect(chatRes.statusCode, chatRes.body).toBeLessThan(400)
        }

        const detailA = await app.inject({
          method: 'GET',
          url: `/api/companions/${sys.id}`,
          headers: authHeader(userAToken),
          remoteAddress: nextIp(),
        })
        expect(detailA.statusCode).toBe(200)
        const dto = unwrap(detailA.json()) as Record<string, unknown>
        expect(dto.source).toBe('system')
        expect(dto).not.toHaveProperty('boundaries')
        expect(dto).not.toHaveProperty('defaultPrompt')
      } finally {
        spy.mockRestore()
      }
    })

    it('IT-SYS-draft-web-403: unpublished system is not readable/chatable on Web', async () => {
      const draft = await createSystemCompanion({
        name: `sys-draft-${Date.now()}`,
        status: 'draft',
      })

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/companions/${draft.id}`,
        headers: authHeader(userAToken),
        remoteAddress: nextIp(),
      })
      expect(getRes.statusCode).toBe(403)

      const convRes = await app.inject({
        method: 'POST',
        url: '/api/companion/conversations',
        headers: authHeader(userAToken),
        payload: { companionId: draft.id },
        remoteAddress: nextIp(),
      })
      expect(convRes.statusCode).toBe(403)

      const official = await app.inject({
        method: 'GET',
        url: '/api/companions?tab=official',
        headers: authHeader(userAToken),
        remoteAddress: nextIp(),
      })
      const list = unwrap(official.json()) as { items: Array<{ id: string }> }
      expect(list.items.some((i) => i.id === draft.id)).toBe(false)
    })
  })

  // ── 6.2 Admin CRUD + 归档 ───────────────────────────────────

  describe('IT-ADMIN: system companion CRUD & archive', () => {
    it('IT-ADMIN-crud-archive: create → update → publish → official list → DELETE archives', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/admin/companions',
        headers: { ...adminAuthHeader(adminToken), 'x-app-context': 'admin' },
        payload: {
          name: `admin-crud-${Date.now()}`,
          description: 'admin 全字段',
          personality: '冷静',
          boundaries: '边界A',
          guardrailsPrompt: '安全词A',
          status: 'draft',
        },
        remoteAddress: nextIp(),
      })
      expect(createRes.statusCode, createRes.body).toBeLessThan(400)
      const created = unwrap(createRes.json()) as {
        id: string
        source: string
        status: string
        boundaries: string
        userId: string | null
      }
      expect(created.source).toBe('system')
      expect(created.status).toBe('draft')
      expect(created.boundaries).toBe('边界A')
      expect(created.userId == null).toBe(true)

      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/admin/companions/${created.id}`,
        headers: { ...adminAuthHeader(adminToken), 'x-app-context': 'admin' },
        payload: {
          name: 'admin-crud-updated',
          boundaries: '边界B',
        },
        remoteAddress: nextIp(),
      })
      expect(updateRes.statusCode, updateRes.body).toBeLessThan(400)
      const updated = unwrap(updateRes.json()) as { name: string; boundaries: string }
      expect(updated.name).toBe('admin-crud-updated')
      expect(updated.boundaries).toBe('边界B')

      const statusRes = await app.inject({
        method: 'PATCH',
        url: `/api/admin/companions/${created.id}/status`,
        headers: { ...adminAuthHeader(adminToken), 'x-app-context': 'admin' },
        payload: { status: 'published' },
        remoteAddress: nextIp(),
      })
      expect(statusRes.statusCode, statusRes.body).toBeLessThan(400)

      const official = await app.inject({
        method: 'GET',
        url: '/api/companions?tab=official',
        headers: authHeader(userAToken),
        remoteAddress: nextIp(),
      })
      expect(official.statusCode).toBe(200)
      const officialList = unwrap(official.json()) as { items: Array<{ id: string }> }
      expect(officialList.items.some((i) => i.id === created.id)).toBe(true)

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/admin/companions/${created.id}`,
        headers: { ...adminAuthHeader(adminToken), 'x-app-context': 'admin' },
        remoteAddress: nextIp(),
      })
      expect(delRes.statusCode, delRes.body).toBeLessThan(400)

      const row = await prisma.companion.findUnique({ where: { id: created.id } })
      expect(row).toBeTruthy()
      expect(row!.status).toBe('archived')
      expect(row!.source).toBe('system')

      const officialAfter = await app.inject({
        method: 'GET',
        url: '/api/companions?tab=official',
        headers: authHeader(userAToken),
        remoteAddress: nextIp(),
      })
      const listAfter = unwrap(officialAfter.json()) as { items: Array<{ id: string }> }
      expect(listAfter.items.some((i) => i.id === created.id)).toBe(false)
    })

    it('IT-ADMIN-list: lists only system companions', async () => {
      await createUserCompanion(userAToken, `noise-user-${Date.now()}`)
      const sys = await createSystemCompanion({ name: `sys-list-${Date.now()}` })

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/companions',
        headers: { ...adminAuthHeader(adminToken), 'x-app-context': 'admin' },
        remoteAddress: nextIp(),
      })
      expect(res.statusCode).toBe(200)
      const body = unwrap(res.json()) as { items: Array<{ id: string; source: string }> }
      expect(body.items.every((i) => i.source === 'system')).toBe(true)
      expect(body.items.some((i) => i.id === sys.id)).toBe(true)
    })
  })

  // ── 6.3 maxUserCompanions ───────────────────────────────────

  describe('IT-LIMIT: maxUserCompanions config', () => {
    it('IT-LIMIT-max: rejects create beyond configured max; archive frees slot', async () => {
      // 使用独立用户，避免与其它用例累计计数互相干扰
      const limitEmail = `cba-limit-${Date.now()}@test.gofer`
      await AuthFixtures.createUser(
        app,
        { email: limitEmail, password: 'Test1234!', name: 'Limit User' },
        { remoteAddress: nextIp() },
      )
      const limitToken = await AuthFixtures.loginAsWeb(
        app,
        { email: limitEmail, password: 'Test1234!' },
        { remoteAddress: nextIp() },
      )

      // 直接走 SystemConfigService：admin 角色 seeder 权限码为 settings:*，
      // 而 system-config 控制器要求 moduleSettings:*（历史不一致），HTTP 路径在 IT 中不可靠
      await systemConfig.saveSystemCategory('companion', { maxUserCompanions: 2 })

      try {
        const c1 = await createUserCompanion(limitToken, `lim-1-${Date.now()}`)
        expect(c1.statusCode, c1.body).toBeLessThan(400)
        const c2 = await createUserCompanion(limitToken, `lim-2-${Date.now()}`)
        expect(c2.statusCode, c2.body).toBeLessThan(400)
        const id2 = (unwrap(c2.json()) as { id: string }).id

        const c3 = await createUserCompanion(limitToken, `lim-3-${Date.now()}`)
        expect(c3.statusCode).toBe(400)
        const errBody = c3.json() as {
          error?: { code?: string; message?: string }
          message?: string
          code?: string
        }
        expect(errBody.error?.code ?? errBody.code).toBe('COMPANION_LIMIT_EXCEEDED')

        const arch = await app.inject({
          method: 'DELETE',
          url: `/api/companions/${id2}`,
          headers: authHeader(limitToken),
          remoteAddress: nextIp(),
        })
        expect(arch.statusCode, arch.body).toBeLessThan(400)

        const c4 = await createUserCompanion(limitToken, `lim-4-${Date.now()}`)
        expect(c4.statusCode, c4.body).toBeLessThan(400)
      } finally {
        await systemConfig.saveSystemCategory('companion', { maxUserCompanions: 10 })
      }
    })
  })

  // ── 列表 tab ────────────────────────────────────────────────

  describe('IT-TAB: official vs mine', () => {
    it('IT-TAB-split: official shows system published; mine shows only current user', async () => {
      const sys = await createSystemCompanion({ name: `tab-sys-${Date.now()}` })
      const mineRes = await createUserCompanion(userAToken, `tab-mine-${Date.now()}`)
      const mine = unwrap(mineRes.json()) as { id: string }
      await createUserCompanion(userBToken, `tab-other-${Date.now()}`)

      const official = await app.inject({
        method: 'GET',
        url: '/api/companions?tab=official',
        headers: authHeader(userAToken),
        remoteAddress: nextIp(),
      })
      const officialList = unwrap(official.json()) as {
        items: Array<{ id: string; source: string }>
      }
      expect(officialList.items.every((i) => i.source === 'system')).toBe(true)
      expect(officialList.items.some((i) => i.id === sys.id)).toBe(true)
      expect(officialList.items.some((i) => i.id === mine.id)).toBe(false)

      const mineListRes = await app.inject({
        method: 'GET',
        url: '/api/companions?tab=mine',
        headers: authHeader(userAToken),
        remoteAddress: nextIp(),
      })
      const mineList = unwrap(mineListRes.json()) as {
        items: Array<{ id: string; source: string; userId: string }>
      }
      expect(mineList.items.every((i) => i.source === 'user')).toBe(true)
      expect(mineList.items.every((i) => i.userId === userAId)).toBe(true)
      expect(mineList.items.some((i) => i.id === mine.id)).toBe(true)
      expect(mineList.items.some((i) => i.id === sys.id)).toBe(false)
    })
  })

  // ── 深度：Admin 权限矩阵 + Web update strip ────────────────

  describe('IT-DEPTH: admin read-only matrix & web update strip', () => {
    it('IT-ADMIN-read-only: companions:read can list, cannot write/archive', async () => {
      // Admin 登录仅允许 role=admin|super_admin；用 admin 角色临时摘掉 write 再测矩阵
      const writePerm = await prisma.permission.findUnique({
        where: { code: 'companions:write' },
      })
      expect(writePerm).toBeTruthy()

      const email = `cba-ro-${Date.now()}@test.gofer`
      await AuthFixtures.createUser(
        app,
        { email, password: 'Test1234!', name: 'RO Admin' },
        { remoteAddress: nextIp() },
      )
      const u = await prisma.user.findUnique({ where: { email } })
      await prisma.userRole.create({
        data: { userId: u!.id, roleCode: 'admin', app: 'admin' },
      })

      // 先用完整 admin 造一条可操作的 system 行，再摘 write
      const existing = await createSystemCompanion({ name: `ro-target-${Date.now()}` })

      await prisma.rolePermission.deleteMany({
        where: {
          roleCode: 'admin',
          app: 'admin',
          permissionId: writePerm!.id,
        },
      })
      // 清权限缓存，避免仍持有 write
      try {
        const { PermissionService } = await import(
          '../../packages/server/src/modules/admin/services/permission.service.js'
        )
        const permSvc = app.get(PermissionService)
        await permSvc.invalidateAllPermissions()
      } catch {
        /* 无 Redis 时忽略 */
      }

      try {
        const roToken = await AuthFixtures.loginAsAdmin(
          app,
          { email, password: 'Test1234!' },
          { remoteAddress: nextIp() },
        )
        const hdr = { ...adminAuthHeader(roToken), 'x-app-context': 'admin' }

        const list = await app.inject({
          method: 'GET',
          url: '/api/admin/companions',
          headers: hdr,
          remoteAddress: nextIp(),
        })
        expect(list.statusCode, list.body).toBe(200)

        const create = await app.inject({
          method: 'POST',
          url: '/api/admin/companions',
          headers: hdr,
          payload: { name: 'should-fail', status: 'draft' },
          remoteAddress: nextIp(),
        })
        expect(create.statusCode).toBe(403)

        const put = await app.inject({
          method: 'PUT',
          url: `/api/admin/companions/${existing.id}`,
          headers: hdr,
          payload: { name: 'hacked' },
          remoteAddress: nextIp(),
        })
        expect(put.statusCode).toBe(403)

        const del = await app.inject({
          method: 'DELETE',
          url: `/api/admin/companions/${existing.id}`,
          headers: hdr,
          remoteAddress: nextIp(),
        })
        expect(del.statusCode).toBe(403)
      } finally {
        await prisma.rolePermission.create({
          data: {
            roleCode: 'admin',
            permissionId: writePerm!.id,
            app: 'admin',
          },
        })
        try {
          const { PermissionService } = await import(
            '../../packages/server/src/modules/admin/services/permission.service.js'
          )
          await app.get(PermissionService).invalidateAllPermissions()
        } catch {
          /* ignore */
        }
      }
    })

    it('IT-WEB-update-strip: owner update cannot inject safety fields or source', async () => {
      const createRes = await createUserCompanion(userAToken, `upd-strip-${Date.now()}`)
      expect(createRes.statusCode, createRes.body).toBeLessThan(400)
      const created = unwrap(createRes.json()) as { id: string; name: string }
      const before = await prisma.companion.findUnique({ where: { id: created.id } })
      expect(before).toBeTruthy()

      const putRes = await app.inject({
        method: 'PUT',
        url: `/api/companions/${created.id}`,
        headers: authHeader(userAToken),
        payload: {
          name: `${created.name}-v2`,
          description: 'updated desc',
          personality: '更沉稳',
          boundaries: 'INJECT_BOUNDARIES',
          guardrailsPrompt: 'INJECT_GUARD',
          defaultPrompt: 'INJECT_PROMPT',
          source: 'system',
          status: 'draft',
        },
        remoteAddress: nextIp(),
      })
      expect(putRes.statusCode, putRes.body).toBeLessThan(400)
      const dto = unwrap(putRes.json()) as Record<string, unknown>
      expect(dto.name).toBe(`${created.name}-v2`)
      expect(dto).not.toHaveProperty('boundaries')
      expect(dto.source).toBe('user')
      // Web create 后为 published；update 不得用 payload 降级/改写为 draft
      expect(dto.status).toBe('published')

      const row = await prisma.companion.findUnique({ where: { id: created.id } })
      expect(row!.source).toBe('user')
      expect(row!.status).toBe('published')
      expect(row!.boundaries).not.toBe('INJECT_BOUNDARIES')
      expect(row!.guardrailsPrompt).not.toBe('INJECT_GUARD')
      expect(row!.defaultPrompt).not.toBe('INJECT_PROMPT')
      expect(row!.name).toBe(`${created.name}-v2`)
    })

    it('IT-SYS-archived-not-official: archived system disappears from official tab', async () => {
      const sys = await createSystemCompanion({ name: `arch-off-${Date.now()}` })
      await app.inject({
        method: 'DELETE',
        url: `/api/admin/companions/${sys.id}`,
        headers: { ...adminAuthHeader(adminToken), 'x-app-context': 'admin' },
        remoteAddress: nextIp(),
      })

      const official = await app.inject({
        method: 'GET',
        url: '/api/companions?tab=official',
        headers: authHeader(userAToken),
        remoteAddress: nextIp(),
      })
      const list = unwrap(official.json()) as { items: Array<{ id: string }> }
      expect(list.items.some((i) => i.id === sys.id)).toBe(false)
    })
  })

  // 引用 userBId 避免 unused 警告（越权用例已用 token；此处断言 id 存在）
  it('fixture users exist', () => {
    expect(userAId).toBeTruthy()
    expect(userBId).toBeTruthy()
  })
})
