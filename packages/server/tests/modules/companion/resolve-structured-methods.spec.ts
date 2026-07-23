import { afterEach, describe, expect, it } from 'vitest'
import {
  isDeepSeekLike,
  resolveStructuredMethods,
} from '@/modules/companion/langchain/resolve-structured-methods.js'

describe('resolveStructuredMethods', () => {
  const prev = process.env.COMPANION_STRUCTURED_METHODS

  afterEach(() => {
    if (prev === undefined) delete process.env.COMPANION_STRUCTURED_METHODS
    else process.env.COMPANION_STRUCTURED_METHODS = prev
  })

  it('DeepSeek-like returns only jsonMode', () => {
    delete process.env.COMPANION_STRUCTURED_METHODS
    expect(isDeepSeekLike('deepseek-v4-flash')).toBe(true)
    expect(resolveStructuredMethods({ modelId: 'deepseek-v4-flash' })).toEqual(['jsonMode'])
    expect(resolveStructuredMethods({ modelId: 'DeepSeek-Chat' })).toEqual(['jsonMode'])
  })

  it('non-DeepSeek keeps multi-method order', () => {
    delete process.env.COMPANION_STRUCTURED_METHODS
    expect(resolveStructuredMethods({ modelId: 'gpt-4o' })).toEqual([
      'functionCalling',
      'jsonSchema',
      'jsonMode',
    ])
    expect(
      resolveStructuredMethods({ modelId: 'gpt-4o', wireApi: 'responses' }),
    ).toEqual(['jsonSchema', 'functionCalling', 'jsonMode'])
  })

  it('env COMPANION_STRUCTURED_METHODS overrides heuristic', () => {
    expect(
      resolveStructuredMethods({
        modelId: 'deepseek-v4-flash',
        envMethods: 'jsonSchema,jsonMode',
      }),
    ).toEqual(['jsonSchema', 'jsonMode'])
  })
})
