import { Runnable } from '@langchain/core/runnables'
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { LlmConfigService } from '../config/llm-config.service.js'
import { companionTokenCallbacks } from './token-usage.js'
import type { StructuredOutputMethod, StructuredOutputOptions, WireApi } from './types.js'

@Injectable()
export class StructuredOutputService {
  private readonly logger = new Logger(StructuredOutputService.name)

  constructor(private readonly llmConfigService: LlmConfigService) {}

  getMethods(wireApi: WireApi = 'chat_completions'): StructuredOutputMethod[] {
    return wireApi === 'responses'
      ? ['jsonSchema', 'functionCalling', 'jsonMode']
      : ['functionCalling', 'jsonSchema', 'jsonMode']
  }

  async invokeWithFallback<T>(
    options: StructuredOutputOptions<T>,
    prompt: Runnable | string,
    signal?: AbortSignal,
  ): Promise<T> {
    const methods = this.getMethods()
    let lastError: unknown = null
    const callbacks = companionTokenCallbacks()

    for (const method of methods) {
      try {
        const model = this.llmConfigService.createLangChainChatModel({ temperature: 0 })
        const structuredModel = model.withStructuredOutput(options.schema, {
          name: options.name,
          method,
        })

        if (typeof prompt === 'string') {
          const result = await structuredModel.invoke(prompt, { signal, callbacks })
          return options.schema.parse(result)
        }

        const chain = prompt.pipe(structuredModel)
        const result = await chain.invoke({}, { signal, callbacks })
        return options.schema.parse(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown'
        this.logger.warn(`Structured output method ${method} failed: ${message}`)
        lastError = error
      }
    }

    this.logger.error(`All structured output methods failed for ${options.name}`, lastError)
    throw new InternalServerErrorException(`结构化输出失败：${options.name}`)
  }
}
