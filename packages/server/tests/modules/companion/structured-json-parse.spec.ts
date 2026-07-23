import {
  conversationSafetySchema,
  conversationIntentSchema,
  agentMemoryCandidateSchema,
} from '@goferbot/data/schemas'
import { describe, expect, it } from 'vitest'
import {
  applyEnumValueCoerce,
  applyFieldAliases,
  extractBalancedJsonObject,
  parseStructuredJson,
  stripMarkdownFence,
} from '@/modules/companion/langchain/structured-json-parse.js'

describe('structured-json-parse', () => {
  it('strips markdown fence', () => {
    expect(stripMarkdownFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripMarkdownFence('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('extracts balanced object and rejects truncated', () => {
    expect(extractBalancedJsonObject('noise {"a":1} trailing')).toBe('{"a":1}')
    expect(extractBalancedJsonObject('{')).toBeNull()
    expect(extractBalancedJsonObject('{"a":')).toBeNull()
    expect(extractBalancedJsonObject('{"a":{"b":1}')).toBeNull()
  })

  it('maps safetyClassification alias to safetyLevel then Zod passes (field alias ≠ coerced)', () => {
    const raw = JSON.stringify({
      safetyClassification: 'safe',
      category: 'normal',
      boundaryAction: 'continue',
      reason: 'ok',
      responseGuidance: 'n/a',
      allowMemoryExtraction: true,
    })
    const result = parseStructuredJson(raw, conversationSafetySchema, 'safetyNode')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.safetyLevel).toBe('safe')
      expect(result.coerced).toBe(false)
    }
  })

  it('applyFieldAliases does not overwrite existing canonical field', () => {
    const out = applyFieldAliases({
      safetyLevel: 'crisis',
      safetyClassification: 'safe',
    })
    expect(out.safetyLevel).toBe('crisis')
  })

  it('fence + valid JSON parses', () => {
    const raw = '```json\n{"safetyLevel":"caution","category":"other","boundaryAction":"soft_boundary","reason":"r","responseGuidance":"g","allowMemoryExtraction":false}\n```'
    const result = parseStructuredJson(raw, conversationSafetySchema, 'safetyNode')
    expect(result.ok).toBe(true)
  })

  it('truncated object fails without silent half-success', () => {
    const result = parseStructuredJson('{', conversationSafetySchema, 'safetyNode')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.stage).toBe('extract')
    }
  })

  it('safety does not optimistic-default missing critical fields', () => {
    const result = parseStructuredJson(
      JSON.stringify({ reason: 'only reason' }),
      conversationSafetySchema,
      'safetyNode',
    )
    expect(result.ok).toBe(false)
  })

  it('memory_candidate thin output is completed (D11)', () => {
    const result = parseStructuredJson(
      JSON.stringify({ shouldExtract: false }),
      agentMemoryCandidateSchema,
      'memoryCandidateNode',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.shouldExtract).toBe(false)
      expect(result.data.candidateFacts).toEqual([])
      expect(result.data.confidence).toBeGreaterThan(0)
    }
  })

  it('memory_candidate shouldExtract=true only fills technical candidateFacts, not business defaults', () => {
    const thin = parseStructuredJson(
      JSON.stringify({ shouldExtract: true }),
      agentMemoryCandidateSchema,
      'memoryCandidateNode',
    )
    // 业务字段缺失 → Zod 失败（不再乐观补 confidence/category 等）
    expect(thin.ok).toBe(false)

    const withTechOnly = parseStructuredJson(
      JSON.stringify({
        shouldExtract: true,
        confidence: 0.7,
        category: 'preference',
        stability: 'likely_stable',
        importance: 3,
        reason: 'explicit preference',
        // candidateFacts 故意省略，由 defaults 补 []
      }),
      agentMemoryCandidateSchema,
      'memoryCandidateNode',
    )
    expect(withTechOnly.ok).toBe(true)
    if (withTechOnly.ok) {
      expect(withTechOnly.data.candidateFacts).toEqual([])
      expect(withTechOnly.data.confidence).toBe(0.7)
    }
  })

  const validIntentBase = () => ({
    primary: 'emotional_support',
    secondary: [] as string[],
    confidence: 0.8,
    userNeed: 'be_comforted',
    requestedAgentAction: 'comfort_first',
    relationshipSignal: 'neutral',
    replyExpectation: {
      depth: 'medium',
      warmth: 'high',
      directness: 'gentle',
      shouldAskQuestion: true,
    },
    shouldClarify: false,
    clarifyingQuestion: null,
    promptGuidance: '先接住情绪。',
  })

  it('enum value alias maps primary and marks coerced', () => {
    const raw = JSON.stringify({
      ...validIntentBase(),
      primary: 'support',
      userNeed: 'comfort',
      requestedAgentAction: 'comfort',
    })
    const result = parseStructuredJson(raw, conversationIntentSchema, 'intentNode')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.primary).toBe('emotional_support')
      expect(result.data.userNeed).toBe('be_comforted')
      expect(result.data.requestedAgentAction).toBe('comfort_first')
      expect(result.coerced).toBe(true)
      expect(result.coerceReasons?.some((r) => r.startsWith('invalid_enum:'))).toBe(true)
    }
  })

  it('clean legal enum is success (coerced=false)', () => {
    const result = parseStructuredJson(
      JSON.stringify(validIntentBase()),
      conversationIntentSchema,
      'intentNode',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.coerced).toBe(false)
      expect(result.data.primary).toBe('emotional_support')
    }
  })

  it('unknown primary does NOT silently map to unclear', () => {
    const result = parseStructuredJson(
      JSON.stringify({ ...validIntentBase(), primary: 'totally_made_up_intent' }),
      conversationIntentSchema,
      'intentNode',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.stage).toBe('zod')
    }
  })

  it('role_play alias coerces to roleplay', () => {
    const { value, coerced } = applyEnumValueCoerce({ primary: 'role_play' })
    expect(value.primary).toBe('roleplay')
    expect(coerced).toBe(true)
  })

  it('secondary array elements coerce via primary alias table', () => {
    const { value, coerced } = applyEnumValueCoerce({
      primary: 'casual_chat',
      secondary: ['flirt', 'support'],
    })
    expect(value.secondary).toEqual(['romantic_flirt', 'emotional_support'])
    expect(coerced).toBe(true)
  })

  it('does not coerce ambiguous single-token aliases (write/date/stop/danger)', () => {
    const a = applyEnumValueCoerce({ primary: 'write' })
    expect(a.value.primary).toBe('write')
    expect(a.coerced).toBe(false)
    const b = applyEnumValueCoerce({ primary: 'date' })
    expect(b.value.primary).toBe('date')
    expect(b.coerced).toBe(false)
    const c = applyEnumValueCoerce({ safetyLevel: 'danger' })
    expect(c.value.safetyLevel).toBe('danger')
    expect(c.coerced).toBe(false)
    const d = applyEnumValueCoerce({ safetyLevel: 'stop' })
    expect(d.value.safetyLevel).toBe('stop')
    expect(d.coerced).toBe(false)
  })
})
