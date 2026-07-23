import { conversationSafetySchema } from '@goferbot/data/schemas'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractFinishReason,
  isThinkingParamRejection,
  StructuredOutputService,
} from '@/modules/companion/langchain/structured-output.service.js'

const validSafetyJson = () =>
  JSON.stringify({
    safetyLevel: 'safe',
    category: 'normal',
    boundaryAction: 'continue',
    reason: 'ok',
    responseGuidance: 'g',
    allowMemoryExtraction: true,
  })

describe('isThinkingParamRejection', () => {
  it('requires thinking keyword; bare 400/invalid/unknown do not match', () => {
    expect(isThinkingParamRejection('HTTP 400 Unauthorized')).toBe(false)
    expect(isThinkingParamRejection('invalid api key')).toBe(false)
    expect(isThinkingParamRejection('unknown error')).toBe(false)
    expect(isThinkingParamRejection('rate limit exceeded')).toBe(false)
  })

  it('matches thinking-related rejections', () => {
    expect(isThinkingParamRejection('Unrecognized request argument supplied: thinking')).toBe(
      true,
    )
    expect(
      isThinkingParamRejection('Invalid parameter: thinking is not supported'),
    ).toBe(true)
    expect(
      isThinkingParamRejection('Thinking mode does not support this tool_choice'),
    ).toBe(true)
  })
})

describe('extractFinishReason', () => {
  it('reads response_metadata.finish_reason', () => {
    expect(
      extractFinishReason({ content: '{}', response_metadata: { finish_reason: 'length' } }),
    ).toBe('length')
    expect(extractFinishReason({ content: 'x' })).toBeUndefined()
  })
})

describe('StructuredOutputService jsonMode path', () => {
  afterEach(() => {
    delete process.env.COMPANION_STRUCTURED_METHODS
    vi.restoreAllMocks()
  })

  it('DeepSeek-like only uses jsonMode (no FC/jsonSchema withStructuredOutput)', async () => {
    const withStructuredOutput = vi.fn()
    const invoke = vi.fn().mockResolvedValue({
      content: validSafetyJson(),
    })

    const llmConfigService = {
      getModelId: () => 'deepseek-v4-flash',
      createLangChainChatModel: vi.fn().mockReturnValue({
        invoke,
        withStructuredOutput,
      }),
    }

    const service = new StructuredOutputService(llmConfigService as never)
    const result = await service.invokeWithFallback(
      {
        schema: conversationSafetySchema,
        name: 'safetyNode',
        repairBudget: { used: 0, budget: 1 },
      },
      'prompt',
    )

    expect(result.safetyLevel).toBe('safe')
    expect(withStructuredOutput).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalled()
    expect(llmConfigService.createLangChainChatModel).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0,
        maxTokens: 1024,
        modelKwargs: expect.objectContaining({
          response_format: { type: 'json_object' },
        }),
      }),
    )
  })

  it('repair budget is consumed at most once across two failing nodes', async () => {
    const invoke = vi
      .fn()
      // node1: initial fail content, then repair success
      .mockResolvedValueOnce({ content: '{' })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          safetyLevel: 'safe',
          category: 'normal',
          boundaryAction: 'continue',
          reason: 'repaired',
          responseGuidance: 'g',
          allowMemoryExtraction: true,
        }),
      })
      // node2: fail, no more repair
      .mockResolvedValueOnce({ content: '{' })

    const llmConfigService = {
      getModelId: () => 'deepseek-v4-flash',
      createLangChainChatModel: vi.fn().mockReturnValue({
        invoke,
        withStructuredOutput: vi.fn(),
      }),
    }

    const service = new StructuredOutputService(llmConfigService as never)
    const budget = { used: 0, budget: 1 }

    const ok = await service.invokeWithFallback(
      { schema: conversationSafetySchema, name: 'safetyNode', repairBudget: budget },
      'p1',
    )
    expect(ok.reason).toBe('repaired')
    expect(budget.used).toBe(1)

    await expect(
      service.invokeWithFallback(
        { schema: conversationSafetySchema, name: 'intentNode', repairBudget: budget },
        'p2',
      ),
    ).rejects.toThrow(/结构化输出失败/)
    // 第二次失败不得再次 repair：仍为 1，且 invoke 次数 = 3（2 次失败初试 + 1 次 repair）
    expect(budget.used).toBe(1)
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('thinking rejection retries without thinking and sets flag false', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unrecognized request argument supplied: thinking'))
      .mockResolvedValueOnce({ content: validSafetyJson() })

    const createLangChainChatModel = vi.fn().mockReturnValue({
      invoke,
      withStructuredOutput: vi.fn(),
    })

    const service = new StructuredOutputService({
      getModelId: () => 'deepseek-v4-flash',
      createLangChainChatModel,
    } as never)

    await service.invokeWithFallback(
      { schema: conversationSafetySchema, name: 'safetyNode', repairBudget: { used: 0, budget: 1 } },
      'prompt',
    )

    expect(invoke).toHaveBeenCalledTimes(2)
    // 首次带 thinking，重试不带
    expect(createLangChainChatModel.mock.calls[0][0].modelKwargs).toEqual(
      expect.objectContaining({ thinking: { type: 'disabled' } }),
    )
    expect(createLangChainChatModel.mock.calls[1][0].modelKwargs).toEqual({
      response_format: { type: 'json_object' },
    })
  })

  it('non-thinking 400 does not retry or permanently disable thinking strategy', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('HTTP 400: invalid api key'))
    const createLangChainChatModel = vi.fn().mockReturnValue({
      invoke,
      withStructuredOutput: vi.fn(),
    })

    const service = new StructuredOutputService({
      getModelId: () => 'deepseek-v4-flash',
      createLangChainChatModel,
    } as never)

    await expect(
      service.invokeWithFallback(
        {
          schema: conversationSafetySchema,
          name: 'safetyNode',
          repairBudget: { used: 0, budget: 1 },
        },
        'prompt',
      ),
    ).rejects.toThrow(/结构化输出失败/)

    // 初试 + repair 各 1 次，均因同错失败；不应因「裸 400」再双倍重试 thinking off
    expect(invoke).toHaveBeenCalledTimes(2)
    for (const call of createLangChainChatModel.mock.calls) {
      expect(call[0].modelKwargs).toEqual(
        expect.objectContaining({ thinking: { type: 'disabled' } }),
      )
    }
  })

  it('finish_reason=length with truncated body triggers repair path', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        content: '{"safetyLevel":"safe"',
        response_metadata: { finish_reason: 'length' },
      })
      .mockResolvedValueOnce({ content: validSafetyJson() })

    const service = new StructuredOutputService({
      getModelId: () => 'deepseek-v4-flash',
      createLangChainChatModel: vi.fn().mockReturnValue({
        invoke,
        withStructuredOutput: vi.fn(),
      }),
    } as never)

    const budget = { used: 0, budget: 1 }
    const ok = await service.invokeWithFallback(
      { schema: conversationSafetySchema, name: 'safetyNode', repairBudget: budget },
      'prompt',
    )
    expect(ok.safetyLevel).toBe('safe')
    expect(budget.used).toBe(1)
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
