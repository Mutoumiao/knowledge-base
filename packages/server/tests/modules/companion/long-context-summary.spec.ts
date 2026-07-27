/**
 * 长上下文连续性：prepare 读回 summary + generate 注入 + reset 清空
 * Change: companion-long-context-continuity
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { CompanionChatPipelineService } from '@/modules/companion/companion-chat-pipeline.service.js'
import { CompanionChatStreamService } from '@/modules/companion/companion-chat-stream.service.js'
import { GenerateNode } from '@/modules/companion/langgraph/nodes/generate-node.js'
import type { CompanionState, NodeExecutionContext } from '@/modules/companion/langgraph/interfaces.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const convRepoPath = path.resolve(
  __dirname,
  '../../../src/modules/companion/repositories/companion-conversation.repository.ts',
)

function makePipeline(opts: {
  summary: string | null
  updatedAt?: Date
  recent?: Array<{ id: string; role: string; content: string; createdAt: Date }>
  memories?: Array<{ id: string; type: string; content: string; importance: number }>
}) {
  const updatedAt = opts.updatedAt ?? new Date('2026-06-01T00:00:00.000Z')
  const companion = {
    id: 'c1',
    name: '晚晚',
    status: 'published',
    personality: null,
    tone: null,
    boundaries: null,
    guardrailsPrompt: null,
  }
  return new CompanionChatPipelineService(
    {} as never,
    {
      findByIdAndAuthorize: vi.fn().mockResolvedValue(companion),
    } as never,
    {
      getOrCreate: vi.fn().mockResolvedValue({
        id: 'cv1',
        summary: opts.summary,
        updatedAt,
        messageCount: 10,
      }),
      incrementMessageCount: vi.fn().mockResolvedValue({ messageCount: 11 }),
    } as never,
    {
      findRecent: vi.fn().mockResolvedValue(opts.recent ?? []),
      save: vi.fn().mockResolvedValue({}),
    } as never,
    {
      findByUser: vi.fn().mockResolvedValue(opts.memories ?? []),
    } as never,
    {
      findRecentByCompanion: vi.fn().mockResolvedValue([]),
    } as never,
    {
      resolvePromptForChat: vi.fn().mockResolvedValue('你是晚晚。'),
    } as never,
    {
      filterInjectableMemories: vi.fn((m: unknown[]) => m),
    } as never,
  )
}

describe('UT-LCC: prepareContext summary 读回', () => {
  it('1.1 非空 summary → initialState.summary.text 等于库值', async () => {
    const text = '用户在准备下周约会；偏好简短安慰。'
    const updatedAt = new Date('2026-07-01T12:00:00.000Z')
    const pipeline = makePipeline({ summary: text, updatedAt })
    const { initialState, prepObs } = await pipeline.prepareContext({
      userId: 'u1',
      companionId: 'c1',
      message: '还好吗',
    })
    expect(initialState.summary).toEqual({ text, updatedAt })
    expect(prepObs.summaryLoaded).toBe(true)
  })

  it('1.2 summary 为空/null 时不伪造非空摘要', async () => {
    for (const summary of [null, '', '   ']) {
      const pipeline = makePipeline({ summary })
      const { initialState, prepObs } = await pipeline.prepareContext({
        userId: 'u1',
        companionId: 'c1',
        message: 'hi',
      })
      expect(initialState.summary).toBeUndefined()
      expect(prepObs.summaryLoaded).toBe(false)
    }
  })

  it('prepObs.recentMessageCount 反映近窗条数', async () => {
    const recent = [
      { id: 'm1', role: 'user', content: 'a', createdAt: new Date() },
      { id: 'm2', role: 'assistant', content: 'b', createdAt: new Date() },
    ]
    const pipeline = makePipeline({ summary: null, recent })
    const { prepObs } = await pipeline.prepareContext({
      userId: 'u1',
      companionId: 'c1',
      message: 'x',
    })
    expect(prepObs.recentMessageCount).toBe(2)
  })
})

describe('UT-LCC: generate 注入会话中线摘要', () => {
  const ctx: NodeExecutionContext = {
    userId: 'u1',
    companionId: 'c1',
    conversationId: 'cv1',
    companionName: '晚晚',
    companionDefaultPrompt: '你是晚晚。',
  }

  function makeNode() {
    const shared = {
      formatMemoriesForPrompt: vi.fn().mockReturnValue('（暂无）'),
      formatMessagesForPrompt: vi.fn().mockReturnValue('（暂无）'),
      filterInjectableMemories: vi.fn().mockReturnValue([]),
      isRecallProbe: vi.fn().mockReturnValue(false),
    }
    return new GenerateNode({ streamChat: vi.fn() } as never, shared as never)
  }

  function assemble(node: GenerateNode, state: Partial<CompanionState>) {
    return (
      node as unknown as {
        assembleFinalPrompt: (s: CompanionState, c: NodeExecutionContext) => string
      }
    ).assembleFinalPrompt(state as CompanionState, ctx)
  }

  it('1.3 非空 summary 时 prompt 含文本且存在 # 3 会话中线摘要', () => {
    const summaryText = '双方约好本周末一起复盘跳槽进度。'
    const prompt = assemble(makeNode(), {
      userId: 'u1',
      companionId: 'c1',
      conversationId: 'cv1',
      userMessage: '周末怎么样',
      summary: { text: summaryText, updatedAt: new Date() },
      recentMessages: [],
      existingMemories: [],
    })
    expect(prompt).toMatch(/# 3\.?\s*会话中线摘要/)
    expect(prompt).toContain(summaryText)
    expect(prompt).toMatch(/# 4\.?\s*最近对话/)
    expect(prompt).toMatch(/# 11\.?\s*本轮硬约束/)
    // 禁止浮点节号
    expect(prompt).not.toMatch(/#\s*2\.5/)
  })

  it('空摘要走（暂无）占位，结构仍有 # 3', () => {
    const prompt = assemble(makeNode(), {
      userId: 'u1',
      companionId: 'c1',
      conversationId: 'cv1',
      userMessage: 'hi',
      recentMessages: [],
      existingMemories: [],
    })
    expect(prompt).toMatch(/# 3\.?\s*会话中线摘要/)
    expect(prompt).toMatch(/# 3[\s\S]*?（暂无）/)
  })
})

describe('UT-LCC: reset 清空 conversation.summary', () => {
  it('1.4 resetChatHistory 将 summary 置 null', () => {
    const src = readFileSync(convRepoPath, 'utf-8')
    expect(src).toMatch(/async resetChatHistory/)
    expect(src).toMatch(/summary:\s*null/)
    // 长期记忆不在 conversation 表清空路径内（保留跨 reset）
    expect(src).not.toMatch(/companionMemory\.deleteMany/)
  })
})

describe('UT-LCC: writeCompanionObs 使用 prepare 捕获值', () => {
  it('spanAttrs 用 prepObs，不因图后 summary 假阳性', () => {
    const recordTurn = vi.fn().mockResolvedValue(undefined)
    const stream = new CompanionChatStreamService({} as never, { recordTurn } as never)
    ;(
      stream as unknown as {
        writeCompanionObs: (input: Record<string, unknown>) => void
      }
    ).writeCompanionObs({
      traceId: 't-lcc',
      userId: 'u1',
      conversationId: 'cv1',
      status: 'ok',
      latencyMs: 10,
      spanMs: {},
      fullState: {
        summary: { text: '本轮新摘要', updatedAt: new Date() },
        existingMemories: [],
      },
      prepObs: { summaryLoaded: false, recentMessageCount: 7 },
    })
    expect(recordTurn).toHaveBeenCalledTimes(1)
    const arg = recordTurn.mock.calls[0][0] as {
      spanAttrs: { summaryLoaded?: boolean; recentMessageCount?: number }
    }
    expect(arg.spanAttrs.summaryLoaded).toBe(false)
    expect(arg.spanAttrs.recentMessageCount).toBe(7)
  })
})
