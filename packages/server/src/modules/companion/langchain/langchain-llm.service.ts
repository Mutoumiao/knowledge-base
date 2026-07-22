import { ChatOpenAI } from '@langchain/openai'
import { Injectable } from '@nestjs/common'
import { LlmConfigService } from '../config/llm-config.service.js'
import { StructuredOutputService } from './structured-output.service.js'
import { companionTokenCallbacks, recordUsageFromMessage } from './token-usage.js'
import type { StreamChunk, StructuredOutputOptions } from './types.js'

@Injectable()
export class LangChainLlmService {
  constructor(
    private readonly llmConfigService: LlmConfigService,
    private readonly structuredOutputService: StructuredOutputService,
  ) {}

  createModel(overrides?: Partial<ConstructorParameters<typeof ChatOpenAI>[0]>): ChatOpenAI {
    // streamUsage：流式末包尽量带回 usage（OpenAI 兼容网关）
    return this.llmConfigService.createLangChainChatModel({
      streamUsage: true,
      ...overrides,
    } as Partial<ConstructorParameters<typeof ChatOpenAI>[0]>)
  }

  async *streamChat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: { abortSignal?: AbortSignal; temperature?: number },
  ): AsyncGenerator<StreamChunk> {
    const model = this.createModel({ temperature: options?.temperature ?? 0.7 })
    const stream = await model.stream(
      messages.map((m) => [m.role, m.content] as const),
      {
        signal: options?.abortSignal,
        callbacks: companionTokenCallbacks(),
      },
    )

    for await (const chunk of stream) {
      if (options?.abortSignal?.aborted) {
        yield { text: '', done: true }
        return
      }
      // 部分 provider 仅在末 chunk 带 usage_metadata
      recordUsageFromMessage(chunk)
      const text = typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content)
      if (text) {
        yield { text, done: false }
      }
    }

    yield { text: '', done: true }
  }

  async structuredOutput<T>(
    options: StructuredOutputOptions<T>,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.structuredOutputService.invokeWithFallback(options, prompt, signal)
  }

  async invoke(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: { abortSignal?: AbortSignal; temperature?: number },
  ): Promise<string> {
    const model = this.createModel({ temperature: options?.temperature ?? 0.7 })
    const result = await model.invoke(
      messages.map((m) => [m.role, m.content] as const),
      {
        signal: options?.abortSignal,
        callbacks: companionTokenCallbacks(),
      },
    )
    recordUsageFromMessage(result)
    return typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
  }
}
