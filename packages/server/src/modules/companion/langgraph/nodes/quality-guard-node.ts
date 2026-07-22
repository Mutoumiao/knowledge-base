import { fallbackReplyQualityGuard, replyQualityGuardSchema } from '@goferbot/data/schemas'
import { Injectable, Logger } from '@nestjs/common'
import type { CompanionState, NodeExecutionContext, QualityGuardResult } from '../interfaces.js'
import { collapseRepeatedReply, ensureCrisisHotlineInReply } from '../reply-text.util.js'

const FORBIDDEN_PATTERNS: Array<{
  code: QualityGuardResult['violations'][number]['code']
  pattern: RegExp
  severity: QualityGuardResult['violations'][number]['severity']
}> = [
  {
    code: 'internal_label_leak',
    pattern: /(意图判断|情绪识别|关系阶段|策略路由|回复策略包|记忆候选|安全边界)/g,
    severity: 'high',
  },
  {
    code: 'forbidden_lecture',
    pattern: /(你应该|你必须|你要知道|这都是因为|你总是|你从来|你根本)/g,
    severity: 'medium',
  },
  {
    code: 'forbidden_premature_advice',
    pattern: /(我建议你|你应该试试|你最好|试试这样|建议你|最好别|最好去)/g,
    severity: 'medium',
  },
  {
    code: 'forbidden_diagnosis',
    pattern: /(你这是|你得了|你属于|典型的|就是太|你有.*(倾向|问题|障碍))/g,
    severity: 'high',
  },
  {
    code: 'forbidden_real_world_promise',
    pattern: /(我会去找你|我会陪你去|我会打电话|我会出现在|我帮你联系|我去找)/g,
    severity: 'high',
  },
  {
    code: 'breaks_immersion',
    pattern: /(作为一个AI|我是一个AI|根据我的程序|我的算法|系统提示|我被设置|我的开发者)/g,
    severity: 'high',
  },
  {
    code: 'forbidden_over_explain',
    pattern: /(首先|其次|最后|原因是由于|这是因为|让我解释一下|我来详细说说)/g,
    severity: 'low',
  },
  {
    code: 'forbidden_intense_flirt',
    pattern: /(宝贝|亲爱的|我好想你|喜欢你|爱你|想抱抱|亲亲)/g,
    severity: 'medium',
  },
  {
    code: 'forbidden_aggressive_siding',
    pattern: /(你完全没错|全是他的错|他就是个|别理他|这种人就该|你做得对极了)/g,
    severity: 'medium',
  },
  {
    code: 'forbidden_pressure',
    pattern: /(你必须|你一定要|现在就|立刻|马上|你再不|你就不能)/g,
    severity: 'medium',
  },
]

const ADVICE_SENTENCE_REGEX = /建议|应该|最好|试试|不妨|可以试|推荐你/
const PRESENCE_FALLBACK: Record<string, string> = {
  quiet_presence: '我在这儿。',
  deep_comfort: '我在听。你不用急着说，我陪你。',
  calm_deescalation: '我在。先慢慢来，不着急。',
  relationship_repair: '刚才没接好，对不起。你愿意再跟我说说吗？',
}

@Injectable()
export class QualityGuardNode {
  private readonly logger = new Logger(QualityGuardNode.name)

  async execute(
    state: CompanionState,
    _ctx: NodeExecutionContext,
  ): Promise<Partial<CompanionState>> {
    const original = state.assistantReply
    if (!original) {
      return { quality: fallbackReplyQualityGuard as QualityGuardResult }
    }

    let reply = original
    const adviceLimit = state.policy?.adviceLimit ?? 1
    const questionLimit = state.policy?.questionLimit ?? 2
    const maxSentences = state.policy?.sentenceBudget?.max ?? 4
    const listenFirstRoutes = new Set([
      'deep_comfort',
      'calm_deescalation',
      'quiet_presence',
      'relationship_repair',
    ])
    const route = state.route?.route
    const forceListenFirst = route ? listenFirstRoutes.has(route) : false

    // —— 软修复（G-QL-01）：观测之外，对「先接后推」违规做规则修复 ——
    let repaired = false

    // 1) 破除沉浸：直接换安全兜底
    if (/(作为一个AI|我是一个AI|根据我的程序|我的算法|系统提示)/.test(reply)) {
      reply = PRESENCE_FALLBACK[route ?? ''] ?? '嗯，我在听。你可以慢慢说。'
      repaired = true
    }

    // 2) 禁止建议时剥掉建议句
    if (adviceLimit === 0 || forceListenFirst) {
      const stripped = this.stripAdviceSentences(reply)
      if (stripped !== reply && stripped.trim().length >= 4) {
        reply = stripped
        repaired = true
      }
    }

    // 3) 问题过多：只保留前 questionLimit 个问句，其余去问号改陈述或删除
    if (questionLimit === 0) {
      const noQ = this.stripQuestions(reply)
      if (noQ !== reply && noQ.trim().length >= 4) {
        reply = noQ
        repaired = true
      }
    } else if (questionLimit > 0) {
      const limited = this.limitQuestions(reply, questionLimit)
      if (limited !== reply) {
        reply = limited
        repaired = true
      }
    }

    // 4) 句数超预算：截断
    const sentences = this.splitSentences(reply)
    if (sentences.length > maxSentences) {
      reply = sentences.slice(0, maxSentences).join('')
      repaired = true
    }

    // 5) 先接后推：首句若是建议，与次句交换或插入承接
    if (forceListenFirst && adviceLimit === 0) {
      const fixed = this.ensureListenFirstOpening(reply, state.userMessage)
      if (fixed !== reply) {
        reply = fixed
        repaired = true
      }
    }

    reply = collapseRepeatedReply(reply.trim())
    if (!reply) {
      reply = PRESENCE_FALLBACK[route ?? ''] ?? '嗯嗯，我在听。'
      repaired = true
    }
    const withHotline = ensureCrisisHotlineInReply(reply, state.safety, state.userMessage)
    if (withHotline !== reply) {
      reply = withHotline
      repaired = true
    }

    // —— 对（可能已修复的）文本再计违规 ——
    const finalSentences = this.splitSentences(reply)
    const sentenceCount = finalSentences.length
    const questionCount = finalSentences.filter((s) => /[？?]$/.test(s.trim())).length
    const adviceCount = finalSentences.filter((s) => ADVICE_SENTENCE_REGEX.test(s)).length

    const violations: QualityGuardResult['violations'] = []

    if (sentenceCount > 4) {
      violations.push({
        code: 'too_many_sentences',
        severity: 'medium',
        evidence: `当前回复共 ${sentenceCount} 句，超过建议上限 4 句。`,
      })
    }
    if (questionCount > 2) {
      violations.push({
        code: 'too_many_questions',
        severity: 'medium',
        evidence: `当前回复共 ${questionCount} 个问题，超过建议上限 2 个。`,
      })
    }
    if (adviceCount > 1) {
      violations.push({
        code: 'too_many_suggestions',
        severity: 'low',
        evidence: `当前回复含 ${adviceCount} 个建议，建议上限为 1 个。`,
      })
    }

    for (const { code, pattern, severity } of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0
      const match = pattern.exec(reply)
      if (match) {
        violations.push({
          code,
          severity,
          evidence: `命中模式: "${match[0]}"`,
        })
      }
    }

    const hasHigh = violations.some((v) => v.severity === 'high')
    const hasMedium = violations.some((v) => v.severity === 'medium')
    const score = Math.max(0, 1 - violations.length * 0.15)
    const status = hasHigh ? 'fail' : hasMedium ? 'warn' : 'pass'

    const result = replyQualityGuardSchema.parse({
      status,
      score,
      sentenceCount,
      questionCount,
      adviceCount,
      violations: violations.slice(0, 12),
    })

    this.logger.debug(
      `[qualityGuardNode] status=${status} violations=${violations.length} repaired=${repaired}`,
    )

    const patch: Partial<CompanionState> = { quality: result }
    if (repaired && reply !== original) {
      // 只改 assistantReply，禁止再写 partialTokens：
      // 否则 stream 会把「修复后全文」当第二段 delta 拼出近乎双份的回复（裁判 P0）。
      patch.assistantReply = reply
      patch.lastFallback = 'quality-soft-repair'
    }
    return patch
  }

  private splitSentences(text: string): string[] {
    return text
      .split(/(?<=[。！？!?\n])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  private stripAdviceSentences(text: string): string {
    const kept = this.splitSentences(text).filter((s) => !ADVICE_SENTENCE_REGEX.test(s))
    if (kept.length === 0) return text
    return kept.join('')
  }

  private stripQuestions(text: string): string {
    return this.splitSentences(text)
      .map((s) => s.replace(/[？?]+$/g, '。'))
      .join('')
  }

  private limitQuestions(text: string, maxQ: number): string {
    let q = 0
    return this.splitSentences(text)
      .map((s) => {
        if (/[？?]$/.test(s.trim())) {
          q += 1
          if (q > maxQ) return s.replace(/[？?]+$/g, '。')
        }
        return s
      })
      .join('')
  }

  /**
   * 若首句像建议/清单，尝试把镜像句提前；无镜像时用轻量承接前缀。
   */
  private ensureListenFirstOpening(text: string, userMessage: string): string {
    const sentences = this.splitSentences(text)
    if (sentences.length === 0) return text
    const first = sentences[0] ?? ''
    if (!ADVICE_SENTENCE_REGEX.test(first) && !/^(首先|第一|建议|你可以)/.test(first)) {
      return text
    }
    // 找后续非建议句提前
    const mirrorIdx = sentences.findIndex(
      (s, i) => i > 0 && !ADVICE_SENTENCE_REGEX.test(s) && s.length >= 4,
    )
    if (mirrorIdx > 0) {
      const reordered = [sentences[mirrorIdx], ...sentences.filter((_, i) => i !== mirrorIdx)]
      return reordered.join('')
    }
    // 注入轻量承接
    const snippet = (userMessage ?? '').replace(/\s+/g, '').slice(0, 12)
    const prefix =
      snippet.length >= 4
        ? `我听到你说${snippet}${snippet.length >= 12 ? '…' : ''}。`
        : '我在听，先把你说的接住。'
    // 去掉原建议首句
    const rest = sentences.slice(1).join('')
    return `${prefix}${rest || '你愿意的话，我们可以慢慢说。'}`
  }
}
