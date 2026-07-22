import { emotionRouteSchema, fallbackEmotionRoute } from '@goferbot/data/schemas'
import { Injectable, Logger } from '@nestjs/common'
import type {
  CompanionState,
  EmotionResult,
  IntentResult,
  NodeExecutionContext,
  RelationshipResult,
  RouteResult,
} from '../interfaces.js'

interface RouteRule {
  when: {
    intent?: IntentResult['primary']
    emotion?: EmotionResult['primaryEmotion']
    relationship?: RelationshipResult['stage']
  }
  /** 匹配优先级：3=三元组精确，2=意图+情绪，1=仅意图/仅情绪默认 */
  priority: 1 | 2 | 3
  route: RouteResult['route']
  responseLength: RouteResult['responseLength']
  shouldAskQuestion: boolean
  shouldGiveAdvice: boolean
  shouldUsePetName: boolean
  shouldMirrorEmotion: boolean
  routeGuidance: string
}

/**
 * 路由规则：先精确后宽松。
 * 历史 bug：仅三元组精确匹配 → 多数情感轮落到 gentle_clarification 默认，
 * 导致「先接后推」策略包很少生效。
 */
const ROUTE_RULES: RouteRule[] = [
  // —— 精确三元组（priority 3）——
  {
    when: { intent: 'emotional_support', emotion: 'sad', relationship: 'trusted_companion' },
    priority: 3,
    route: 'deep_comfort',
    responseLength: 'medium',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: true,
    shouldMirrorEmotion: true,
    routeGuidance: '先默默承接情绪，再温和地表达陪伴感；不要急于给建议。',
  },
  {
    when: { intent: 'emotional_support', emotion: 'anxious', relationship: 'boundary_sensitive' },
    priority: 3,
    route: 'calm_deescalation',
    responseLength: 'short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '保持冷静、稳定、低压力的语气；帮助用户降温。',
  },
  {
    when: { intent: 'emotional_support', emotion: 'angry', relationship: 'repairing' },
    priority: 3,
    route: 'relationship_repair',
    responseLength: 'short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: false,
    routeGuidance: '先承担、先道歉、不辩解；以修复关系为第一目标。',
  },
  {
    when: { intent: 'casual_chat', emotion: 'happy', relationship: 'warming_up' },
    priority: 3,
    route: 'playful_flirt',
    responseLength: 'short',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '轻松、俏皮、有节制地互动；不要过度暧昧。',
  },
  {
    when: { intent: 'casual_chat', emotion: 'playful', relationship: 'comfortable_chat' },
    priority: 3,
    route: 'light_companion',
    responseLength: 'short',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '自然、轻松地陪伴；适度提问保持互动。',
  },
  {
    when: { intent: 'life_sharing', emotion: 'neutral', relationship: 'comfortable_chat' },
    priority: 3,
    route: 'light_companion',
    responseLength: 'medium',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '认真倾听、适时回应；鼓励用户分享。',
  },
  {
    when: { intent: 'companionship_presence', emotion: 'lonely', relationship: 'new_connection' },
    priority: 3,
    route: 'quiet_presence',
    responseLength: 'very_short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '安静陪伴，不要打扰；让用户感受到"我在"。',
  },
  {
    when: { intent: 'life_sharing', emotion: 'stressed', relationship: 'trusted_companion' },
    priority: 3,
    route: 'practical_support',
    responseLength: 'medium',
    shouldAskQuestion: true,
    shouldGiveAdvice: true,
    shouldUsePetName: false,
    shouldMirrorEmotion: false,
    routeGuidance: '先共情，再给一个具体、可执行的小建议。',
  },
  {
    when: { intent: 'romantic_flirt', emotion: 'affectionate', relationship: 'close_bond' },
    priority: 3,
    route: 'playful_flirt',
    responseLength: 'short',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: true,
    shouldMirrorEmotion: true,
    routeGuidance: '温柔、适度、有边界地回应；不要越界。',
  },
  {
    when: { intent: 'conversation_repair', emotion: 'disappointed', relationship: 'repairing' },
    priority: 3,
    route: 'relationship_repair',
    responseLength: 'medium',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: false,
    routeGuidance: '先道歉、倾听、确认理解，再温和修复。',
  },

  // —— 意图 + 情绪（priority 2）：不依赖关系阶段 ——
  {
    when: { intent: 'emotional_support', emotion: 'sad' },
    priority: 2,
    route: 'deep_comfort',
    responseLength: 'medium',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '先接住难过，用镜像或事实复述开场；本轮禁止给建议清单。',
  },
  {
    when: { intent: 'emotional_support', emotion: 'anxious' },
    priority: 2,
    route: 'calm_deescalation',
    responseLength: 'short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '先稳住焦虑，语气放慢；不要急着出主意。',
  },
  {
    when: { intent: 'emotional_support', emotion: 'stressed' },
    priority: 2,
    route: 'deep_comfort',
    responseLength: 'medium',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '先接住压力与疲惫，再决定是否给一个极小建议。',
  },
  {
    when: { intent: 'emotional_support', emotion: 'lonely' },
    priority: 2,
    route: 'quiet_presence',
    responseLength: 'very_short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '用短句确认在场；少问、少建议。',
  },
  {
    when: { intent: 'emotional_support', emotion: 'angry' },
    priority: 2,
    route: 'calm_deescalation',
    responseLength: 'short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '先承认愤怒合理，不辩解、不站队升级。',
  },
  {
    when: { intent: 'life_sharing', emotion: 'stressed' },
    priority: 2,
    route: 'practical_support',
    responseLength: 'medium',
    shouldAskQuestion: true,
    shouldGiveAdvice: true,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '先共情压力，再最多给一条可执行小建议。',
  },
  {
    when: { intent: 'life_sharing', emotion: 'sad' },
    priority: 2,
    route: 'deep_comfort',
    responseLength: 'medium',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '分享中带难过时，优先接情绪而非给方案。',
  },
  {
    when: { intent: 'companionship_presence', emotion: 'lonely' },
    priority: 2,
    route: 'quiet_presence',
    responseLength: 'very_short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '安静陪伴，让用户感到有人在。',
  },
  {
    when: { intent: 'relationship_advice', emotion: 'confused' },
    priority: 2,
    route: 'gentle_clarification',
    responseLength: 'medium',
    shouldAskQuestion: true,
    shouldGiveAdvice: true,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '先澄清困惑点，再温和给一个建议。',
  },
  {
    when: { intent: 'romantic_flirt', emotion: 'affectionate' },
    priority: 2,
    route: 'playful_flirt',
    responseLength: 'short',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '温柔有节制地回应暧昧；不越界。',
  },
  {
    when: { intent: 'creative_request', emotion: 'playful' },
    priority: 2,
    route: 'light_companion',
    responseLength: 'medium',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: false,
    routeGuidance: '投入、有创意地回应；与用户共创。',
  },

  // —— 仅意图默认（priority 1）——
  {
    when: { intent: 'emotional_support' },
    priority: 1,
    route: 'deep_comfort',
    responseLength: 'medium',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '情感支持默认：前 1–2 句先镜像感受或关键事实，禁止一上来列建议。',
  },
  {
    when: { intent: 'companionship_presence' },
    priority: 1,
    route: 'quiet_presence',
    responseLength: 'very_short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '在场陪伴：短句确认「我在」。',
  },
  {
    when: { intent: 'memory_update' },
    priority: 1,
    route: 'memory_ack',
    responseLength: 'short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: false,
    routeGuidance: '确认收到要记住的内容，温和简短回应。',
  },
  {
    when: { intent: 'agent_feedback' },
    priority: 1,
    route: 'relationship_repair',
    responseLength: 'short',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: false,
    routeGuidance: '先感谢反馈，再确认如何可以更好。',
  },
  {
    when: { intent: 'conversation_repair' },
    priority: 1,
    route: 'relationship_repair',
    responseLength: 'medium',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: false,
    routeGuidance: '先道歉倾听，再温和修复。',
  },
  {
    when: { intent: 'casual_chat' },
    priority: 1,
    route: 'light_companion',
    responseLength: 'short',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '轻松陪伴，适度互动。',
  },
  {
    when: { intent: 'life_sharing' },
    priority: 1,
    route: 'light_companion',
    responseLength: 'medium',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '认真听分享，适时接住关键点。',
  },
  {
    when: { intent: 'unclear' },
    priority: 1,
    route: 'gentle_clarification',
    responseLength: 'short',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: false,
    routeGuidance: '先温和承接，再用一个轻问题确认。',
  },
  {
    when: { intent: 'creative_request' },
    priority: 1,
    route: 'light_companion',
    responseLength: 'medium',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: false,
    routeGuidance: '配合创意请求，保持人设。',
  },
  {
    when: { intent: 'relationship_advice' },
    priority: 1,
    route: 'practical_support',
    responseLength: 'medium',
    shouldAskQuestion: true,
    shouldGiveAdvice: true,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '先接住困惑，再给一条温和建议。',
  },
  {
    when: { intent: 'romantic_flirt' },
    priority: 1,
    route: 'playful_flirt',
    responseLength: 'short',
    shouldAskQuestion: true,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '有节制地回应暧昧。',
  },

  // —— 高负载情绪兜底（无 intent 时仍优先接情绪）——
  {
    when: { emotion: 'sad' },
    priority: 1,
    route: 'deep_comfort',
    responseLength: 'medium',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '检测到难过：先接情绪。',
  },
  {
    when: { emotion: 'anxious' },
    priority: 1,
    route: 'calm_deescalation',
    responseLength: 'short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '检测到焦虑：先降温。',
  },
  {
    when: { emotion: 'stressed' },
    priority: 1,
    route: 'deep_comfort',
    responseLength: 'medium',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '检测到压力：先接住再谈行动。',
  },
  {
    when: { emotion: 'lonely' },
    priority: 1,
    route: 'quiet_presence',
    responseLength: 'very_short',
    shouldAskQuestion: false,
    shouldGiveAdvice: false,
    shouldUsePetName: false,
    shouldMirrorEmotion: true,
    routeGuidance: '检测到孤独：安静在场。',
  },
]

@Injectable()
export class RouteNode {
  private readonly logger = new Logger(RouteNode.name)

  async execute(
    state: CompanionState,
    _ctx: NodeExecutionContext,
  ): Promise<Partial<CompanionState>> {
    const intent = state.intent?.primary
    const emotion = state.emotion?.primaryEmotion
    const relationship = state.relationship?.stage

    const rule = this.matchRule(intent, emotion, relationship)

    if (!rule) {
      this.logger.debug(
        `[routeNode] no rule matched intent=${intent} emotion=${emotion} relationship=${relationship}`,
      )
      return { route: fallbackEmotionRoute }
    }

    this.logger.debug(
      `[routeNode] matched route=${rule.route} priority=${rule.priority} intent=${intent} emotion=${emotion}`,
    )
    const result = emotionRouteSchema.parse({
      route: rule.route,
      responseLength: rule.responseLength,
      shouldAskQuestion: rule.shouldAskQuestion,
      shouldGiveAdvice: rule.shouldGiveAdvice,
      shouldUsePetName: rule.shouldUsePetName,
      shouldMirrorEmotion: rule.shouldMirrorEmotion,
      routeGuidance: rule.routeGuidance,
    }) as RouteResult
    return { route: result }
  }

  /**
   * 分层匹配：精确三元组 > 意图+情绪 > 仅意图/仅情绪。
   * 同优先级取列表中第一条（更具体的规则写在前面）。
   */
  private matchRule(
    intent: IntentResult['primary'] | undefined,
    emotion: EmotionResult['primaryEmotion'] | undefined,
    relationship: RelationshipResult['stage'] | undefined,
  ): RouteRule | null {
    const candidates: RouteRule[] = []

    for (const r of ROUTE_RULES) {
      const w = r.when
      if (w.intent && w.intent !== intent) continue
      if (w.emotion && w.emotion !== emotion) continue
      if (w.relationship && w.relationship !== relationship) continue
      // 规则声明了字段就必须命中；全部通过则候选
      candidates.push(r)
    }

    if (candidates.length === 0) return null

    candidates.sort((a, b) => {
      // 更高 priority 优先；同 priority 时字段约束更严者优先
      if (b.priority !== a.priority) return b.priority - a.priority
      const score = (r: RouteRule) =>
        (r.when.intent ? 4 : 0) + (r.when.emotion ? 2 : 0) + (r.when.relationship ? 1 : 0)
      return score(b) - score(a)
    })

    return candidates[0] ?? null
  }
}
