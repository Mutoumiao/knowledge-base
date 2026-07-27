import { MEMORY_KEYWORD_REGEX } from '@goferbot/data/schemas'
import type { ChatPromptTemplate } from '@langchain/core/prompts'
import { Injectable, Logger } from '@nestjs/common'
import { LangChainLlmService } from '../../langchain/langchain-llm.service.js'
import { StructuredOutputService } from '../../langchain/structured-output.service.js'
import type { CompanionState, MemoryCandidate, NodeExecutionContext } from '../interfaces.js'

/** 对齐参考项目：显式记忆信号（关键词强制倾向抽取） */
const MEMORY_SIGNAL_REGEX =
  /记住|下一次|以后|下次|别再|不要再|我喜欢|我不喜欢|我讨厌|我的习惯|我的边界|我的偏好|我希望你|我以后/i

/** 独立副本，避免节点就地改写污染模块级 fallback 单例（含嵌套对象/数组） */
function cloneFallbackValue<T>(fallback: T): T {
  if (fallback == null || typeof fallback !== 'object') return fallback
  try {
    return structuredClone(fallback)
  } catch {
    // 含不可克隆值时退回一层浅拷贝
    return { ...(fallback as object) } as T
  }
}

/** 寒暄/确认短句 */
const SMALL_TALK_ONLY_REGEX =
  /^(嗯|哦|噢|好|好的+|哈哈+|谢谢|谢啦|收到|了解|行|ok|OK|早安|晚安|再见)[。.!！~～\s]*$/i

/** 敏感凭证/隐私（不得入长期记忆） */
const SENSITIVE_MEMORY_REGEX =
  /密码|验证码|身份证|银行卡|住址|手机号|电话|token|api[_\s-]?key|apikey|secret|密钥/i

/** 回忆探针：用户在问「你还记得…」，不是写入指令 */
const RECALL_PROBE_REGEX = /还记得|记得吗|记得不|记不记得|你记得我|有没有记得/

/** 显式写入指令（与「记得」区分；含「记住哦/啦」口语气） */
const MEMORY_WRITE_REGEX =
  /(?:请|希望你|帮我)?记住(?:一下|住|哦|喔|啦|哈)?(?:两件事|以下|这些)?|(?:请|希望你|帮我)记住/

/** 噪声事实：问句、探针残片、无实质指令尾 */
const NOISY_FACT_REGEX =
  /^(你还记得|还记得|记得吗|为什么|怎么|怎么样|有没有|是不是)|[？?吗呢]$|为什么|怎么样|有没有|是不是|^(两件事|以下|这些|这个|那个|记住|请记住)$/

export interface StructuredNodeConfig {
  name: string
  prompt: ChatPromptTemplate
  buildVariables: (
    state: CompanionState,
    ctx: NodeExecutionContext,
  ) => Promise<Record<string, unknown>>
}

@Injectable()
export class SharedNodeFactory {
  private readonly logger = new Logger(SharedNodeFactory.name)

  constructor(
    private readonly structuredOutputService: StructuredOutputService,
    private readonly llmService: LangChainLlmService,
  ) {}

  async invokeStructured<T>(
    schema: unknown,
    config: StructuredNodeConfig,
    fallback: T,
    state: CompanionState,
    ctx: NodeExecutionContext,
  ): Promise<T> {
    const variables = await config.buildVariables(state, ctx)
    const promptValue = await config.prompt.invoke(variables)
    const promptText = typeof promptValue === 'string' ? promptValue : JSON.stringify(promptValue)

    const started = Date.now()
    try {
      // 成功/repair 日志由 StructuredOutputService 统一打（含 method/stage），此处避免双写
      const result = await this.structuredOutputService.invokeWithFallback(
        {
          schema,
          name: config.name,
          repairBudget: ctx.structuredRepairBudget,
        } as never,
        promptText,
        ctx.signal,
      )
      this.recordStructuredStage(ctx, config.name, {
        outcome: result.outcome,
        reason: result.reason,
      })
      return result.data as T
    } catch (_err) {
      const rawMsg = _err instanceof Error ? _err.message : 'unknown'
      // 截断：禁止把 raw model content 整段塞进 obs
      const reason = rawMsg.length > 160 ? `${rawMsg.slice(0, 160)}…` : rawMsg
      this.logger.warn(
        `[${config.name}] stage=fallback outcome=fallback ms=${Date.now() - started} reason=${reason}`,
      )
      this.recordStructuredStage(ctx, config.name, { outcome: 'fallback', reason })
      // 深拷贝：禁止污染模块级 fallback 单例（含 replyExpectation / secondary 等嵌套字段）
      return cloneFallbackValue(fallback)
    }
  }

  /** O11：写入整轮共享 structuredStages（plain object，无累加器类） */
  private recordStructuredStage(
    ctx: NodeExecutionContext,
    name: string,
    record: { outcome: 'success' | 'coerced' | 'fallback'; reason?: string },
  ): void {
    if (!ctx.structuredStages) {
      ctx.structuredStages = {}
    }
    ctx.structuredStages[name] = {
      outcome: record.outcome,
      ...(record.reason ? { reason: record.reason } : {}),
    }
  }

  async invokeSimplePrompt(
    prompt: string,
    signal?: AbortSignal,
    temperature = 0.3,
  ): Promise<string> {
    return this.llmService.invoke([{ role: 'user', content: prompt }], {
      abortSignal: signal,
      temperature,
    })
  }

  /** 用户是否在做「回忆探针」（应读记忆，禁止写入） */
  isRecallProbe(text: string): boolean {
    const t = text ?? ''
    if (!RECALL_PROBE_REGEX.test(t)) return false
    // 同句若含显式「记住…」写入，不算纯探针
    if (MEMORY_WRITE_REGEX.test(t) || /记住/.test(t)) return false
    return true
  }

  /**
   * 清洗单条候选事实；噪声/问句/残片返回 null。
   * 用于 heuristic、LLM 抽取结果与落库前统一去噪。
   */
  sanitizeMemoryFact(raw: string): string | null {
    let s = (raw ?? '')
      .trim()
      .replace(/^[「『""']+|[」』""']+$/g, '')
      .replace(/\s+/g, ' ')

    // 去掉尾部无意义标点与语气助词
    s = s.replace(/[，,。.！!？?\s…]+$/g, '').replace(/[吗呢啊呀]+$/g, '').trim()

    if (s.length < 6 || s.length > 100) return null
    // 问句形态（含「为什么/怎么…吗」）
    if (/为什么|怎么[样办]|有没有|是不是|[？?]/.test(s) && !/不喜欢|不希望|不要/.test(s)) {
      return null
    }
    if (NOISY_FACT_REGEX.test(s)) return null
    if (RECALL_PROBE_REGEX.test(s) && !MEMORY_WRITE_REGEX.test(s)) return null
    if (SENSITIVE_MEMORY_REGEX.test(s)) return null
    // 指令残片 / 空话边界（无稳定偏好实体）
    if (
      /^(别|不要|请|希望)(让|再|改)?/.test(s) &&
      (s.length < 14 || /空话|别的|随便|怎样都行/.test(s))
    ) {
      return null
    }
    // 回忆探针半截（历史污染）
    if (/^你还记得|^还记得我/.test(s)) return null
    // 至少四个汉字
    if ((s.match(/[\u4e00-\u9fff]/g) ?? []).length < 4) return null
    return s
  }

  /** 批量清洗事实列表 */
  sanitizeMemoryFacts(facts: string[]): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const f of facts) {
      const clean = this.sanitizeMemoryFact(f)
      if (!clean) continue
      const key = this.normalizeMemoryContent(clean)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(clean)
      if (out.length >= 3) break
    }
    return out
  }

  shouldSkipByKeyword(text: string): boolean {
    const t = text ?? ''
    // 回忆探针禁止强制抽取（否则会污染记忆库）
    if (this.isRecallProbe(t)) return false
    return MEMORY_KEYWORD_REGEX.test(t) || MEMORY_SIGNAL_REGEX.test(t)
  }

  normalizeMemoryContent(content: string): string {
    return content.trim().replace(/\s+/g, ' ').toLowerCase()
  }

  /**
   * 从「请记住 / 希望你记住 / 我喜欢…」类用户句启发式切出候选事实。
   * 供 memory_candidate / memory_extraction 在 LLM 空结果或部分漏抽时兜底。
   */
  heuristicMemoryFacts(userText: string): string[] {
    const text = (userText ?? '').trim()
    if (!text) return []
    if (this.isRecallProbe(text)) return []

    const facts: string[] = []

    // 「记住…：A；B」/「记住哦：…」/「记住两件事：第一…第二…」
    const rememberMatch = text.match(
      /(?:请|希望你|帮我)?记住(?:一下|住|哦|喔|啦|哈)?(?:两件事|以下|这些)?[：:，,\s]*(.+)$/s,
    )
    const body = rememberMatch?.[1]?.trim() || text

    // 分号/句号/第一第二/以及/还有；「另外/此外」仅在标点或空白后切分，避免「换另外一份」误切
    const chunks = body
      .split(
        /(?:[;；。！？\n]|第一[，,、]?|第二[，,、]?|第三[，,、]?|以及|还有|(?<=[;；，,。！？\s])(?:另外|此外|再者))/,
      )
      .map((s) =>
        s
          .replace(/^(?:希望你|请|帮我)?记住(?:一下|住|哦|喔|啦|哈)?/g, '')
          .replace(/^(?:第一|第二|第三)[，,、\s]*/g, '')
          .replace(/^(?:另外|此外|再者)[，,、\s]*/g, '')
          .replace(/^(?:是|：|:|，|,)\s*/g, '')
          .trim(),
      )
      .filter((s) => s.length >= 4 && s.length <= 100)

    for (const c of chunks) {
      if (/^(两件事|以下|这些|这个)$/.test(c)) continue
      const clean = this.sanitizeMemoryFact(c)
      if (clean && !facts.includes(clean)) facts.push(clean)
      if (facts.length >= 3) break
    }

    // 偏好句整句保留（较短时）
    if (facts.length === 0 && this.shouldSkipByKeyword(text) && text.length <= 100) {
      const whole = this.sanitizeMemoryFact(text)
      if (whole) facts.push(whole)
    }

    return facts.slice(0, 3)
  }

  /**
   * 覆盖判定用轻量归一：去掉「用户/我/你」主语与礼貌前缀，便于近义偏好去重。
   * 例：用户讨厌空话安慰 ≈ 我讨厌空话安慰
   */
  softNormalizeMemoryContent(content: string): string {
    return this.normalizeMemoryContent(content)
      .replace(/^(用户|我|你)+/g, '')
      .replace(/^(希望你|请你|请|帮我)+/g, '')
      .replace(/[的了呢吧啊呀\s]/g, '')
  }

  /**
   * 新事实是否已被已有内容覆盖（全等 / 子串近似 / 软归一近义）。
   */
  isMemoryContentCovered(content: string, existingNormalized: Iterable<string>): boolean {
    const key = this.normalizeMemoryContent(content)
    if (!key) return true
    const softKey = this.softNormalizeMemoryContent(content)
    for (const old of existingNormalized) {
      if (!old) continue
      if (old === key) return true
      if (old.includes(key) || key.includes(old)) {
        if (Math.abs(old.length - key.length) <= 8) return true
      }
      // 近义：主语/前缀不同但核心相同（pad 时避免「用户…」占坑挤掉第二事实）
      const softOld = this.softNormalizeMemoryContent(old)
      if (softKey && softOld && softKey === softOld) return true
      if (softKey.length >= 6 && softOld.length >= 6) {
        if (softOld.includes(softKey) || softKey.includes(softOld)) {
          if (Math.abs(softOld.length - softKey.length) <= 6) return true
        }
      }
    }
    return false
  }

  /**
   * 规则快速跳过（对齐 ai-partner-agent shouldSkipMemoryCandidateFast）。
   * 返回候选对象表示跳过 LLM；返回 null 表示进入候选 LLM / 关键词 fallback。
   */
  shouldSkipMemoryCandidateFast(params: {
    userText: string
    assistantText?: string
    existingMemories?: Array<{ content: string }>
  }): MemoryCandidate | null {
    const userText = (params.userText ?? '').trim()
    const assistantText = (params.assistantText ?? '').trim()

    if (!userText) {
      return {
        shouldExtract: false,
        confidence: 0.95,
        category: 'unclear',
        stability: 'unclear',
        importance: 0,
        reason: '用户消息为空，跳过长期记忆候选。',
        candidateFacts: [],
      }
    }

    // 回忆探针：只读不写
    if (this.isRecallProbe(userText)) {
      return {
        shouldExtract: false,
        confidence: 0.97,
        category: 'unclear',
        stability: 'unclear',
        importance: 0,
        reason: '用户在询问是否记得既有信息（回忆探针），禁止写入新记忆。',
        candidateFacts: [],
      }
    }

    // 助手尚未生成时（管线顺序上 candidate 在 generate 后，通常有 reply）仍允许继续
    if (
      userText.length < 6 &&
      !MEMORY_SIGNAL_REGEX.test(userText) &&
      !MEMORY_KEYWORD_REGEX.test(userText)
    ) {
      return {
        shouldExtract: false,
        confidence: 0.88,
        category: 'small_talk',
        stability: 'temporary',
        importance: 0,
        reason: '用户消息过短且无明确记忆信号，判定为寒暄或临时内容。',
        candidateFacts: [],
      }
    }

    if (SMALL_TALK_ONLY_REGEX.test(userText)) {
      return {
        shouldExtract: false,
        confidence: 0.92,
        category: 'small_talk',
        stability: 'temporary',
        importance: 0,
        reason: '寒暄、确认或告别类短句，不适合作为长期记忆。',
        candidateFacts: [],
      }
    }

    const normalizedUserText = this.normalizeMemoryContent(userText)
    const existing = params.existingMemories ?? []
    if (existing.some((m) => this.normalizeMemoryContent(m.content) === normalizedUserText)) {
      return {
        shouldExtract: false,
        confidence: 0.9,
        category: 'duplicate',
        stability: 'stable',
        importance: 0,
        reason: '用户消息与已有长期记忆完全重复，无需再次抽取。',
        candidateFacts: [normalizedUserText.slice(0, 120)],
      }
    }

    if (SENSITIVE_MEMORY_REGEX.test(userText)) {
      return {
        shouldExtract: false,
        confidence: 0.96,
        category: 'unsafe',
        stability: 'stable',
        importance: 0,
        reason: '内容疑似包含敏感隐私或凭证信息，不进入长期记忆。',
        candidateFacts: [],
      }
    }

    // assistant 为空不强制跳过（兼容部分测试路径）
    void assistantText
    return null
  }

  /**
   * 仅内容强信号时返回 type；无把握返回 null，交由 LLM type / default。
   * 落库路径应优先本方法，避免「永远 infer 成 important_fact」压扁 LLM 分类。
   */
  inferStrongMemoryTypeFromContent(
    content: string,
  ):
    | 'preference'
    | 'boundary'
    | 'relationship_goal'
    | 'conversation_style'
    | 'important_fact'
    | null {
    const c = (content ?? '').trim()
    if (!c) return null
    if (/边界|别再|不要再|不希望你|禁止|讨厌你(?:这样|那样)?/.test(c)) return 'boundary'
    // 生活事实强信号：加班/失眠/跳槽等优先于弱偏好词，避免整句误标 preference
    const factStrong =
      /加班|失眠|睡不着|跳槽|压力很大|准备跳槽|见家长|见客户|被领导|放鸽子|心情差/.test(c)
    const prefStrong =
      /更喜欢|希望你|偏好|先.*再|回应|复述|听感受|先被哄|别贫|别空话|讨厌空话|先哄/.test(c)
    if (factStrong && !prefStrong) return 'important_fact'
    if (
      /更喜欢|希望你|偏好|先.*再|回应|复述|听感受|先被哄|别贫|别空话|讨厌空话|说话方式|语气|先哄/.test(
        c,
      )
    ) {
      if (/说话方式|语气|风格/.test(c) && !/希望你|更喜欢|偏好|先哄/.test(c)) {
        return 'conversation_style'
      }
      return 'preference'
    }
    if (/说话方式|语气|风格/.test(c)) return 'conversation_style'
    if (/关系|我们.*一直|长期.*目标/.test(c) && /目标|希望|想要/.test(c)) {
      return 'relationship_goal'
    }
    return null
  }

  /**
   * 按内容推断记忆类型（含默认 important_fact）。
   * 注入/展示纠偏可用；落库请优先 `inferStrongMemoryTypeFromContent` + LLM type。
   */
  inferMemoryTypeFromContent(
    content: string,
  ): 'preference' | 'boundary' | 'relationship_goal' | 'conversation_style' | 'important_fact' {
    return this.inferStrongMemoryTypeFromContent(content) ?? 'important_fact'
  }

  /** 是否「偏好/边界/风格」类（含 type 误标时按内容纠偏） */
  private isPreferenceLikeMemory(m: { content: string; type?: string }): boolean {
    const inferred = this.inferMemoryTypeFromContent(m.content)
    if (inferred === 'preference' || inferred === 'boundary' || inferred === 'conversation_style') {
      return true
    }
    if (
      m.type === 'preference' ||
      m.type === 'boundary' ||
      m.type === 'conversation_style'
    ) {
      // type=preference 但内容像生活事实 → 不当作偏好
      return inferred !== 'important_fact'
    }
    return false
  }

  /**
   * 按与当前用户消息的相关度 + 重要度排序记忆，相关项靠前便于 generate 自然引用。
   * 回忆探针且用户提到「偏好/回应」时：偏好类记忆固定优先，避免被「最近/失眠」等事实词吸走。
   */
  rankMemoriesForPrompt<T extends { content: string; importance: number; type?: string }>(
    memories: T[] | undefined,
    userMessage?: string,
  ): T[] {
    if (!memories || memories.length === 0) return []
    const msg = (userMessage ?? '').toLowerCase()
    const isProbe = this.isRecallProbe(userMessage ?? '')
    const prefSignal = /偏好|回应|希望你|喜欢你|怎么.*回|先.*感受|复述/.test(userMessage ?? '')
    const tokens = msg
      .replace(/[^\u4e00-\u9fffa-z0-9]/gi, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2)

    const scored = [...memories].map((m) => {
      const c = m.content.toLowerCase()
      let overlap = 0
      for (const t of tokens) {
        if (t.length >= 2 && c.includes(t)) overlap += t.length >= 4 ? 3 : 1.5
      }
      // 中文双字/三字滑窗（相关度权重大于 importance，避免无关高重要度霸榜）
      for (let i = 0; i < msg.length - 1; i++) {
        const bigram = msg.slice(i, i + 2)
        if (/[\u4e00-\u9fff]{2}/.test(bigram) && c.includes(bigram)) overlap += 2
        const tri = msg.slice(i, i + 3)
        if (/[\u4e00-\u9fff]{3}/.test(tri) && c.includes(tri)) overlap += 3
      }
      let score = overlap * 3 + m.importance
      if (isProbe || prefSignal) {
        if (this.isPreferenceLikeMemory(m)) score += 12
        if (/喜欢|希望你|偏好|先.*再|复述|感受|回应/.test(m.content)) score += 6
        if (isProbe) score += 2
      }
      return { m, score, prefLike: this.isPreferenceLikeMemory(m) }
    })

    scored.sort((a, b) => {
      // 探针 + 偏好信号：偏好类排在生活事实前（L1 MEM-R 多要点覆盖）
      if (isProbe && prefSignal && a.prefLike !== b.prefLike) {
        return a.prefLike ? -1 : 1
      }
      return b.score - a.score
    })
    return scored.map((x) => x.m)
  }

  /**
   * 注入前过滤历史噪声记忆（问句/探针残片），避免旧污染继续影响 generate。
   */
  filterInjectableMemories<T extends { content: string; importance: number }>(
    memories: T[] | undefined,
  ): T[] {
    if (!memories?.length) return []
    return memories.filter((m) => this.sanitizeMemoryFact(m.content) !== null)
  }

  formatMemoriesForPrompt(
    memories: Array<{ content: string; importance: number; type?: string }> | undefined,
    userMessage?: string,
  ): string {
    const cleaned = this.filterInjectableMemories(memories)
    const ranked = this.rankMemoriesForPrompt(cleaned, userMessage)
    if (ranked.length === 0) return '（暂无）'
    return ranked
      .map((m) => {
        const typeLabel = m.type?.trim() || this.inferMemoryTypeFromContent(m.content)
        // type 若被误标为 preference 但内容像生活事实，展示时用推断类型，便于模型区分
        const displayType =
          typeLabel === 'preference' && this.inferMemoryTypeFromContent(m.content) === 'important_fact'
            ? 'important_fact'
            : typeLabel
        return `- [${displayType}|重要度${m.importance}] ${m.content}`
      })
      .join('\n')
  }

  formatMessagesForPrompt(messages: Array<{ role: string; content: string }> | undefined): string {
    if (!messages || messages.length === 0) return '（暂无）'
    return messages.map((m) => `[${m.role}]: ${m.content}`).join('\n')
  }
}
