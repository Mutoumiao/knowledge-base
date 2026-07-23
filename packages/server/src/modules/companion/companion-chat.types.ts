import type { CompanionState } from './langgraph/interfaces.js'

export type CompanionErrorCode =
  | 'ERR_SAFETY_BLOCKED'
  | 'ERR_LLM_TIMEOUT'
  | 'ERR_LLM_PARSE'
  | 'ERR_EMPTY_REPLY'
  | 'ERR_GUARD_FAIL'
  | 'ERR_COMPANION_NOT_FOUND'
  | 'ERR_COMPANION_ARCHIVED'
  | 'ERR_UNAUTHORIZED'

export type ChatStreamEvent =
  | { event: 'token'; data: { delta: string } }
  | {
      event: 'done'
      data: {
        fullReply: string
        /** 与 fullReply 同义，兼容前端/Transport 字段名 */
        content?: string
        quality: CompanionState['quality']
      }
    }
  | { event: 'summary'; data: { summary: string } }
  | { event: 'memories'; data: { items: CompanionState['extractedMemories'] } }
  | { event: 'error'; data: { message: string; code: CompanionErrorCode } }
  | { event: 'heartbeat'; data: { ts: number } }

export interface StreamChatParams {
  userId: string
  companionId: string
  message: string
  conversationId?: string
  signal?: AbortSignal
}
