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

export type ParseStructuredJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; stage: 'empty' | 'extract' | 'json' | 'zod' }

/**
 * 纯函数解析管线：去 fence → 括号平衡 → JSON.parse → 别名 → 节点缺省 → Zod
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
  const withDefaults = applyNodeDefaults(nodeName, withAliases)
  const result = schema.safeParse(withDefaults)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { ok: false, error: issues || 'zod validation failed', stage: 'zod' }
  }
  return { ok: true, data: result.data }
}
