import {
  conversationSafetySchema,
  agentMemoryCandidateSchema,
} from '@goferbot/data/schemas'
import { describe, expect, it } from 'vitest'
import {
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

  it('maps safetyClassification alias to safetyLevel then Zod passes', () => {
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
})
