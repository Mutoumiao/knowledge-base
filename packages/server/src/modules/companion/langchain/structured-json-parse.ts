import type { z } from 'zod'

/** 有限字段别名：历史漂移兼容；prompt 权威仍为 Zod 字段名 */
export const STRUCTURED_FIELD_ALIASES: Record<string, string> = {
  safetyClassification: 'safetyLevel',
  safety_classification: 'safetyLevel',
  safety_level: 'safetyLevel',
  boundary_action: 'boundaryAction',
  response_guidance: 'responseGuidance',
  allow_memory_extraction: 'allowMemoryExtraction',
  primary_emotion: 'primaryEmotion',
  secondary_emotions: 'secondaryEmotions',
  emotional_cue: 'emotionalCue',
  reply_tone: 'replyTone',
  needs_comfort: 'needsComfort',
  needs_deescalation: 'needsDeescalation',
  needs_clarification: 'needsClarification',
  should_extract: 'shouldExtract',
  candidate_facts: 'candidateFacts',
  display_name: 'displayName',
  closeness_score: 'closenessScore',
  trust_level: 'trustLevel',
  boundary_mode: 'boundaryMode',
  intimacy_permission: 'intimacyPermission',
  risk_signals: 'riskSignals',
  relationship_guidance: 'relationshipGuidance',
  prompt_guidance: 'promptGuidance',
  clarifying_question: 'clarifyingQuestion',
  should_clarify: 'shouldClarify',
  user_need: 'userNeed',
  requested_agent_action: 'requestedAgentAction',
  relationship_signal: 'relationshipSignal',
  reply_expectation: 'replyExpectation',
}

/**
 * 有限 enum 值别名 → 合法字面量。
 * 仅命中本表记 coerced；未知字符串不得静默映射（交给 Zod 失败 → repair/fallback）。
 * 键统一小写比对。
 */
export const ENUM_VALUE_ALIASES: Record<string, Record<string, string>> = {
  primary: {
    chat: 'casual_chat',
    small_talk: 'casual_chat',
    smalltalk: 'casual_chat',
    idle: 'casual_chat',
    greeting: 'casual_chat',
    support: 'emotional_support',
    comfort: 'emotional_support',
    vent: 'emotional_support',
    emotional: 'emotional_support',
    emotion_support: 'emotional_support',
    advice: 'relationship_advice',
    relationship: 'relationship_advice',
    dating_advice: 'relationship_advice',
    flirt: 'romantic_flirt',
    romance: 'romantic_flirt',
    romantic: 'romantic_flirt',
    flirting: 'romantic_flirt',
    presence: 'companionship_presence',
    companionship: 'companionship_presence',
    company: 'companionship_presence',
    be_with: 'companionship_presence',
    role_play: 'roleplay',
    'role-play': 'roleplay',
    role_playing: 'roleplay',
    rp: 'roleplay',
    life: 'life_sharing',
    share: 'life_sharing',
    sharing: 'life_sharing',
    daily: 'life_sharing',
    memory: 'memory_update',
    remember: 'memory_update',
    memory_write: 'memory_update',
    preference: 'preference_setting',
    preferences: 'preference_setting',
    set_preference: 'preference_setting',
    feedback: 'agent_feedback',
    agent_fb: 'agent_feedback',
    repair: 'conversation_repair',
    misunderstanding: 'conversation_repair',
    fix: 'conversation_repair',
    plan: 'date_or_activity_planning',
    planning: 'date_or_activity_planning',
    activity: 'date_or_activity_planning',
    creative: 'creative_request',
    create: 'creative_request',
    meta: 'meta_question',
    about_you: 'meta_question',
    self: 'meta_question',
    unknown: 'unclear',
    other: 'unclear',
    none: 'unclear',
  },
  userNeed: {
    comfort: 'be_comforted',
    comforted: 'be_comforted',
    heard: 'be_heard',
    listen: 'be_heard',
    advice: 'get_advice',
    draft: 'get_reply_draft',
    reply_draft: 'get_reply_draft',
    play: 'play_along',
    play_along: 'play_along',
    connected: 'feel_connected',
    connection: 'feel_connected',
    boundary: 'set_boundary',
    memory: 'update_memory',
    remember: 'update_memory',
    adjust: 'adjust_agent',
    agent: 'adjust_agent',
  },
  requestedAgentAction: {
    answer: 'answer_directly',
    direct: 'answer_directly',
    comfort: 'comfort_first',
    ask: 'ask_follow_up',
    follow_up: 'ask_follow_up',
    draft: 'draft_message',
    analyze: 'analyze_situation',
    analysis: 'analyze_situation',
    roleplay: 'roleplay_response',
    role_play: 'roleplay_response',
    remember: 'remember_fact',
    memory: 'remember_fact',
    adjust: 'adjust_style',
    style: 'adjust_style',
    repair: 'repair_misunderstanding',
    continue: 'continue_topic',
  },
  // 次要：secondary 数组元素与 primary 共用同一 alias 表
  // safety / emotion 常见乱写（有限）
  safetyLevel: {
    ok: 'safe',
    normal: 'safe',
    warn: 'caution',
    warning: 'caution',
    careful: 'caution',
    blocked: 'block',
    // 不映射 stop/danger/emergency：多义词，易把 caution/block 误抬到 crisis
  },
  boundaryAction: {
    go: 'continue',
    ok: 'continue',
    soft: 'soft_boundary',
    soft_refuse: 'soft_boundary',
    refuse_soft: 'soft_boundary',
    redir: 'redirect',
    deny: 'refuse',
    reject: 'refuse',
    crisis: 'crisis_support',
    hotline: 'crisis_support',
  },
  primaryEmotion: {
    sadness: 'sad',
    happiness: 'happy',
    joy: 'happy',
    anxiety: 'anxious',
    anger: 'angry',
    stress: 'stressed',
    loneliness: 'lonely',
    confusion: 'confused',
    affection: 'affectionate',
    play: 'playful',
    tiredness: 'tired',
  },
}

/** 与 primary 共用 alias 的字段 */
const PRIMARY_LIKE_FIELDS = new Set(['primary', 'secondary'])

function normalizeAliasKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * 对对象中已知 enum 字段做有限值映射。
 * @returns coerced=true 仅当至少一次值被改写；reasons 形如 invalid_enum:primary
 */
export function applyEnumValueCoerce(input: Record<string, unknown>): {
  value: Record<string, unknown>
  coerced: boolean
  reasons: string[]
} {
  const out: Record<string, unknown> = { ...input }
  const reasons: string[] = []
  let coerced = false

  const coerceScalar = (field: string, raw: unknown): unknown => {
    if (typeof raw !== 'string') return raw
    const table =
      ENUM_VALUE_ALIASES[field] ??
      (PRIMARY_LIKE_FIELDS.has(field) ? ENUM_VALUE_ALIASES.primary : undefined)
    if (!table) return raw
    const key = normalizeAliasKey(raw)
    // 已是合法字面量（表值侧）则不改
    const canonicalValues = new Set(Object.values(table))
    if (canonicalValues.has(raw) || canonicalValues.has(key)) {
      // 若模型写了合法值的大小写变体且 key 能命中 value set 中的 key 形式
      if (canonicalValues.has(raw)) return raw
      if (canonicalValues.has(key) && key !== raw) {
        coerced = true
        reasons.push(`invalid_enum:${field}`)
        return key
      }
      return raw
    }
    const mapped = table[key]
    if (mapped != null && mapped !== raw) {
      coerced = true
      reasons.push(`invalid_enum:${field}`)
      return mapped
    }
    return raw
  }

  for (const field of Object.keys(ENUM_VALUE_ALIASES)) {
    if (!(field in out)) continue
    out[field] = coerceScalar(field, out[field])
  }

  // secondary 不在 ENUM_VALUE_ALIASES keys，走 primary 表逐项 coerce
  if (Array.isArray(out.secondary)) {
    out.secondary = (out.secondary as unknown[]).map((item) => coerceScalar('primary', item))
  }

  return { value: out, coerced, reasons: [...new Set(reasons)] }
}

export function stripMarkdownFence(text: string): string {
  let t = text.trim()
  const fullFence = t.match(/^```(?:json|JSON)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/)
  if (fullFence?.[1] != null) return fullFence[1].trim()
  t = t.replace(/^```(?:json|JSON)?\s*\r?\n?/, '')
  t = t.replace(/\r?\n?```\s*$/, '')
  return t.trim()
}

/**
 * 截取第一个括号平衡的 `{...}`。
 * 无法平衡时返回 null（禁止静默半截成功）。
 */
export function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function applyFieldAliases(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const mapped = STRUCTURED_FIELD_ALIASES[key] ?? key
    // 已有规范字段时不覆盖
    if (mapped in out && key !== mapped) continue
    out[mapped] = value
  }
  return out
}

/**
 * D11：按节点策略缺省。
 * - safety：禁止对关键安全字段乐观补全
 * - memory_candidate：允许薄输出补全
 * - memory_extraction：允许空 memories
 * - intent/emotion/relationship：仅技术性空数组，不瞎补业务 enum
 */
export function applyNodeDefaults(
  nodeName: string,
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const name = nodeName.toLowerCase()
  const next = { ...obj }

  if (name.includes('safetynode') || name === 'safety') {
    // 禁止乐观补全 safetyLevel / category / boundaryAction / allowMemoryExtraction
    return next
  }

  if (name.includes('memorycandidate') || name.includes('memory_candidate')) {
    if (typeof next.shouldExtract !== 'boolean') {
      // 无法判断时不补业务含义，留给 Zod 失败
      return next
    }
    if (next.shouldExtract === false) {
      // 薄输出：不抽取路径允许业务缺省，保证 Zod 可通过
      if (typeof next.confidence !== 'number') next.confidence = 0.85
      if (typeof next.category !== 'string') next.category = 'unclear'
      if (typeof next.stability !== 'string') next.stability = 'unclear'
      if (typeof next.importance !== 'number') next.importance = 0
      if (typeof next.reason !== 'string') next.reason = '模型未给出详细理由，按不抽取处理。'
      if (!Array.isArray(next.candidateFacts)) next.candidateFacts = []
    } else {
      // shouldExtract true：只补技术字段（空 facts），业务 enum/置信度交给模型或 Zod 失败
      if (!Array.isArray(next.candidateFacts)) next.candidateFacts = []
    }
    return next
  }

  if (name.includes('memoryextraction') || name.includes('memory_extraction')) {
    if (!Array.isArray(next.memories)) next.memories = []
    return next
  }

  if (name.includes('intent')) {
    if (!Array.isArray(next.secondary)) next.secondary = []
    return next
  }

  if (name.includes('emotion')) {
    if (!Array.isArray(next.secondaryEmotions)) next.secondaryEmotions = []
    return next
  }

  if (name.includes('relationship')) {
    if (!Array.isArray(next.riskSignals)) next.riskSignals = []
    return next
  }

  return next
}

export function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  if (content == null) return ''
  return JSON.stringify(content)
}

export type StructuredOutcome = 'success' | 'coerced' | 'fallback'

export type ParseStructuredJsonResult<T> =
  | { ok: true; data: T; coerced: boolean; coerceReasons?: string[] }
  | { ok: false; error: string; stage: 'empty' | 'extract' | 'json' | 'zod' }

/**
 * 纯函数解析管线：去 fence → 括号平衡 → JSON.parse → 字段别名（静默）→ enum 值 coerce → 节点缺省 → Zod
 * coerced **仅** enum 值 map 触发；字段名别名不置位。
 */
export function parseStructuredJson<T>(
  raw: string,
  schema: z.ZodSchema<T>,
  nodeName: string,
): ParseStructuredJsonResult<T> {
  const cleaned = stripMarkdownFence(raw ?? '')
  if (!cleaned.trim()) {
    return { ok: false, error: 'empty content', stage: 'empty' }
  }

  // 无括号平衡对象时失败（禁止静默半截成功）
  const candidate = extractBalancedJsonObject(cleaned)
  if (!candidate) {
    return {
      ok: false,
      error: cleaned.includes('{')
        ? 'unbalanced or truncated JSON object'
        : 'no JSON object found',
      stage: 'extract',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'JSON.parse failed',
      stage: 'json',
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'JSON root must be object', stage: 'json' }
  }

  const withAliases = applyFieldAliases(parsed as Record<string, unknown>)
  const { value: withEnums, coerced, reasons } = applyEnumValueCoerce(withAliases)
  const withDefaults = applyNodeDefaults(nodeName, withEnums)
  const result = schema.safeParse(withDefaults)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { ok: false, error: issues || 'zod validation failed', stage: 'zod' }
  }
  return {
    ok: true,
    data: result.data,
    coerced,
    coerceReasons: coerced ? reasons : undefined,
  }
}
