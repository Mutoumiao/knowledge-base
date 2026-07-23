/**
 * Companion parity 集成测（gap-matrix IT-*）
 * 不依赖真实 LLM：mock pipeline.execute 产出完整 final state。
 *
 * 覆盖：feedback 注入/历史/API、metadata 落库、status 门闸、quality 观察式继续、
 * care plan/generate、memory list/write/forbidden、CTX/REL 窗口与 messageCount。
 */

import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CompanionChatPipelineService } from '../../packages/server/src/modules/companion/companion-chat-pipeline.service.js'
import { RECENT_MESSAGE_LIMIT } from '../../packages/server/src/modules/companion/langchain/constants.js'
import type { CompanionState } from '../../packages/server/src/modules/companion/langgraph/interfaces.js'
import { resolveRelationshipMessageCount } from '../../packages/server/src/modules/companion/langgraph/nodes/relationship-stage-node.js'
import { PrismaService } from '../../packages/server/src/processors/database/prisma.service.js'
import { AuthFixtures, authHeader } from './helpers/auth.fixtures.js'
import { TestAppFactory } from './helpers/test-app.factory.js'
import { TestDatabaseManager } from './helpers/test-database.manager.js'
import { createIpGenerator } from './helpers/test-utils.js'

const nextIp = createIpGenerator(42)

/** 满足 assertFinalState 的最小图 patch */
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
    assistantReply: '这是测试助手回复',
    partialTokens: '这是测试助手回复',
    summary: { text: '测试摘要', updatedAt: new Date().toISOString() },
    ...overrides,
  } as Partial<CompanionState>
}

describe('Companion pipeline parity (integration)', () => {
  let app: NestFastifyApplication
  let dbManager: TestDatabaseManager
  let dbUrl: string
  let dbName: string
  let token: string
  let userId: string
  let userEmail: string
  let prisma: PrismaService
  let pipeline: CompanionChatPipelineService

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_ADMIN_URL) {
      process.env.TEST_DATABASE_ADMIN_URL =
        process.env.DATABASE_URL?.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1') ||
        'postgresql://gofer:gofer_dev_pass@127.0.0.1:5432/postgres'
    }

    dbManager = new TestDatabaseManager()
    dbUrl = await dbManager.createDatabase('companion_parity')
    dbName = new URL(dbUrl).pathname.slice(1)
    app = await TestAppFactory.create(dbUrl)
    prisma = app.get(PrismaService)
    pipeline = app.get(CompanionChatPipelineService)

    userEmail = `companion-parity-${Date.now()}@test.gofer`
    const user = await AuthFixtures.createUser(
      app,
      { email: userEmail, password: 'Test1234!', name: 'Companion Parity' },
      { remoteAddress: nextIp() },
    )
    userId = user.id
    token = await AuthFixtures.loginAs(
      app,
      { email: userEmail, password: 'Test1234!' },
      { remoteAddress: nextIp() },
    )
  }, 120_000)

  afterAll(async () => {
    vi.restoreAllMocks()
    if (app) await app.close()
    if (dbManager && dbName) await dbManager.dropDatabase(dbName)
  })

  async function createCompanion(name = `c-${Date.now()}`) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/companions',
      headers: authHeader(token),
      payload: {
        name,
        description: 'IT companion description',
        openingMessage: '你好，我是集成测试伴侣。',
        personality: '温和',
      },
      remoteAddress: nextIp(),
    })
    expect(res.statusCode, res.body).toBeLessThan(400)
    const body = res.json()
    return (body.data ?? body) as { id: string; status: string; name: string }
  }

  async function createConversation(companionId: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/companion/conversations',
      headers: authHeader(token),
      payload: { companionId },
      remoteAddress: nextIp(),
    })
    expect(res.statusCode, res.body).toBeLessThan(400)
    const body = res.json()
    return (body.data ?? body) as { id: string; companionId: string }
  }

  async function insertAssistantMessage(
    conversationId: string,
    companionId: string,
    content: string,
    metadata?: string,
  ) {
    return prisma.companionMessage.create({
      data: {
        conversationId,
        userId,
        companionId,
        role: 'assistant',
        content,
        metadata: metadata ?? null,
      },
    })
  }

  function mockPipelineExecute(patch: Partial<CompanionState>) {
    return vi.spyOn(pipeline, 'execute').mockImplementation(async function* () {
      yield { patch }
    })
  }

  async function waitForAssistantPersist(conversationId: string, minCount = 1) {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const count = await prisma.companionMessage.count({
        where: { conversationId, role: 'assistant' },
      })
      if (count >= minCount) return
      await new Promise((r) => setTimeout(r, 30))
    }
    throw new Error(`waitForAssistantPersist timeout conversationId=${conversationId}`)
  }

  describe('IT-FB: feedback injection', () => {
    it('IT-FB-inject: prepareContext loads feedbacks into state (not empty array)', async () => {
      const companion = await createCompanion('fb-inject')
      const conv = await createConversation(companion.id)
      const msg = await insertAssistantMessage(conv.id, companion.id, '旧回复')
      await prisma.companionMessageFeedback.create({
        data: {
          userId,
          companionId: companion.id,
          conversationId: conv.id,
          messageId: msg.id,
          rating: 'positive',
          reason: 'helpful',
        },
      })

      const turnContent = '本轮用户正文不得进入 recentMessages'
      const { initialState } = await pipeline.prepareContext({
        userId,
        companionId: companion.id,
        conversationId: conv.id,
        message: turnContent,
      })

      expect(initialState.feedbacks).toBeDefined()
      expect(Array.isArray(initialState.feedbacks)).toBe(true)
      expect(initialState.feedbacks!.length).toBeGreaterThanOrEqual(1)
      expect(initialState.feedbacks!.some((f) => f.rating === 'positive')).toBe(true)

      // 不变量：先 load 再 save；本轮只在 userMessage，不得重复进入 recentMessages
      expect(initialState.userMessage).toBe(turnContent)
      expect(initialState.recentMessages?.some((m) => m.content === turnContent)).toBe(false)
      const userCount = await prisma.companionMessage.count({
        where: { conversationId: conv.id, role: 'user', content: turnContent },
      })
      expect(userCount).toBe(1)
    })

    it('IT-FB-history: list messages includes feedback for rated assistant messages', async () => {
      const companion = await createCompanion('fb-history')
      const conv = await createConversation(companion.id)
      const msg = await insertAssistantMessage(conv.id, companion.id, '可评价回复')
      await app.inject({
        method: 'POST',
        url: `/api/companion/messages/${msg.id}/feedback`,
        headers: authHeader(token),
        payload: { rating: 'negative', reason: 'off-topic' },
        remoteAddress: nextIp(),
      })

      const res = await app.inject({
        method: 'GET',
        url: `/api/companion/conversations/${conv.id}/messages`,
        headers: authHeader(token),
        remoteAddress: nextIp(),
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      const items = (body.data?.items ?? body.items) as Array<{
        id: string
        feedback: { rating: string; reason?: string } | null
      }>
      const hit = items.find((m) => m.id === msg.id)
      expect(hit?.feedback?.rating).toBe('negative')
      expect(hit?.feedback?.reason).toBe('off-topic')
    })

    it('IT-FB-api: POST /companion/messages/:id/feedback accepts positive|negative', async () => {
      const companion = await createCompanion('fb-api')
      const conv = await createConversation(companion.id)
      const msg = await insertAssistantMessage(conv.id, companion.id, '反馈目标')

      const pos = await app.inject({
        method: 'POST',
        url: `/api/companion/messages/${msg.id}/feedback`,
        headers: authHeader(token),
        payload: { rating: 'positive' },
        remoteAddress: nextIp(),
      })
      expect(pos.statusCode).toBeLessThan(400)
      const posBody = pos.json()
      expect((posBody.data ?? posBody).rating).toBe('positive')

      const neg = await app.inject({
        method: 'POST',
        url: `/api/companion/messages/${msg.id}/feedback`,
        headers: authHeader(token),
        payload: { rating: 'negative', note: 'too long' },
        remoteAddress: nextIp(),
      })
      expect(neg.statusCode).toBeLessThan(400)
      expect((neg.json().data ?? neg.json()).rating).toBe('negative')

      const bad = await app.inject({
        method: 'POST',
        url: `/api/companion/messages/${msg.id}/feedback`,
        headers: authHeader(token),
        payload: { rating: 'up' },
        remoteAddress: nextIp(),
      })
      expect(bad.statusCode).toBe(400)
    })
  })

  describe('IT-MD: assistant metadata persist', () => {
    it('IT-MD-persist: assistant message saved with quality (+ analysis summary) metadata', async () => {
      const companion = await createCompanion('md-persist')
      const conv = await createConversation(companion.id)
      const spy = mockPipelineExecute(
        mockFinalPatch({
          quality: {
            status: 'pass',
            score: 0.88,
            sentenceCount: 2,
            questionCount: 0,
            adviceCount: 0,
            violations: [],
          },
          assistantReply: 'metadata 快照测试回复',
          partialTokens: 'metadata 快照测试回复',
          summary: { text: '一段会话摘要', updatedAt: new Date().toISOString() },
        }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/api/companion/chat',
        headers: { ...authHeader(token), 'content-type': 'application/json' },
        payload: { conversationId: conv.id, content: '你好' },
        remoteAddress: nextIp(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/event-stream|json/)
      expect(res.payload).toMatch(/metadata 快照测试回复|done/)

      await waitForAssistantPersist(conv.id, 1)
      const saved = await prisma.companionMessage.findFirst({
        where: { conversationId: conv.id, role: 'assistant' },
        orderBy: { createdAt: 'desc' },
      })
      expect(saved).toBeTruthy()
      expect(saved!.content).toContain('metadata 快照测试回复')
      expect(saved!.metadata).toBeTruthy()
      const meta = JSON.parse(saved!.metadata!) as {
        quality?: { status: string; score: number }
        summaryText?: string
      }
      expect(meta.quality?.status).toBe('pass')
      expect(meta.quality?.score).toBe(0.88)
      expect(meta.summaryText).toContain('会话摘要')
      expect(JSON.stringify(meta)).not.toContain('systemPrompt')

      const convRow = await prisma.companionConversation.findUnique({ where: { id: conv.id } })
      expect(convRow?.summary).toContain('会话摘要')

      spy.mockRestore()
    })

    it('IT-MD-user-persist: chat persists user + assistant and bumps messageCount', async () => {
      const companion = await createCompanion('md-user-persist')
      const conv = await createConversation(companion.id)
      const before = await prisma.companionConversation.findUnique({ where: { id: conv.id } })
      expect(before?.messageCount ?? 0).toBe(0)

      const spy = mockPipelineExecute(
        mockFinalPatch({
          assistantReply: '用户消息落库验收回复',
          partialTokens: '用户消息落库验收回复',
        }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/api/companion/chat',
        headers: { ...authHeader(token), 'content-type': 'application/json' },
        payload: { conversationId: conv.id, content: '用户侧必须入库的一句话' },
        remoteAddress: nextIp(),
      })
      expect(res.statusCode).toBe(200)

      await waitForAssistantPersist(conv.id, 1)

      const userMsgs = await prisma.companionMessage.findMany({
        where: { conversationId: conv.id, role: 'user' },
      })
      expect(userMsgs.length).toBe(1)
      expect(userMsgs[0]!.content).toBe('用户侧必须入库的一句话')

      const assistantMsgs = await prisma.companionMessage.findMany({
        where: { conversationId: conv.id, role: 'assistant' },
      })
      expect(assistantMsgs.length).toBe(1)
      expect(assistantMsgs[0]!.content).toContain('用户消息落库验收回复')

      const after = await prisma.companionConversation.findUnique({ where: { id: conv.id } })
      // 用户 1 + 助手 1
      expect(after?.messageCount).toBe(2)
      expect(after?.lastMessageAtMs).toBeTruthy()

      // 聊天路径必须刷新伴侣列表预览字段（此前仅 care generate 会写）
      const companionRow = await prisma.companion.findUnique({ where: { id: companion.id } })
      expect(companionRow?.lastAssistantMessage).toContain('用户消息落库验收回复')
      expect(companionRow?.lastAssistantMessageAtMs).toBeTruthy()

      spy.mockRestore()
    })
  })

  describe('IT-CTX: recent message window', () => {
    it('IT-CTX-recent-limit: prepareContext loads newest N messages (not oldest)', async () => {
      const companion = await createCompanion('ctx-recent')
      const conv = await createConversation(companion.id)
      const total = RECENT_MESSAGE_LIMIT + 5
      const base = Date.now() - total * 1000

      // 显式 createdAt：最旧 msg-0 … 最新 msg-(total-1)
      for (let i = 0; i < total; i++) {
        await prisma.companionMessage.create({
          data: {
            conversationId: conv.id,
            userId,
            companionId: companion.id,
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `msg-${i}`,
            createdAt: new Date(base + i * 1000),
          },
        })
      }

      const { initialState } = await pipeline.prepareContext({
        userId,
        companionId: companion.id,
        conversationId: conv.id,
        message: '本轮不进 recent',
      })

      const recent = initialState.recentMessages ?? []
      expect(recent.length).toBe(RECENT_MESSAGE_LIMIT)
      // 应为最新窗口：msg-5 … msg-22（当 limit=18, total=23）
      const oldestKept = total - RECENT_MESSAGE_LIMIT
      expect(recent[0]?.content).toBe(`msg-${oldestKept}`)
      expect(recent[recent.length - 1]?.content).toBe(`msg-${total - 1}`)
      expect(recent.some((m) => m.content === 'msg-0')).toBe(false)
      expect(recent.some((m) => m.content === `msg-${total - 1}`)).toBe(true)
      // 正序
      const times = recent.map((m) => new Date(m.createdAt as Date).getTime())
      for (let i = 1; i < times.length; i++) {
        expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!)
      }
    })

    it('IT-REL-message-count: prepareContext.messageCount is conversation total, not recent window', async () => {
      const companion = await createCompanion('rel-msg-count')
      const conv = await createConversation(companion.id)
      const seeded = RECENT_MESSAGE_LIMIT + 5

      for (let i = 0; i < seeded; i++) {
        await prisma.companionMessage.create({
          data: {
            conversationId: conv.id,
            userId,
            companionId: companion.id,
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `rel-seed-${i}`,
          },
        })
      }
      // 与生产管线一致：直接插库时需同步 messageCount（生产路径走 increment）
      await prisma.companionConversation.update({
        where: { id: conv.id },
        data: { messageCount: seeded },
      })

      const { initialState } = await pipeline.prepareContext({
        userId,
        companionId: companion.id,
        conversationId: conv.id,
        message: '本轮关系计数用累计',
      })

      expect(initialState.recentMessages?.length).toBe(RECENT_MESSAGE_LIMIT)
      // 含本轮已落库用户消息
      expect(initialState.messageCount).toBe(seeded + 1)
      expect(initialState.messageCount).toBeGreaterThan(RECENT_MESSAGE_LIMIT)
      // 回归：不得用 recent 长度冒充累计
      expect(initialState.messageCount).not.toBe(initialState.recentMessages?.length)
      // 闭环：节点 resolver 与 prepareContext 注入一致（防只改一边）
      expect(resolveRelationshipMessageCount(initialState)).toBe(seeded + 1)
    })
  })

  describe('IT-ST: companion status gate', () => {
    it('IT-ST-draft-ok: draft companion owner can stream chat', async () => {
      // Web 创建固定 published；draft 由状态接口进入，仍允许 owner 调试聊天
      const companion = await createCompanion('st-draft')
      const draftRes = await app.inject({
        method: 'PATCH',
        url: `/api/companions/${companion.id}/status`,
        headers: authHeader(token),
        payload: { status: 'draft' },
        remoteAddress: nextIp(),
      })
      expect(draftRes.statusCode, draftRes.body).toBeLessThan(400)
      const draftBody = (draftRes.json().data ?? draftRes.json()) as { status: string }
      expect(draftBody.status).toBe('draft')
      const conv = await createConversation(companion.id)
      const spy = mockPipelineExecute(
        mockFinalPatch({ assistantReply: '草稿可聊', partialTokens: '草稿可聊' }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/api/companion/chat',
        headers: { ...authHeader(token), 'content-type': 'application/json' },
        payload: { conversationId: conv.id, content: 'hi draft' },
        remoteAddress: nextIp(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.payload).toContain('草稿可聊')
      spy.mockRestore()
    })

    it('IT-ST-archived-403: archived companion rejects new chat', async () => {
      const companion = await createCompanion('st-archived')
      const conv = await createConversation(companion.id)
      const countBefore = await prisma.companionMessage.count({
        where: { conversationId: conv.id },
      })
      const convBefore = await prisma.companionConversation.findUnique({ where: { id: conv.id } })

      const statusRes = await app.inject({
        method: 'PATCH',
        url: `/api/companions/${companion.id}/status`,
        headers: authHeader(token),
        payload: { status: 'archived' },
        remoteAddress: nextIp(),
      })
      expect(statusRes.statusCode).toBeLessThan(400)

      const res = await app.inject({
        method: 'POST',
        url: '/api/companion/chat',
        headers: { ...authHeader(token), 'content-type': 'application/json' },
        payload: { conversationId: conv.id, content: 'should fail' },
        remoteAddress: nextIp(),
      })
      // 实现为 SSE error 事件（非 HTTP 403），code=ERR_COMPANION_ARCHIVED
      expect(res.statusCode).toBe(200)
      expect(res.payload).toMatch(/ERR_COMPANION_ARCHIVED|已归档/)

      // 门闸在用户落库前：不得脏写消息或 messageCount
      const userCount = await prisma.companionMessage.count({
        where: { conversationId: conv.id, role: 'user' },
      })
      expect(userCount).toBe(0)
      const countAfter = await prisma.companionMessage.count({
        where: { conversationId: conv.id },
      })
      expect(countAfter).toBe(countBefore)
      const convAfter = await prisma.companionConversation.findUnique({ where: { id: conv.id } })
      expect(convAfter?.messageCount ?? 0).toBe(convBefore?.messageCount ?? 0)
    })
  })

  describe('IT-QL: quality fail observational', () => {
    it('IT-QL-persist: quality fail still persists assistant reply and runs summary path', async () => {
      const companion = await createCompanion('ql-fail')
      const conv = await createConversation(companion.id)
      const spy = mockPipelineExecute(
        mockFinalPatch({
          quality: {
            status: 'fail',
            score: 0.35,
            sentenceCount: 1,
            questionCount: 0,
            adviceCount: 0,
            violations: [
              {
                code: 'breaks_immersion',
                severity: 'high',
                evidence: '作为一个AI',
              },
            ],
          },
          assistantReply: '即便质量失败也会落库的回复',
          partialTokens: '即便质量失败也会落库的回复',
          summary: { text: 'quality-fail 摘要', updatedAt: new Date().toISOString() },
        }),
      )

      const res = await app.inject({
        method: 'POST',
        url: '/api/companion/chat',
        headers: { ...authHeader(token), 'content-type': 'application/json' },
        payload: { conversationId: conv.id, content: 'test quality fail' },
        remoteAddress: nextIp(),
      })
      expect(res.statusCode).toBe(200)
      // done 事件携带 quality fail，不中断
      expect(res.payload).toContain('即便质量失败也会落库的回复')
      expect(res.payload).toMatch(/"status"\s*:\s*"fail"|fail/)

      await waitForAssistantPersist(conv.id, 1)
      const saved = await prisma.companionMessage.findFirst({
        where: { conversationId: conv.id, role: 'assistant', content: { contains: '质量失败' } },
      })
      expect(saved).toBeTruthy()
      const meta = JSON.parse(saved!.metadata!) as { quality: { status: string } }
      expect(meta.quality.status).toBe('fail')

      const convRow = await prisma.companionConversation.findUnique({ where: { id: conv.id } })
      expect(convRow?.summary).toContain('quality-fail')

      spy.mockRestore()
    })
  })

  describe('IT-CA: care plan / generate', () => {
    it('IT-CA-get-default: GET care-plan without row returns defaults and does not insert', async () => {
      const companion = await createCompanion('ca-default')
      const before = await prisma.companionCarePlan.count({
        where: { userId, companionId: companion.id },
      })

      const res = await app.inject({
        method: 'GET',
        url: `/api/companions/${companion.id}/care-plan`,
        headers: authHeader(token),
        remoteAddress: nextIp(),
      })
      expect(res.statusCode).toBe(200)
      const plan = res.json().data ?? res.json()
      expect(plan.isDefault).toBe(true)
      expect(plan.enabled).toBe(true)
      expect(plan.frequency).toBe('daily')
      expect(Array.isArray(plan.scenes)).toBe(true)
      expect(plan.scenes.length).toBeGreaterThan(0)

      const after = await prisma.companionCarePlan.count({
        where: { userId, companionId: companion.id },
      })
      expect(after).toBe(before)
    })

    it('IT-CA-patch: PATCH upserts plan; GET then returns persisted (not default)', async () => {
      const companion = await createCompanion('ca-patch')
      const before = await prisma.companionCarePlan.count({
        where: { userId, companionId: companion.id },
      })
      expect(before).toBe(0)

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/companions/${companion.id}/care-plan`,
        headers: authHeader(token),
        payload: {
          enabled: false,
          frequency: 'weekly',
          preferredTime: '09:30',
          scenes: ['morning', 'stress_support', 'anniversary'],
          tone: 'intimate',
          customPrompt: '写得更短一点',
        },
        remoteAddress: nextIp(),
      })
      expect(patchRes.statusCode).toBe(200)
      const patched = patchRes.json().data ?? patchRes.json()
      expect(patched.isDefault).toBe(false)
      expect(patched.enabled).toBe(false)
      expect(patched.frequency).toBe('weekly')
      expect(patched.preferredTime).toBe('09:30')
      expect(patched.tone).toBe('intimate')
      expect(patched.customPrompt).toBe('写得更短一点')
      expect(patched.scenes).toEqual(['morning', 'stress_support', 'anniversary'])
      // disabled → nextRunAtMs 应为 null（无调度）
      expect(patched.nextRunAtMs).toBeNull()

      const rowCount = await prisma.companionCarePlan.count({
        where: { userId, companionId: companion.id },
      })
      expect(rowCount).toBe(1)

      // IT-CA-get-existing：有行时 GET 非默认
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/companions/${companion.id}/care-plan`,
        headers: authHeader(token),
        remoteAddress: nextIp(),
      })
      expect(getRes.statusCode).toBe(200)
      const existing = getRes.json().data ?? getRes.json()
      expect(existing.isDefault).toBe(false)
      expect(existing.enabled).toBe(false)
      expect(existing.frequency).toBe('weekly')
      expect(existing.tone).toBe('intimate')
      expect(existing.scenes).toEqual(['morning', 'stress_support', 'anniversary'])

      // 二次 PATCH 为 upsert（仍一行）
      const patch2 = await app.inject({
        method: 'PATCH',
        url: `/api/companions/${companion.id}/care-plan`,
        headers: authHeader(token),
        payload: { enabled: true, tone: 'light' },
        remoteAddress: nextIp(),
      })
      expect(patch2.statusCode).toBe(200)
      const again = patch2.json().data ?? patch2.json()
      expect(again.enabled).toBe(true)
      expect(again.tone).toBe('light')
      // 未传字段保留
      expect(again.frequency).toBe('weekly')
      expect(again.customPrompt).toBe('写得更短一点')
      expect(await prisma.companionCarePlan.count({ where: { userId, companionId: companion.id } })).toBe(
        1,
      )
    })

    it('IT-CA-generate: manual generate writes assistant message + CareEvent', async () => {
      const companion = await createCompanion('ca-gen')
      const res = await app.inject({
        method: 'POST',
        url: `/api/companions/${companion.id}/care-events/generate`,
        headers: authHeader(token),
        payload: { scene: 'morning', tone: 'gentle' },
        remoteAddress: nextIp(),
      })
      expect(res.statusCode).toBeLessThan(400)
      const event = res.json().data ?? res.json()
      expect(event.messageId).toBeTruthy()
      expect(event.conversationId).toBeTruthy()
      expect(event.scene).toBe('morning')
      expect(event.status).toBe('sent')
      expect(String(event.message).length).toBeGreaterThan(0)

      const msg = await prisma.companionMessage.findUnique({ where: { id: event.messageId } })
      expect(msg?.role).toBe('assistant')
      expect(msg?.metadata).toContain('care')

      const careEvent = await prisma.companionCareEvent.findUnique({ where: { id: event.id } })
      expect(careEvent).toBeTruthy()
      expect(careEvent!.messageId).toBe(event.messageId)

      const companionRow = await prisma.companion.findUnique({ where: { id: companion.id } })
      expect(companionRow?.lastAssistantMessage).toBe(event.message)
      expect(companionRow?.lastAssistantMessageAtMs).toBeTruthy()
    })

    it('IT-CA-forbidden: non-owner receives 403', async () => {
      const companion = await createCompanion('ca-forbid')
      const otherEmail = `companion-other-${Date.now()}@test.gofer`
      await AuthFixtures.createUser(
        app,
        { email: otherEmail, password: 'Test1234!', name: 'Other' },
        { remoteAddress: nextIp() },
      )
      const otherToken = await AuthFixtures.loginAs(
        app,
        { email: otherEmail, password: 'Test1234!' },
        { remoteAddress: nextIp() },
      )

      const res = await app.inject({
        method: 'GET',
        url: `/api/companions/${companion.id}/care-plan`,
        headers: authHeader(otherToken),
        remoteAddress: nextIp(),
      })
      expect(res.statusCode).toBe(403)

      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/companions/${companion.id}/care-plan`,
        headers: authHeader(otherToken),
        payload: { enabled: false },
        remoteAddress: nextIp(),
      })
      expect(patch.statusCode).toBe(403)
      expect(
        await prisma.companionCarePlan.count({ where: { userId, companionId: companion.id } }),
      ).toBe(0)

      const gen = await app.inject({
        method: 'POST',
        url: `/api/companions/${companion.id}/care-events/generate`,
        headers: authHeader(otherToken),
        payload: { scene: 'night' },
        remoteAddress: nextIp(),
      })
      expect(gen.statusCode).toBe(403)
    })
  })

  describe('IT-MM: memory list / write', () => {
    async function seedMemory(
      companionId: string,
      data: {
        type?: 'preference' | 'boundary' | 'relationship_goal' | 'conversation_style' | 'important_fact'
        content: string
        importance?: number
        status?: 'active' | 'disabled' | 'deleted'
      },
    ) {
      return prisma.companionMemory.create({
        data: {
          userId,
          companionId,
          type: data.type ?? 'preference',
          content: data.content,
          importance: data.importance ?? 3,
          status: data.status ?? 'active',
        },
      })
    }

    it('IT-MM-list: GET /companion/memories lists by companionId and type filter', async () => {
      const companion = await createCompanion('mm-list')
      await seedMemory(companion.id, { type: 'preference', content: '喜欢猫' })
      await seedMemory(companion.id, { type: 'boundary', content: '不谈政治' })
      // 其它伴侣记忆不得泄漏
      const other = await createCompanion('mm-list-other')
      await seedMemory(other.id, { type: 'preference', content: '其它伴侣记忆' })

      const allRes = await app.inject({
        method: 'GET',
        url: `/api/companion/memories?companionId=${companion.id}`,
        headers: authHeader(token),
        remoteAddress: nextIp(),
      })
      expect(allRes.statusCode).toBe(200)
      const allBody = allRes.json()
      const allItems = (allBody.data?.items ?? allBody.items) as Array<{
        content: string
        type: string
      }>
      expect(allItems.length).toBe(2)
      expect(allItems.some((m) => m.content === '喜欢猫')).toBe(true)
      expect(allItems.some((m) => m.content === '不谈政治')).toBe(true)
      expect(allItems.some((m) => m.content === '其它伴侣记忆')).toBe(false)

      const filtered = await app.inject({
        method: 'GET',
        url: `/api/companion/memories?companionId=${companion.id}&type=boundary`,
        headers: authHeader(token),
        remoteAddress: nextIp(),
      })
      expect(filtered.statusCode).toBe(200)
      const fBody = filtered.json()
      const fItems = (fBody.data?.items ?? fBody.items) as Array<{ content: string; type: string }>
      expect(fItems.every((m) => m.type === 'boundary')).toBe(true)
      expect(fItems.some((m) => m.content === '不谈政治')).toBe(true)
      expect(fItems.some((m) => m.content === '喜欢猫')).toBe(false)
    })

    it('IT-MM-write: PATCH content/status and soft DELETE', async () => {
      const companion = await createCompanion('mm-write')
      const mem = await seedMemory(companion.id, {
        type: 'preference',
        content: '原文',
        importance: 2,
      })

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/companion/memories/${mem.id}`,
        headers: authHeader(token),
        payload: { content: '已修订', importance: 5, status: 'disabled' },
        remoteAddress: nextIp(),
      })
      expect(patchRes.statusCode).toBe(200)
      const patched = (patchRes.json().data ?? patchRes.json()) as {
        content: string
        importance: number
        status: string
      }
      expect(patched.content).toBe('已修订')
      expect(patched.importance).toBe(5)
      expect(patched.status).toBe('disabled')

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/companion/memories/${mem.id}`,
        headers: authHeader(token),
        remoteAddress: nextIp(),
      })
      expect(delRes.statusCode).toBe(200)
      const delBody = delRes.json().data ?? delRes.json()
      expect(delBody).toMatchObject({ success: true })

      const row = await prisma.companionMemory.findUnique({ where: { id: mem.id } })
      expect(row?.status).toBe('deleted')

      // 默认列表排除 deleted
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/companion/memories?companionId=${companion.id}`,
        headers: authHeader(token),
        remoteAddress: nextIp(),
      })
      const items = (listRes.json().data?.items ?? listRes.json().items) as Array<{ id: string }>
      expect(items.some((m) => m.id === mem.id)).toBe(false)
    })

    it('IT-MM-forbidden: non-owner cannot list/update/delete', async () => {
      const companion = await createCompanion('mm-forbid')
      const mem = await seedMemory(companion.id, { content: '私有记忆' })

      const otherEmail = `mm-other-${Date.now()}@test.gofer`
      await AuthFixtures.createUser(
        app,
        { email: otherEmail, password: 'Test1234!', name: 'MM Other' },
        { remoteAddress: nextIp() },
      )
      const otherToken = await AuthFixtures.loginAs(
        app,
        { email: otherEmail, password: 'Test1234!' },
        { remoteAddress: nextIp() },
      )

      const list = await app.inject({
        method: 'GET',
        url: `/api/companion/memories?companionId=${companion.id}`,
        headers: authHeader(otherToken),
        remoteAddress: nextIp(),
      })
      expect(list.statusCode).toBe(403)

      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/companion/memories/${mem.id}`,
        headers: authHeader(otherToken),
        payload: { content: '劫持' },
        remoteAddress: nextIp(),
      })
      expect(patch.statusCode).toBe(403)

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/companion/memories/${mem.id}`,
        headers: authHeader(otherToken),
        remoteAddress: nextIp(),
      })
      expect(del.statusCode).toBe(403)

      const still = await prisma.companionMemory.findUnique({ where: { id: mem.id } })
      expect(still?.content).toBe('私有记忆')
      expect(still?.status).toBe('active')
    })
  })
})
