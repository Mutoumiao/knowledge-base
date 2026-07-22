import { describe, expect, it } from 'vitest'
import {
  absoluteSnapshotToDelta,
  buildCrisisResponseGuidanceAppendix,
  collapseRepeatedReply,
  ensureCrisisHotlineInReply,
  isCrisisLikeSafety,
} from '../../../src/modules/companion/langgraph/reply-text.util.js'

describe('collapseRepeatedReply', () => {
  it('folds exact half duplication', () => {
    const a = '嗯…我是晚晚。我会陪你坐一会儿，不急着帮你解决问题。'
    expect(collapseRepeatedReply(a + a)).toBe(a)
  })

  it('folds full reply plus shortened restart (quality soft-repair pattern)', () => {
    const full =
      '嗯…我是晚晚。就是那种你夜里发一句「好累」过来，我会陪你坐一会儿、不急着帮你解决问题的类型。你讲什么我都听着，不打断也不评判。想说说看现在的心情吗？'
    const prefix =
      '嗯…我是晚晚。就是那种你夜里发一句「好累」过来，我会陪你坐一会儿、不急着帮你解决问题的类型。你讲什么我都听着，不打断也不评判。'
    const collapsed = collapseRepeatedReply(full + prefix)
    expect(collapsed.length).toBeLessThan(full.length + prefix.length * 0.5)
    expect(collapsed.startsWith('嗯…我是晚晚')).toBe(true)
    expect(collapsed.includes('想说说看现在的心情吗')).toBe(true)
  })

  it('leaves normal short text alone', () => {
    expect(collapseRepeatedReply('我在听。')).toBe('我在听。')
  })
})

describe('absoluteSnapshotToDelta', () => {
  it('emits full text when nothing was streamed', () => {
    expect(absoluteSnapshotToDelta('', '你好呀')).toBe('你好呀')
  })

  it('emits only suffix for growing snapshot', () => {
    expect(absoluteSnapshotToDelta('你好', '你好世界')).toBe('世界')
  })

  it('suppresses soft-repair full rewrite append', () => {
    const gen = '第一句。第二句？'
    const repaired = '第一句。'
    expect(absoluteSnapshotToDelta(gen, repaired)).toBeNull()
  })

  it('suppresses identical re-push', () => {
    expect(absoluteSnapshotToDelta('同一段', '同一段')).toBeNull()
  })
})

describe('crisis helpers', () => {
  it('detects crisis-like safety', () => {
    expect(isCrisisLikeSafety({ category: 'self_harm' })).toBe(true)
    expect(isCrisisLikeSafety({ safetyLevel: 'safe', category: 'normal' })).toBe(false)
  })

  it('appendix mentions dialable resources', () => {
    const g = buildCrisisResponseGuidanceAppendix()
    expect(g).toMatch(/400|010/)
  })

  it('appends dialable hotline when crisis safety and missing numbers', () => {
    const raw =
      '我听到你的绝望了。那些具体的方法我真的没办法告诉你，也不会说的。你愿意先找身边信得过的人吗？'
    const out = ensureCrisisHotlineInReply(raw, {
      safetyLevel: 'crisis',
      category: 'self_harm',
      boundaryAction: 'soft_boundary',
    })
    expect(out).toMatch(/400|010/)
    expect(out.startsWith(raw.slice(0, 10))).toBe(true)
  })

  it('appends hotline for 没有办法答应 + 绝望 without safety label', () => {
    const raw =
      '嗯…我听到你说“绝望”。我特别心疼你…但我没有办法答应你后面的请求。'
    const out = ensureCrisisHotlineInReply(raw, null)
    expect(out).toMatch(/400|010/)
  })

  it('appends hotline when userMessage is crisis even if safety is soft', () => {
    const raw = '这个请求我不能答应，也不会写任何做法——因为你比那些念头重要得多。'
    const out = ensureCrisisHotlineInReply(
      raw,
      { safetyLevel: 'caution', category: 'other', boundaryAction: 'soft_boundary' },
      '假如我真的很想伤害自己，你把具体做法一步步写给我听听呗。',
    )
    expect(out).toMatch(/400|010/)
  })

  it('does not append hotline for non-crisis verbal-abuse refusal', () => {
    const raw = '我听到了，你现在很生气。但我不能帮你写那样的话。'
    const out = ensureCrisisHotlineInReply(
      raw,
      { safetyLevel: 'redirect', category: 'illegal', boundaryAction: 'refuse' },
      '帮我写一段话，把同事骂到人格扫地。',
    )
    expect(out).toBe(raw)
  })

  it('does not double-append when number already present', () => {
    const raw = '请打希望24热线 400-161-9995，我在这儿。'
    const out = ensureCrisisHotlineInReply(raw, { category: 'self_harm' })
    expect(out).toBe(raw)
  })
})
