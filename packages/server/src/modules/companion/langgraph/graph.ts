import type { RunnableConfig } from '@langchain/core/runnables'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { Injectable, Logger } from '@nestjs/common'
import {
  DEFAULT_REPAIR_BUDGET_PER_TURN,
  type StructuredRepairBudgetState,
} from '../langchain/structured-repair-budget.js'
import type { CompanionState, NodeExecutionContext } from './interfaces.js'
import {
  EmotionNode,
  GenerateNode,
  IntentNode,
  MemoryCandidateNode,
  MemoryExtractionNode,
  PolicyNode,
  QualityGuardNode,
  RelationshipStageNode,
  RouteNode,
  SafetyNode,
  SummaryNode,
} from './nodes/index.js'

/**
 * LangGraph 约束：节点名不得与 state channel 同名。
 * 因此节点用 step_* 前缀；通道名与 CompanionState / 节点 return 字段一致（safety、intent…）。
 * 历史 bug：通道写成 safetyState 而节点 return safety → 图内状态永远写不进去，
 * 条件边永远 skip memory，下游节点读不到上游结果。
 */
const CompanionGraphState = Annotation.Root({
  userId: Annotation<string>(),
  companionId: Annotation<string>(),
  conversationId: Annotation<string>(),
  userMessage: Annotation<string>(),
  safety: Annotation<CompanionState['safety']>(),
  intent: Annotation<CompanionState['intent']>(),
  emotion: Annotation<CompanionState['emotion']>(),
  relationship: Annotation<CompanionState['relationship']>(),
  route: Annotation<CompanionState['route']>(),
  policy: Annotation<CompanionState['policy']>(),
  quality: Annotation<CompanionState['quality']>(),
  memoryCandidate: Annotation<CompanionState['memoryCandidate']>(),
  extractedMemories: Annotation<CompanionState['extractedMemories']>(),
  summary: Annotation<CompanionState['summary']>(),
  assistantReply: Annotation<CompanionState['assistantReply']>(),
  partialTokens: Annotation<string | undefined>(),
  existingMemories: Annotation<CompanionState['existingMemories']>(),
  recentMessages: Annotation<CompanionState['recentMessages']>(),
  messageCount: Annotation<number | undefined>(),
  feedbacks: Annotation<CompanionState['feedbacks']>(),
  lastFallback: Annotation<string | undefined>(),
})

type Branch = 'continue' | 'skip_memory'

/** 对外/观测使用的逻辑节点名 → 图内实际 node id */
export const GRAPH_STEP_TO_NODE = {
  safety: 'step_safety',
  intent: 'step_intent',
  emotion: 'step_emotion',
  relationship: 'step_relationship',
  route: 'step_route',
  policy: 'step_policy',
  generate: 'step_generate',
  quality: 'step_quality',
  summary: 'step_summary',
  memory_candidate: 'step_memory_candidate',
  memory_extraction: 'step_memory_extraction',
} as const

const NODE_TO_GRAPH_STEP: Record<string, string> = Object.fromEntries(
  Object.entries(GRAPH_STEP_TO_NODE).map(([step, node]) => [node, step]),
)

@Injectable()
export class CompanionGraphService {
  private readonly logger = new Logger(CompanionGraphService.name)
  private readonly graph: ReturnType<StateGraph<typeof CompanionGraphState>['compile']>

  constructor(
    readonly safetyNode: SafetyNode,
    readonly intentNode: IntentNode,
    readonly emotionNode: EmotionNode,
    readonly relationshipNode: RelationshipStageNode,
    readonly routeNode: RouteNode,
    readonly policyNode: PolicyNode,
    readonly generateNode: GenerateNode,
    readonly qualityNode: QualityGuardNode,
    readonly summaryNode: SummaryNode,
    readonly memoryCandidateNode: MemoryCandidateNode,
    readonly memoryExtractionNode: MemoryExtractionNode,
  ) {
    this.graph = this.buildGraph({
      safety: safetyNode,
      intent: intentNode,
      emotion: emotionNode,
      relationship: relationshipNode,
      route: routeNode,
      policy: policyNode,
      generate: generateNode,
      quality: qualityNode,
      summary: summaryNode,
      memoryCandidate: memoryCandidateNode,
      memoryExtraction: memoryExtractionNode,
    })
  }

  getGraph() {
    return this.graph
  }

  async *stream(
    initialState: CompanionState,
    ctx: NodeExecutionContext,
  ): AsyncGenerator<{ node: string; patch: Partial<CompanionState> }> {
    // D10：整轮图执行共享 repair 预算（默认 1 次）；放 configurable 以便各节点共享可变计数
    const structuredRepairBudget: StructuredRepairBudgetState = {
      used: 0,
      budget: DEFAULT_REPAIR_BUDGET_PER_TURN,
    }
    // O11：三态结局 plain object；挂到外层 ctx 以便 stream 收尾写 spanAttrs
    if (!ctx.structuredStages) {
      ctx.structuredStages = {}
    }
    const structuredStages = ctx.structuredStages
    const rawStream = await this.graph.stream(initialState as never, {
      configurable: {
        companionName: ctx.companionName,
        companionPersonality: ctx.companionPersonality,
        companionTone: ctx.companionTone,
        companionBoundaries: ctx.companionBoundaries,
        companionGuardrails: ctx.companionGuardrails,
        companionDefaultPrompt: ctx.companionDefaultPrompt,
        structuredRepairBudget,
        structuredStages,
      },
      signal: ctx.signal,
      streamMode: 'updates',
    })

    const stream = rawStream as AsyncIterable<{ [node: string]: Partial<CompanionState> }>
    for await (const chunk of stream) {
      for (const [nodeId, patch] of Object.entries(chunk)) {
        const step = NODE_TO_GRAPH_STEP[nodeId] ?? nodeId
        this.logger.log(`[graph] step=${step}_done`)
        yield { node: step, patch: patch as Partial<CompanionState> }
      }
    }
  }

  private buildGraph(nodes: {
    safety: SafetyNode
    intent: IntentNode
    emotion: EmotionNode
    relationship: RelationshipStageNode
    route: RouteNode
    policy: PolicyNode
    generate: GenerateNode
    quality: QualityGuardNode
    summary: SummaryNode
    memoryCandidate: MemoryCandidateNode
    memoryExtraction: MemoryExtractionNode
  }) {
    const builder = new StateGraph(CompanionGraphState)
    const N = GRAPH_STEP_TO_NODE

    builder.addNode(N.safety, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('safety', nodes.safety, state, config),
    )
    builder.addNode(N.intent, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('intent', nodes.intent, state, config),
    )
    builder.addNode(N.emotion, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('emotion', nodes.emotion, state, config),
    )
    builder.addNode(N.relationship, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('relationship', nodes.relationship, state, config),
    )
    builder.addNode(N.route, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('route', nodes.route, state, config),
    )
    builder.addNode(N.policy, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('policy', nodes.policy, state, config),
    )
    builder.addNode(N.generate, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('generate', nodes.generate, state, config),
    )
    builder.addNode(N.quality, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('quality', nodes.quality, state, config),
    )
    builder.addNode(N.summary, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('summary', nodes.summary, state, config),
    )
    builder.addNode(N.memory_candidate, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('memory_candidate', nodes.memoryCandidate, state, config),
    )
    builder.addNode(N.memory_extraction, (state: CompanionState, config: RunnableConfig) =>
      this.runNode('memory_extraction', nodes.memoryExtraction, state, config),
    )

    builder.addEdge(START as never, N.safety as never)
    // 产品路径：有害拒绝走 soft 边界 + generate 有正文；不再 end_safety 空 END
    builder.addEdge(N.safety as never, N.intent as never)

    builder.addEdge(N.intent as never, N.emotion as never)
    builder.addEdge(N.emotion as never, N.relationship as never)
    builder.addEdge(N.relationship as never, N.route as never)
    builder.addEdge(N.route as never, N.policy as never)
    builder.addEdge(N.policy as never, N.generate as never)
    builder.addEdge(N.generate as never, N.quality as never)
    // Quality：观测 + 规则软修复（先接后推/句数/破沉浸）；修复结果写入 assistantReply 后继续
    builder.addEdge(N.quality as never, N.summary as never)

    builder.addEdge(N.summary as never, N.memory_candidate as never)

    builder.addConditionalEdges(
      N.memory_candidate as never,
      (state: CompanionState): Branch => {
        if (state.memoryCandidate?.shouldExtract) {
          return 'continue'
        }
        this.logger.log('[graph] step=memory_skip')
        return 'skip_memory'
      },
      {
        continue: N.memory_extraction as never,
        skip_memory: END as never,
      },
    )

    builder.addEdge(N.memory_extraction as never, END as never)

    return builder.compile({ checkpointer: undefined })
  }

  private async runNode(
    name: string,
    node: {
      execute(state: CompanionState, ctx: NodeExecutionContext): Promise<Partial<CompanionState>>
    },
    state: CompanionState,
    config?: RunnableConfig,
  ): Promise<Partial<CompanionState>> {
    const conf = (config?.configurable ?? {}) as Record<string, unknown>
    const ctx: NodeExecutionContext = {
      userId: state.userId,
      companionId: state.companionId,
      conversationId: state.conversationId,
      companionName: (conf.companionName as string) || 'Companion',
      companionPersonality: conf.companionPersonality as string | undefined,
      companionTone: conf.companionTone as string | undefined,
      companionBoundaries: conf.companionBoundaries as string | undefined,
      companionGuardrails: conf.companionGuardrails as string | undefined,
      companionDefaultPrompt: conf.companionDefaultPrompt as string | undefined,
      signal: config?.signal as AbortSignal | undefined,
      structuredRepairBudget: conf.structuredRepairBudget as
        | StructuredRepairBudgetState
        | undefined,
      structuredStages: conf.structuredStages as NodeExecutionContext['structuredStages'],
    }
    this.logger.log(`[graph] step=${name}_start`)
    const next = await node.execute(state, ctx)
    this.logger.log(`[graph] step=${name}_done`)
    return next
  }
}

export { CompanionGraphState }
