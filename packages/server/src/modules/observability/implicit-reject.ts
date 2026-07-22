/**
 * Chat 隐式拒绝：短窗口词表检测（不提升成功率，仅打 userRejected 旗标）
 * Companion 默认不启用。
 */

const DEFAULT_PHRASES = [
  '没用',
  '不对',
  '答非所问',
  '不是这个意思',
  '你理解错了',
  '重新回答',
  '重新说',
  '完全不对',
  '说的什么玩意',
  'garbage',
  'wrong answer',
  'not helpful',
  'does not help',
]

export function isImplicitRejectEnabledForChat(): boolean {
  const v = process.env.OBS_IMPLICIT_REJECT_ENABLED
  if (v === undefined || v === '') return true
  return v === 'true' || v === '1'
}

export function detectUserRejected(text: string, phrases: string[] = DEFAULT_PHRASES): boolean {
  const t = text.trim().toLowerCase()
  if (!t || t.length > 200) return false
  return phrases.some((p) => t.includes(p.toLowerCase()))
}
