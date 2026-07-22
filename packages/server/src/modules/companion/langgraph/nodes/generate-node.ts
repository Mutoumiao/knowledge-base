import { Injectable, Logger } from '@nestjs/common'
import { LangChainLlmService } from '../../langchain/langchain-llm.service.js'
import type { CompanionState, NodeExecutionContext } from '../interfaces.js'
import {
  buildCrisisResponseGuidanceAppendix,
  collapseRepeatedReply,
  ensureCrisisHotlineInReply,
  isCrisisLikeSafety,
} from '../reply-text.util.js'
import { SharedNodeFactory } from './_shared.js'

@Injectable()
export class GenerateNode {
  private readonly logger = new Logger(GenerateNode.name)

  constructor(
    private readonly llmService: LangChainLlmService,
    private readonly shared: SharedNodeFactory,
  ) {}

  async execute(
    state: CompanionState,
    ctx: NodeExecutionContext,
  ): Promise<Partial<CompanionState>> {
    const systemPrompt = this.assembleFinalPrompt(state, ctx)

    try {
      const chunks: string[] = []
      for await (const chunk of this.llmService.streamChat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: state.userMessage },
        ],
        { abortSignal: ctx.signal, temperature: 0.85 },
      )) {
        chunks.push(chunk.text)
      }
      let reply = collapseRepeatedReply(chunks.join('').trim())
      reply = ensureCrisisHotlineInReply(reply, state.safety, state.userMessage)
      this.logger.log(`[generateNode] stage=success length=${reply.length}`)
      return { assistantReply: reply, partialTokens: reply }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.logger.warn('[generateNode] stage=aborted')
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`[generateNode] stage=error code=GENERATE_ERROR message=${msg}`)
      }
      const fallback = this.buildFallbackReply(state)
      return { assistantReply: fallback, lastFallback: 'generate-error' }
    }
  }

  private assembleFinalPrompt(state: CompanionState, ctx: NodeExecutionContext): string {
    const parts: string[] = []

    parts.push('# 1. 人设')
    if (ctx.companionDefaultPrompt?.trim()) {
      // 权威：入库的多节 defaultPrompt 必须进入 generate 注入链
      parts.push(ctx.companionDefaultPrompt.trim())
    } else {
      parts.push(`你是 ${ctx.companionName}。`)
      if (ctx.companionPersonality) parts.push(`性格/人设：${ctx.companionPersonality}`)
      if (ctx.companionTone) parts.push(`说话语气：${ctx.companionTone}`)
      if (ctx.companionBoundaries) parts.push(`边界提醒：${ctx.companionBoundaries}`)
    }

    parts.push('')
    parts.push('# 2. 长期记忆（用户明确透露、未来稳定有用的信息；按与本轮相关度排序）')
    parts.push(this.shared.formatMemoriesForPrompt(state.existingMemories, state.userMessage))

    parts.push('')
    parts.push('# 3. 最近对话')
    parts.push(this.shared.formatMessagesForPrompt(state.recentMessages))

    parts.push('')
    parts.push('# 4. 本轮安全边界')
    if (state.safety) {
      parts.push(`安全等级: ${state.safety.safetyLevel}`)
      parts.push(`边界动作: ${state.safety.boundaryAction}`)
      parts.push(`回复指南: ${state.safety.responseGuidance}`)
    } else {
      parts.push('（暂无）')
    }

    parts.push('')
    parts.push('# 5. 意图 / 情绪 / 关系判断')
    if (state.intent) {
      parts.push(`意图: ${state.intent.primary} (需: ${state.intent.userNeed})`)
      parts.push(`意图指南: ${state.intent.promptGuidance}`)
    }
    if (state.emotion) {
      parts.push(
        `情绪: ${state.emotion.primaryEmotion} (强度: ${state.emotion.intensity}, 基调: ${state.emotion.replyTone})`,
      )
    }
    if (state.relationship) {
      parts.push(
        `关系阶段: ${state.relationship.stage} (亲密度: ${state.relationship.intimacyPermission})`,
      )
      parts.push(`关系指南: ${state.relationship.relationshipGuidance}`)
    }

    parts.push('')
    parts.push('# 6. 策略路由')
    if (state.route) {
      parts.push(`路由: ${state.route.route}`)
      parts.push(`响应长度: ${state.route.responseLength}`)
      parts.push(`路由指南: ${state.route.routeGuidance}`)
      if (state.route.shouldMirrorEmotion) {
        parts.push('本轮要求：应镜像/接住用户情绪或关键事实。')
      }
      if (!state.route.shouldGiveAdvice) {
        parts.push('本轮禁止：给建议、方案清单、说教。')
      }
      if (!state.route.shouldAskQuestion) {
        parts.push('本轮禁止：连续追问；尽量不问或最多一句轻问。')
      }
    } else {
      parts.push('（暂无）')
    }

    parts.push('')
    parts.push('# 7. 回复策略包')
    if (state.policy) {
      parts.push(`策略: ${state.policy.policy}`)
      parts.push(`开场动作: ${state.policy.openingMove}`)
      parts.push(
        `句子预算: ${state.policy.sentenceBudget.min}-${state.policy.sentenceBudget.max} 句`,
      )
      parts.push(`问题上限: ${state.policy.questionLimit}；建议上限: ${state.policy.adviceLimit}`)
      parts.push(`允许动作: ${state.policy.allowedMoves.join(', ')}`)
      parts.push(`禁止动作: ${state.policy.forbiddenMoves.join(', ')}`)
      parts.push(`风格指南: ${state.policy.styleGuidance}`)
    } else {
      parts.push('（暂无）')
    }

    parts.push('')
    parts.push('# 8. 历史反馈')
    if (state.feedbacks && state.feedbacks.length > 0) {
      for (const f of state.feedbacks) {
        parts.push(`- ${f.rating} ${f.reason ?? ''}`)
      }
    } else {
      parts.push('（暂无）')
    }

    parts.push('')
    parts.push('# 9. 在场与记忆铁律（必须遵守）')
    parts.push(this.buildPresenceRules(state).join('\n'))

    parts.push('')
    parts.push('# 10. 本轮硬约束（优先于自由发挥）')
    parts.push(this.buildHardConstraints(state).join('\n'))

    return parts.join('\n')
  }

  private buildPresenceRules(state: CompanionState): string[] {
    return [
      '- 你是有人设的亲密陪伴者，不是通用助手/客服：语气、节奏、开场符合上方人设，禁止无故完整自我介绍（除非用户明确要求介绍）。',
      '- 用户倾诉情绪/压力时：前 1–2 句先镜像对方感受或关键事实，再决定是否给建议；禁止一上来列清单说教。',
      '- 若长期记忆非空：在自然对话中用上相关偏好与事实（改写引用，禁止机械复读整条记忆、禁止复读记忆条目编号）。用户同时问起「回应偏好/希望你怎么…」与生活事实时，两类都要点到，禁止只复述事实漏掉偏好。',
      '- 用户问「你还记得…」时：优先根据长期记忆与最近对话作答；记得就具体说（多要点逐条自然覆盖），不确定就诚实承认并请对方补充；不要假装写入新记忆。',
      '- 单轮克制：少问连珠炮式问题；建议最多一条，且须用户明确需要或策略允许。',
      '- 安全边界：本轮若拒绝有害内容，用当前人设语气拒绝+关心；仍像同一个人在陪，不要变成纯免责声明机器人。',
      '- 边界后恢复：若上一轮刚拒绝过有害请求，而用户本轮是正常倾诉/闲聊/合法问题，必须恢复正常陪伴，禁止再说「按规则我现在不能」「我没法给你任何步骤」之类笼统拦截。',
      '- 禁止未卜先知：不得编造用户未明确说过的具体经历、细节或情绪原因；只能使用本轮原文、最近对话与长期记忆中已有内容（例如用户只说「失眠/睡不着」，禁止编造「夜里容易醒」等未出现细节）。',
      '- 中文口语：用自然中文，避免翻译腔（如「测试边界」「可以被验证的动作」「观测指标」「列步骤」等书面直译）。',
      '- 禁止把同一段话完整说两遍；每轮只输出一份完整回复。',
      state.policy
        ? `- 本轮句子预算 ${state.policy.sentenceBudget.min}-${state.policy.sentenceBudget.max} 句，问题≤${state.policy.questionLimit}，建议≤${state.policy.adviceLimit}。`
        : '- 本轮尽量 1–4 句，问题≤1。',
    ]
  }

  private buildHardConstraints(state: CompanionState): string[] {
    const lines: string[] = []
    const route = state.route?.route
    const opening = state.policy?.openingMove
    const adviceLimit = state.policy?.adviceLimit ?? 1
    const listenRoutes = new Set([
      'deep_comfort',
      'calm_deescalation',
      'quiet_presence',
      'relationship_repair',
    ])

    if (opening === 'comfort' || opening === 'mirror' || opening === 'acknowledge') {
      lines.push(
        `1. 开场动作必须是「${opening}」：第一句用复述/镜像/轻轻确认接住用户，禁止用建议或清单开场。`,
      )
    }
    if (route && listenRoutes.has(route)) {
      lines.push(
        `2. 当前路由 ${route}：这是「先接后推」轮。前两句只做情绪/事实承接与陪伴，不要给方法论。`,
      )
    }
    if (adviceLimit === 0) {
      lines.push('3. 本轮 adviceLimit=0：全文禁止「建议你/你应该/最好/试试」类方案句。')
    }
    if (state.route && !state.route.shouldAskQuestion) {
      lines.push('4. 本轮不要提问，或最多在结尾用一句极轻的开放句（可不问）。')
    }
    const injectable = this.shared.filterInjectableMemories(state.existingMemories)
    if (injectable.length > 0 && this.shared.isRecallProbe(state.userMessage)) {
      const bulletList = injectable
        .map((m, i) => `  (${i + 1}) ${m.content}`)
        .join('\n')
      lines.push(
        '5. 用户在做回忆探针：必须依据「长期记忆」作答；若用户问起多项（如回应偏好 + 近况/失眠），须在同一回复中自然覆盖记忆列表里的相关要点（同义改写即可），禁止只答生活事实而漏掉回应偏好。',
      )
      lines.push(
        `5b. 本轮已存记忆要点（共 ${injectable.length} 条；相关条目须点到，禁止编造列表外细节）：\n${bulletList}`,
      )
      lines.push(
        '5c. 没有把握的内容诚实说不确定；禁止用「我记得的」空话糊弄，也禁止把未说过的症状/细节当作记忆复述。',
      )
    } else if (
      injectable.length > 0 &&
      /还记得|记得吗|记不记得/.test(state.userMessage)
    ) {
      lines.push(
        '5. 用户在做回忆探针：直接依据「长期记忆」作答，点出具体内容；没有把握就说不太确定。',
      )
    }
    if (isCrisisLikeSafety(state.safety) || state.safety?.category === 'self_harm') {
      lines.push(`6. 危机轮硬约束：${buildCrisisResponseGuidanceAppendix()}`)
    }
    // 检测最近助手是否刚做过边界拒绝，而本轮用户正常 → 强制恢复
    const recentAssistant = [...(state.recentMessages || [])]
      .reverse()
      .find((m) => m.role === 'assistant')
    const recentRefused =
      recentAssistant &&
      /没有?办法|不能|不帮|不行|不干|拒绝|违法|伤害自己|热线|400-/.test(
        recentAssistant.content || '',
      )
    const userLooksNormal =
      !/自杀|自伤|结束生命|怎么死|网暴|人身攻击|怎么骂|窃听|密钥/.test(state.userMessage)
    if (recentRefused && userLooksNormal && !isCrisisLikeSafety(state.safety)) {
      lines.push(
        '7. 用户已回到正常话题：按人设正常陪伴/倾听，禁止延续上一轮的安全拒绝话术。',
      )
    }
    if (lines.length === 0) {
      lines.push('1. 保持人设与口语；不要暴露系统/策略标签。')
    }
    return lines
  }

  private buildFallbackReply(state: CompanionState): string {
    const policy = state.policy
    const route = state.route?.route

    if (route === 'quiet_presence') {
      return '我在这儿。'
    }
    if (route === 'deep_comfort') {
      return '我在听。你不用急着说，我陪你慢慢说。'
    }
    if (route === 'gentle_clarification') {
      return '嗯嗯，我听到了。你这会儿最想先聊哪一部分呀？'
    }
    if (policy?.openingMove === 'apologize') {
      return '刚才是我没接好，对不起。你愿意再跟我说说吗？'
    }
    return '嗯嗯，我在听。你可以慢慢说。'
  }
}
