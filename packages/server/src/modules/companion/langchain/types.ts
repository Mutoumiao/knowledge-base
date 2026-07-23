import type { ChatPromptTemplate } from '@langchain/core/prompts'
import type { Runnable } from '@langchain/core/runnables'
import type { ChatOpenAI } from '@langchain/openai'
import type { z } from 'zod'

export type WireApi = 'chat_completions' | 'responses'

export type StructuredOutputMethod = 'jsonSchema' | 'functionCalling' | 'jsonMode'

export type { ChatOpenAI }

export interface StreamChunk {
  text: string
  done: boolean
}

export interface StructuredOutputOptions<T> {
  schema: z.ZodSchema<T>
  name: string
  method?: StructuredOutputMethod
  /** 整轮共享 repair 预算（D10）；不传则不发起 repair */
  repairBudget?: { used: number; budget: number }
}

export type PromptInput = string | ChatPromptTemplate | Runnable
