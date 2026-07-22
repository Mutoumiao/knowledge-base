import { AsyncLocalStorage } from 'node:async_hooks'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { LLMResult } from '@langchain/core/outputs'

/** 单回合 Companion LLM token 累加桶（P1 仅数字） */
export type CompanionTokenBucket = {
  inputTokens: number
  outputTokens: number
}

const als = new AsyncLocalStorage<CompanionTokenBucket>()

function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  return undefined
}

/**
 * 从 AIMessage / chunk 提取 usage（兼容 LangChain usage_metadata 与 OpenAI response_metadata.usage）
 */
export function extractUsageFromMessage(msg: unknown): {
  input?: number
  output?: number
} {
  if (!msg || typeof msg !== 'object') return {}
  const m = msg as Record<string, unknown>

  const um = m.usage_metadata
  if (um && typeof um === 'object') {
    const u = um as Record<string, unknown>
    return {
      input: asFiniteNumber(u.input_tokens ?? u.inputTokens),
      output: asFiniteNumber(u.output_tokens ?? u.outputTokens),
    }
  }

  const rm = m.response_metadata
  if (rm && typeof rm === 'object') {
    const meta = rm as Record<string, unknown>
    const usage = meta.usage ?? meta.tokenUsage
    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>
      return {
        input: asFiniteNumber(u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? u.inputTokens),
        output: asFiniteNumber(
          u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? u.outputTokens,
        ),
      }
    }
  }

  return {}
}

/**
 * 从 LLMResult（handleLLMEnd）提取 usage
 */
export function extractUsageFromLlmResult(output: unknown): {
  input?: number
  output?: number
} {
  if (!output || typeof output !== 'object') return {}
  const o = output as {
    generations?: Array<Array<{ message?: unknown; generationInfo?: Record<string, unknown> }>>
    llmOutput?: Record<string, unknown>
  }

  const gen0 = o.generations?.[0]?.[0]
  if (gen0?.message) {
    const fromMsg = extractUsageFromMessage(gen0.message)
    if (fromMsg.input != null || fromMsg.output != null) return fromMsg
  }

  const llmOut = o.llmOutput
  if (llmOut && typeof llmOut === 'object') {
    const tu = (llmOut.tokenUsage ?? llmOut.usage) as Record<string, unknown> | undefined
    if (tu) {
      return {
        input: asFiniteNumber(tu.promptTokens ?? tu.prompt_tokens ?? tu.input_tokens),
        output: asFiniteNumber(tu.completionTokens ?? tu.completion_tokens ?? tu.output_tokens),
      }
    }
  }

  const gi = gen0?.generationInfo
  if (gi) {
    return {
      input: asFiniteNumber(gi.prompt_tokens ?? gi.promptTokens),
      output: asFiniteNumber(gi.completion_tokens ?? gi.completionTokens),
    }
  }

  return {}
}

/** 开启本回合 token 累加上下文（stream 入口调用 enterWith） */
export function beginCompanionTokenBucket(): CompanionTokenBucket {
  const bucket: CompanionTokenBucket = { inputTokens: 0, outputTokens: 0 }
  als.enterWith(bucket)
  return bucket
}

export function getCompanionTokenBucket(): CompanionTokenBucket | undefined {
  return als.getStore()
}

export function addCompanionTokenUsage(input?: number, output?: number): void {
  const bucket = als.getStore()
  if (!bucket) return
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) {
    bucket.inputTokens += Math.floor(input)
  }
  if (typeof output === 'number' && Number.isFinite(output) && output > 0) {
    bucket.outputTokens += Math.floor(output)
  }
}

export function recordUsageFromMessage(msg: unknown): void {
  const u = extractUsageFromMessage(msg)
  addCompanionTokenUsage(u.input, u.output)
}

export function recordUsageFromLlmResult(output: unknown): void {
  const u = extractUsageFromLlmResult(output)
  addCompanionTokenUsage(u.input, u.output)
}

/** LangChain 回调：structured / invoke 路径统一收集 */
export class CompanionTokenCallbackHandler extends BaseCallbackHandler {
  name = 'companion_token_usage'

  handleLLMEnd(output: LLMResult): void {
    recordUsageFromLlmResult(output)
  }
}

export function companionTokenCallbacks(): CompanionTokenCallbackHandler[] {
  return [new CompanionTokenCallbackHandler()]
}
