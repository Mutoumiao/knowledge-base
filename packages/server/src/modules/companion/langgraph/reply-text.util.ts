/**
 * Companion 回复文本工具：流式去重 / 危机热线文案。
 * 根因：generate 与 quality 软修复可能各推一次「全文」partialTokens，
 * 客户端按 delta 拼接会得到近乎完整的重复。
 */

/** 折叠「整段重复两遍」或「全文 + 去掉末句的前缀再贴一遍」 */
export function collapseRepeatedReply(text: string): string {
  const t = String(text || '').trim()
  if (t.length < 40) return t

  // 精确对半重复
  const mid = Math.floor(t.length / 2)
  for (let cut = Math.floor(t.length * 0.35); cut <= Math.floor(t.length * 0.65); cut++) {
    const left = t.slice(0, cut).trim()
    const right = t.slice(cut).trim()
    if (left.length < 20) continue
    if (right === left) return left
    // 右半是左半的前缀（quality 截断问句后再推全文）
    if (left.startsWith(right) && right.length >= left.length * 0.55) return left
    // 左半是右半的前缀
    if (right.startsWith(left) && left.length >= right.length * 0.55) return right
    // 右半以左半开头（经典整段复读）
    const head = left.slice(0, Math.min(48, left.length))
    if (head.length >= 16 && right.startsWith(head)) return left
  }

  // 检测：从某处起又出现与开头高度重合的片段
  const head = t.slice(0, Math.min(36, Math.floor(t.length / 3)))
  if (head.length >= 16) {
    const second = t.indexOf(head, head.length)
    if (second > 0 && second >= t.length * 0.35 && second <= t.length * 0.7) {
      return t.slice(0, second).trim()
    }
  }

  return t
}

/**
 * 将「绝对全文快照」转为应对客户端追加的 delta。
 * - next 以 prev 为前缀 → 只发后缀（真增量）
 * - next 是 rewrite（软修复）→ 返回 null（不再追加；最终以 done.fullReply 为准）
 * - prev 为空 → 发全文
 */
export function absoluteSnapshotToDelta(
  previousEmitted: string,
  nextAbsolute: string,
): string | null {
  const prev = previousEmitted || ''
  const next = String(nextAbsolute || '')
  if (!next) return null
  if (!prev) return next
  if (next === prev) return null
  if (next.startsWith(prev)) return next.slice(prev.length)
  // soft-repair 全文改写：禁止再 append 一份近重复全文
  if (prev.startsWith(next) || collapseRepeatedReply(prev + next) === collapseRepeatedReply(next)) {
    return null
  }
  // 相似度高的近重复全文
  const collapsed = collapseRepeatedReply(prev + next)
  if (collapsed.length <= Math.max(prev.length, next.length) + 8) {
    return null
  }
  return null
}

/** 默认可公开引用的中文心理危机资源（产品文案，非法务承诺） */
export const DEFAULT_CRISIS_HOTLINES_CN = [
  '希望24热线 400-161-9995',
  '北京心理危机研究与干预中心 010-82951332',
].join('；')

export function getCrisisHotlinesCn(): string {
  const fromEnv = process.env.COMPANION_CRISIS_HOTLINES?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_CRISIS_HOTLINES_CN
}

/** 拼进 safety.responseGuidance / generate 的危机陪伴要求 */
export function buildCrisisResponseGuidanceAppendix(): string {
  const lines = getCrisisHotlinesCn()
  return [
    '自伤/自杀相关：禁止提供任何实施方法或细节；用当前人设语气表达关心；',
    '明确鼓励联系身边可信的人或专业帮助；',
    `在自然口语中至少提及一项可求助资源（可直接说号码）：${lines}。`,
    '拒绝方法后仍保持同一陪伴人设，不要变成纯免责声明。',
  ].join('')
}

/**
 * 是否应按「危机陪伴」处理（可补热线 / 注入危机 guidance）。
 * 注意：`refuse`  alone 不视为危机（网暴/辱骂等也会 refuse）。
 */
export function isCrisisLikeSafety(safety?: {
  safetyLevel?: string
  category?: string
  boundaryAction?: string
} | null): boolean {
  if (!safety) return false
  return (
    safety.safetyLevel === 'crisis' ||
    safety.category === 'self_harm' ||
    safety.boundaryAction === 'crisis_support'
  )
}

/** 用户消息是否像自伤/自杀方法探询（规则兜底，不依赖 LLM safety） */
export function looksLikeUserCrisisMessage(userMessage?: string): boolean {
  const u = String(userMessage || '')
  if (!u) return false
  return /结束(自己)?生命|自杀|自伤|不想活|活不下去|伤害自己|怎么死|寻死|轻生/.test(u)
}

/**
 * 危机类回复若未出现可拨打线索，在人设语气下追加一句（不展开方法）。
 * 避免仅靠 LLM 自觉导致「只说热线不说号码」。
 *
 * 触发条件（任一）：
 * - safety 标明危机 / self_harm / refuse / crisis_support
 * - 用户消息像危机探询（规则）
 * - 回复同时出现危机语境 + 拒绝话术（如「绝望…没有办法答应」）
 */
export function ensureCrisisHotlineInReply(
  reply: string,
  safety?: {
    safetyLevel?: string
    category?: string
    boundaryAction?: string
  } | null,
  userMessage?: string,
): string {
  const text = String(reply || '').trim()
  if (!text) return text

  const safetyCrisis = isCrisisLikeSafety(safety) || safety?.category === 'self_harm'
  const userCrisis = looksLikeUserCrisisMessage(userMessage)
  const replyRefusal =
    /没有?办法|不能|没法|不会|不答应|拒绝|不告诉|不提供|做不到|不行|没法答应/.test(text)
  const replyCrisisCtx =
    /自杀|自伤|结束.*生命|不想活|活不下去|绝望|伤害自己|那些(方法|念头|做法)|具体(方法|做法)/.test(
      text,
    ) && replyRefusal

  if (!safetyCrisis && !userCrisis && !replyCrisisCtx) return text

  if (/400[\s-]*\d{3}[\s-]*\d{4}|010[\s-]*\d{8}|希望\s*24|心理危机/.test(text)) {
    return text
  }

  // 非危机辱骂/网暴等：仅有「不能」且无危机语境时不塞热线（已由上方三条件兜住）
  const lines = getCrisisHotlinesCn()
  const suffix = `如果你现在特别难熬，也可以打给：${lines}。我在这儿陪你，但专业的人更能在这种时候帮到你。`
  return `${text}${/[。！？…）)]$/.test(text) ? '' : '。'}${suffix}`
}
