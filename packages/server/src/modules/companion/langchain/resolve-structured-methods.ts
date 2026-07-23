import type { StructuredOutputMethod, WireApi } from './types.js'

const VALID_METHODS = new Set<StructuredOutputMethod>([
  'functionCalling',
  'jsonSchema',
  'jsonMode',
])

export function isDeepSeekLike(modelId: string | null | undefined): boolean {
  if (!modelId) return false
  return modelId.toLowerCase().includes('deepseek')
}

/**
 * 解析结构化方法链（D1/D8）。
 * - env COMPANION_STRUCTURED_METHODS 优先（逗号分隔）
 * - DeepSeek-like → 仅 jsonMode
 * - 否则按 wireApi 保留多方法
 */
export function resolveStructuredMethods(options?: {
  modelId?: string | null
  envMethods?: string | null
  wireApi?: WireApi
}): StructuredOutputMethod[] {
  const rawEnv =
    options?.envMethods ??
    (typeof process !== 'undefined' ? process.env.COMPANION_STRUCTURED_METHODS : undefined)

  if (rawEnv && rawEnv.trim()) {
    const parsed = rawEnv
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is StructuredOutputMethod => VALID_METHODS.has(s as StructuredOutputMethod))
    if (parsed.length > 0) return parsed
  }

  if (isDeepSeekLike(options?.modelId)) {
    return ['jsonMode']
  }

  const wireApi = options?.wireApi ?? 'chat_completions'
  return wireApi === 'responses'
    ? ['jsonSchema', 'functionCalling', 'jsonMode']
    : ['functionCalling', 'jsonSchema', 'jsonMode']
}
