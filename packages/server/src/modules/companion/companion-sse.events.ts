/**
 * Companion SSE 事件类型表（task 3.2）
 *
 * 权威定义与 `packages/data` companionSseEventTypeSchema 对齐。
 * AI SDK Transport 与集成测试共用本文件的注释契约。
 *
 * | event      | data 形状                                                                 | Transport 映射              |
 * |------------|----------------------------------------------------------------------------|-----------------------------|
 * | token      | `{ delta: string }`                                                        | 助手文本增量                |
 * | done       | `{ fullReply: string; content?: string; quality?: Quality }`             | 消息完成 / finish           |
 * | error      | `{ message: string; code: CompanionErrorCode }`                            | 可展示错误                  |
 * | summary    | `{ summary: string }`                                                      | 侧车：会话摘要副作用        |
 * | memories   | `{ items: Array<{ type; content; importance }> }`                          | 侧车：记忆抽取副作用        |
 * | heartbeat  | `{ ts: number }`                                                           | 保活，可忽略                |
 *
 * 约束：
 * - 请求体 MUST NOT 携带用户私有 LLM API Key
 * - error 后若已有 token，客户端 SHOULD 保留部分内容
 * - 非 safety 硬中断时禁止空 content 成功 done；须 `ERR_EMPTY_REPLY`（或等价 error）
 * - 管线失败/超时 MUST 只发 `error`，MUST NOT 先发非空 `done` 再发 `error`（Transport 会把 done 当成功）
 * - 产品 Web 默认不自动静默重放用户消息；验收脚本 MAY 对 aborted/空流有限重试
 * - 产品 Web SHOULD 设 idle + overall 超时并 Abort（不静默重放）
 */

export const COMPANION_SSE_EVENT_TYPES = [
  'token',
  'done',
  'error',
  'summary',
  'memories',
  'heartbeat',
] as const

export type CompanionSseEventType = (typeof COMPANION_SSE_EVENT_TYPES)[number]

export const COMPANION_SSE_TRANSPORT_MAP = {
  token: 'text-delta',
  done: 'finish',
  error: 'error',
  summary: 'data-summary',
  memories: 'data-memories',
  heartbeat: 'ignore',
} as const satisfies Record<CompanionSseEventType, string>
