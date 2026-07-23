import { Runnable } from '@langchain/core/runnables'
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import type { z } from 'zod'
import { LlmConfigService } from '../config/llm-config.service.js'
import { resolveStructuredMethods } from './resolve-structured-methods.js'
import {
  messageContentToString,
  parseStructuredJson,
} from './structured-json-parse.js'
import { tryConsumeRepair } from './structured-repair-budget.js'
import { companionTokenCallbacks } from './token-usage.js'
import type { StructuredOutputMethod, StructuredOutputOptions, WireApi } from './types.js'

const KNOWN_CAPABILITY_400 =
  /Thinking mode does not support this tool_choice|response_format type is unavailable|tool_choice|json_schema|not support/i

const DEFAULT_STRUCTURED_MAX_TOKENS = 1024

/**
 * 仅当错误信息明确与 thinking 参数相关时，才重试并永久关闭 thinking disable。
 * 禁止裸匹配 `400` / `invalid` / `unknown`，避免鉴权、限流等误伤并永久关掉重试策略。
 */
export function isThinkingParamRejection(message: string): boolean {
  if (!/thinking/i.test(message)) return false
  return /unrecognized|unknown|invalid|unsupported|not\s*support|unavailable|tool_choice|parameter|extra|unexpected|400/i.test(
    message,
  )
}

/** 从 LangChain AIMessage 提取 finish_reason（OpenAI 兼容） */
export function extractFinishReason(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined
  const m = message as Record<string, unknown>
  const rm = m.response_metadata
  if (rm && typeof rm === 'object') {
    const meta = rm as Record<string, unknown>
    const fr = meta.finish_reason ?? meta.finishReason
    if (typeof fr === 'string' && fr.length > 0) return fr
  }
  const gi = m.generation_info ?? m.generationInfo
  if (gi && typeof gi === 'object') {
    const info = gi as Record<string, unknown>
    const fr = info.finish_reason ?? info.finishReason
    if (typeof fr === 'string' && fr.length > 0) return fr
  }
  return undefined
}

@Injectable()
export class StructuredOutputService {
  private readonly logger = new Logger(StructuredOutputService.name)
  private thinkingDisableSupported: boolean | null = null

  constructor(private readonly llmConfigService: LlmConfigService) {}

  /** @deprecated 使用 resolveMethods；保留以兼容旧调用 */
  getMethods(wireApi: WireApi = 'chat_completions'): StructuredOutputMethod[] {
    return this.resolveMethods(wireApi)
  }

  resolveMethods(wireApi: WireApi = 'chat_completions'): StructuredOutputMethod[] {
    return resolveStructuredMethods({
      modelId: this.llmConfigService.getModelId(),
      wireApi,
    })
  }

  async invokeWithFallback<T>(
    options: StructuredOutputOptions<T>,
    prompt: Runnable | string,
    signal?: AbortSignal,
  ): Promise<T> {
    const started = Date.now()
    const methods = this.resolveMethods()
    let lastError: unknown = null
    const callbacks = companionTokenCallbacks()
    const promptText = await this.resolvePromptText(prompt)

    for (const method of methods) {
      try {
        if (method === 'jsonMode') {
          const data = await this.invokeJsonModeSelfManaged(options, promptText, signal, callbacks)
          this.logger.log(
            `[${options.name}] stage=success method=jsonMode ms=${Date.now() - started}`,
          )
          return data
        }

        const data = await this.invokeWithStructuredOutputMethod(
          method,
          options,
          promptText,
          signal,
          callbacks,
        )
        this.logger.log(
          `[${options.name}] stage=success method=${method} ms=${Date.now() - started}`,
        )
        return data
      } catch (error) {
        lastError = error
        this.logMethodFailure(method, options.name, error)
      }
    }

    // 尝试全局 repair（仅 1 次/轮，D10）
    if (tryConsumeRepair(options.repairBudget)) {
      try {
        const repaired = await this.invokeRepair(options, promptText, lastError, signal, callbacks)
        this.logger.log(
          `[${options.name}] stage=repair method=jsonMode ms=${Date.now() - started}`,
        )
        return repaired
      } catch (error) {
        lastError = error
        this.logger.warn(
          `[${options.name}] repair failed: ${error instanceof Error ? error.message : 'unknown'}`,
        )
      }
    }

    this.logger.warn(
      `[${options.name}] stage=fallback ms=${Date.now() - started} methods=${methods.join(',')}`,
    )
    throw new InternalServerErrorException(`结构化输出失败：${options.name}`)
  }

  private async resolvePromptText(prompt: Runnable | string): Promise<string> {
    if (typeof prompt === 'string') return prompt
    const value = await prompt.invoke({})
    return typeof value === 'string' ? value : JSON.stringify(value)
  }

  private createStructuredModel(withThinkingDisable: boolean) {
    const modelKwargs: Record<string, unknown> = {
      response_format: { type: 'json_object' },
    }
    if (withThinkingDisable) {
      modelKwargs.thinking = { type: 'disabled' }
    }
    return this.llmConfigService.createLangChainChatModel({
      temperature: 0,
      maxTokens: DEFAULT_STRUCTURED_MAX_TOKENS,
      modelKwargs,
    })
  }

  /**
   * D9：jsonMode 自管 raw content → 本地 normalize/Zod
   * 不依赖 withStructuredOutput 内部 parse。
   */
  private async invokeJsonModeSelfManaged<T>(
    options: StructuredOutputOptions<T>,
    promptText: string,
    signal: AbortSignal | undefined,
    callbacks: ReturnType<typeof companionTokenCallbacks>,
  ): Promise<T> {
    const { content: raw, finishReason } = await this.invokeRawJsonObject(
      promptText,
      signal,
      callbacks,
    )
    const parsed = parseStructuredJson(raw, options.schema as z.ZodSchema<T>, options.name)
    if (parsed.ok) return parsed.data

    // finish_reason=length：优先走上层 repair（更清晰的截断语义）
    const stage =
      finishReason === 'length' ? 'truncated' : parsed.stage
    if (finishReason === 'length') {
      this.logger.debug(
        `[${options.name}] jsonMode finish_reason=length parse=${parsed.stage}`,
      )
    }

    // 首次失败时若仍有 repair 预算，在本路径内也可消耗（与全局共用）
    // 但设计是「方法链全失败后再 repair」；此处抛出让上层统一 repair。
    throw new Error(`jsonMode parse failed (${stage}): ${parsed.error}`)
  }

  private async invokeRawJsonObject(
    promptText: string,
    signal: AbortSignal | undefined,
    callbacks: ReturnType<typeof companionTokenCallbacks>,
  ): Promise<{ content: string; finishReason?: string }> {
    const tryDisable = this.thinkingDisableSupported !== false
    try {
      const model = this.createStructuredModel(tryDisable)
      const result = await model.invoke(promptText, { signal, callbacks })
      if (tryDisable && this.thinkingDisableSupported === null) {
        this.thinkingDisableSupported = true
      }
      return {
        content: messageContentToString(result?.content),
        finishReason: extractFinishReason(result),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // D3：仅 thinking 参数被拒绝时跳过并 warn，不中止；不因裸 400/invalid 永久关策略
      if (tryDisable && isThinkingParamRejection(message)) {
        if (this.thinkingDisableSupported !== false) {
          this.logger.warn(
            `Structured thinking disable unsupported or rejected; retry without: ${message.slice(0, 200)}`,
          )
        }
        this.thinkingDisableSupported = false
        const model = this.createStructuredModel(false)
        const result = await model.invoke(promptText, { signal, callbacks })
        return {
          content: messageContentToString(result?.content),
          finishReason: extractFinishReason(result),
        }
      }
      throw error
    }
  }

  private async invokeWithStructuredOutputMethod<T>(
    method: StructuredOutputMethod,
    options: StructuredOutputOptions<T>,
    promptText: string,
    signal: AbortSignal | undefined,
    callbacks: ReturnType<typeof companionTokenCallbacks>,
  ): Promise<T> {
    const model = this.llmConfigService.createLangChainChatModel({
      temperature: 0,
      maxTokens: DEFAULT_STRUCTURED_MAX_TOKENS,
    })
    const structuredModel = model.withStructuredOutput(options.schema, {
      name: options.name,
      method,
    })
    const result = await structuredModel.invoke(promptText, { signal, callbacks })
    return options.schema.parse(result)
  }

  private async invokeRepair<T>(
    options: StructuredOutputOptions<T>,
    originalPrompt: string,
    lastError: unknown,
    signal: AbortSignal | undefined,
    callbacks: ReturnType<typeof companionTokenCallbacks>,
  ): Promise<T> {
    const errMsg = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown')
    const repairPrompt = [
      originalPrompt,
      '',
      '---',
      '上一次输出无法通过 JSON/Schema 校验，请严格修复。',
      `错误摘要：${errMsg.slice(0, 500)}`,
      '要求：只输出一个合法 JSON 对象（json），不要 markdown 代码围栏，不要解释文字。',
      '字段名必须与 schema 一致。',
    ].join('\n')

    const { content: raw, finishReason } = await this.invokeRawJsonObject(
      repairPrompt,
      signal,
      callbacks,
    )
    const parsed = parseStructuredJson(raw, options.schema as z.ZodSchema<T>, options.name)
    if (parsed.ok) return parsed.data
    const stage = finishReason === 'length' ? 'truncated' : parsed.stage
    throw new Error(`repair parse failed (${stage}): ${parsed.error}`)
  }

  private logMethodFailure(method: StructuredOutputMethod, nodeName: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (method !== 'jsonMode' && KNOWN_CAPABILITY_400.test(message)) {
      // D7：已知能力 400 降噪
      this.logger.debug(`[${nodeName}] method=${method} unsupported: ${message.slice(0, 160)}`)
      return
    }
    this.logger.warn(`[${nodeName}] method=${method} failed: ${message.slice(0, 240)}`)
  }
}
