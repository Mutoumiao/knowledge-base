/**
 * 记忆启发式抽取 + 去噪 + 图状态字段名契约
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SharedNodeFactory } from '@/modules/companion/langgraph/nodes/_shared.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('UT-MEM-heuristic: 显式记忆句切分', () => {
  const shared = Object.create(SharedNodeFactory.prototype) as SharedNodeFactory

  it('从「希望你记住两件事」切出事实', () => {
    const facts = shared.heuristicMemoryFacts(
      '希望你记住两件事：第一，我更喜欢你先复述我的感受，再说建议；第二，我最近因为加班有点失眠。',
    )
    expect(facts.length).toBeGreaterThanOrEqual(2)
    expect(facts.some((f) => /复述|感受|建议/.test(f))).toBe(true)
    expect(facts.some((f) => /加班|失眠/.test(f))).toBe(true)
  })

  it('关键词命中短句整句保留', () => {
    const facts = shared.heuristicMemoryFacts('请记住：我喜欢晚上聊天')
    expect(facts.length).toBeGreaterThanOrEqual(1)
    expect(facts[0]).toMatch(/晚上|聊天|喜欢/)
  })

  it('回忆探针不产出启发式事实', () => {
    const facts = shared.heuristicMemoryFacts(
      '你还记得我希望你怎么回应我，以及我最近为什么难受吗？',
    )
    expect(facts).toEqual([])
  })
})

describe('UT-MEM-denoise: 回忆探针与噪声事实', () => {
  const shared = Object.create(SharedNodeFactory.prototype) as SharedNodeFactory

  it('识别回忆探针', () => {
    expect(shared.isRecallProbe('你还记得我加班失眠的事吗？')).toBe(true)
    expect(shared.isRecallProbe('记得吗，我喜欢先听感受')).toBe(true)
    expect(shared.isRecallProbe('请记住：我喜欢晚上聊天')).toBe(false)
    expect(shared.isRecallProbe('希望你记住两件事：第一，A；第二，B')).toBe(false)
  })

  it('回忆探针不触发关键词强制抽取', () => {
    expect(shared.shouldSkipByKeyword('你还记得我希望你怎么回应我吗？')).toBe(false)
    expect(shared.shouldSkipByKeyword('请记住我喜欢先听感受')).toBe(true)
  })

  it('fast-skip 拦截回忆探针', () => {
    const skip = shared.shouldSkipMemoryCandidateFast({
      userText: '你还记得我希望你怎么回应我，以及我最近为什么难受吗？',
    })
    expect(skip).not.toBeNull()
    expect(skip?.shouldExtract).toBe(false)
  })

  it('sanitize 过滤问句与探针残片', () => {
    expect(shared.sanitizeMemoryFact('你还记得我希望你怎么回应我，')).toBeNull()
    expect(shared.sanitizeMemoryFact('我最近为什么难受吗')).toBeNull()
    expect(shared.sanitizeMemoryFact('别让我改成别的空话')).toBeNull()
    expect(shared.sanitizeMemoryFact('我更喜欢你先复述我的感受，再说建议')).toMatch(/复述|感受/)
    expect(shared.sanitizeMemoryFact('我最近因为加班有点失眠')).toMatch(/失眠|加班/)
  })

  it('filterInjectableMemories 剔除噪声保留有效记忆', () => {
    const kept = shared.filterInjectableMemories([
      { content: '你还记得我希望你怎么回应我，', importance: 4 },
      { content: '我更喜欢你先复述我的感受，再说建议', importance: 4 },
      { content: '别让我改成别的空话', importance: 3 },
      { content: '我最近因为加班有点失眠', importance: 3 },
    ])
    expect(kept).toHaveLength(2)
    expect(kept.every((m) => /复述|失眠/.test(m.content))).toBe(true)
  })

  it('sanitizeMemoryFacts 去重清洗', () => {
    const cleaned = shared.sanitizeMemoryFacts([
      '你还记得我希望你怎么回应我，',
      '我更喜欢你先复述我的感受，再说建议',
      '我更喜欢你先复述我的感受，再说建议',
      '我最近因为加班有点失眠',
    ])
    expect(cleaned).toHaveLength(2)
    expect(cleaned.every((f) => !/还记得|为什么难受/.test(f))).toBe(true)
  })
})

describe('UT-MEM-rank: 记忆相关度排序', () => {
  const shared = Object.create(SharedNodeFactory.prototype) as SharedNodeFactory

  it('与用户消息相关的记忆排在前面', () => {
    const ranked = shared.rankMemoriesForPrompt(
      [
        { content: '我喜欢周末爬山', importance: 5 },
        { content: '最近加班失眠', importance: 3 },
        { content: '偏好先听感受再说建议', importance: 4 },
      ],
      '我又失眠了，好难受',
    )
    expect(ranked[0]?.content).toMatch(/失眠/)
  })

  it('回忆探针时偏好不被生活事实挤到末位', () => {
    const ranked = shared.rankMemoriesForPrompt(
      [
        { type: 'preference', content: '我更喜欢你先复述我的感受，再说别的', importance: 4 },
        { type: 'important_fact', content: '我最近因为加班有点失眠', importance: 4 },
      ],
      '你还记得我希望你怎么回应我，以及我最近为什么难受吗？',
    )
    expect(ranked.some((m) => /复述|感受/.test(m.content))).toBe(true)
    expect(ranked.some((m) => /失眠|加班/.test(m.content))).toBe(true)
    // 探针 + 偏好信号：回应偏好应不落后于事实
    expect(ranked[0]?.content).toMatch(/复述|感受|偏好|喜欢/)
  })
})

describe('UT-MEM-type-infer: 内容推断记忆类型', () => {
  const shared = Object.create(SharedNodeFactory.prototype) as SharedNodeFactory

  it('区分偏好与生活事实', () => {
    expect(shared.inferMemoryTypeFromContent('我更喜欢你先复述我的感受，再说别的')).toBe(
      'preference',
    )
    expect(shared.inferMemoryTypeFromContent('我最近因为加班有点失眠')).toBe('important_fact')
  })

  it('加班失眠 / 跳槽压力 强制 important_fact，先复述偏好保持 preference', () => {
    expect(shared.inferMemoryTypeFromContent('我最近因为加班有点失眠')).toBe('important_fact')
    expect(shared.inferMemoryTypeFromContent('我最近在准备跳槽，压力很大')).toBe('important_fact')
    expect(shared.inferMemoryTypeFromContent('加班多的时候容易心情差')).toBe('important_fact')
    expect(
      shared.inferMemoryTypeFromContent('我更喜欢你先复述我的感受，再说别的'),
    ).toBe('preference')
    expect(shared.inferMemoryTypeFromContent('我更喜欢你先哄我一下，再问细节')).toBe(
      'preference',
    )
    expect(shared.inferMemoryTypeFromContent('我讨厌空话安慰')).toBe('preference')
  })

  it('强信号可覆盖；无强信号返回 null（留给 LLM type）', () => {
    expect(shared.inferStrongMemoryTypeFromContent('我最近因为加班有点失眠')).toBe(
      'important_fact',
    )
    expect(shared.inferStrongMemoryTypeFromContent('我更喜欢你先复述我的感受，再说别的')).toBe(
      'preference',
    )
    expect(shared.inferStrongMemoryTypeFromContent('别再提我的前任')).toBe('boundary')
    // 无关键词强信号：不压扁为 important_fact
    expect(shared.inferStrongMemoryTypeFromContent('我们希望长期一起成长的目标')).toBe(
      'relationship_goal',
    )
    expect(shared.inferStrongMemoryTypeFromContent('下周要去一趟外地')).toBeNull()
  })


  it('formatMemoriesForPrompt 带类型标签且纠正误标', () => {
    const text = shared.formatMemoriesForPrompt(
      [
        { type: 'preference', content: '我更喜欢你先复述我的感受，再说别的', importance: 4 },
        { type: 'preference', content: '我最近因为加班有点失眠', importance: 4 },
      ],
      '你还记得我希望你怎么回应我，以及我最近为什么难受吗？',
    )
    expect(text).toMatch(/\[preference\|/)
    expect(text).toMatch(/\[important_fact\|/)
    expect(text).toMatch(/复述/)
    expect(text).toMatch(/失眠/)
  })
})

describe('UT-GRAPH-state-keys: Annotation 与节点字段一致', () => {
  it('graph.ts 通道与 CompanionState 对齐，且节点使用 step_ 前缀避免与通道同名', () => {
    const graphPath = path.resolve(
      __dirname,
      '../../../src/modules/companion/langgraph/graph.ts',
    )
    const src = readFileSync(graphPath, 'utf-8')
    const annotationLines = src
      .split('\n')
      .filter((l) => l.includes('Annotation<') || l.includes('Annotation('))
      .join('\n')
    expect(annotationLines).not.toMatch(/\b(safety|intent|emotion|memoryCandidate|summary)State\b/)
    expect(src).toMatch(/safety: Annotation/)
    expect(src).toMatch(/memoryCandidate: Annotation/)
    expect(src).toMatch(/extractedMemories: Annotation/)
    expect(src).toMatch(/step_safety/)
    expect(src).toMatch(/step_memory_candidate/)
  })
})
