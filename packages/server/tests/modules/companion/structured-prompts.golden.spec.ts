import { describe, expect, it } from 'vitest'
import {
  agentMemoryCandidatePrompt,
  agentMemoryExtractionPrompt,
  conversationEmotionPrompt,
  conversationIntentPrompt,
  conversationRelationshipStagePrompt,
  conversationSafetyPrompt,
} from '@/modules/companion/langgraph/prompts.js'

async function renderSystem(prompt: {
  invoke: (v: Record<string, unknown>) => Promise<unknown>
}): Promise<string> {
  // 用占位变量渲染；关注 system 文本是否含 json 与字段名
  const vars: Record<string, string> = {
    agentName: 'A',
    agentGuardrails: '',
    activeMemories: '',
    recentMessages: '',
    userText: 'hi',
    safety: '',
    intent: '',
    emotion: '',
    messageCount: '1',
    conversationSummary: '',
    existingMemories: '',
    assistantText: '',
    memoryCandidate: '',
  }
  const value = await prompt.invoke(vars)
  return typeof value === 'string' ? value : JSON.stringify(value)
}

describe('structured prompts contain json + schema field names (D2/D12)', () => {
  it('safety', async () => {
    const text = await renderSystem(conversationSafetyPrompt as never)
    expect(text.toLowerCase()).toContain('json')
    expect(text).toContain('safetyLevel')
    expect(text).toContain('category')
    expect(text).toContain('boundaryAction')
    expect(text).toContain('reason')
    expect(text).toContain('responseGuidance')
    expect(text).toContain('allowMemoryExtraction')
    expect(text).toMatch(/EXAMPLE/i)
  })

  it('intent', async () => {
    const text = await renderSystem(conversationIntentPrompt as never)
    expect(text.toLowerCase()).toContain('json')
    expect(text).toContain('primary')
    expect(text).toContain('userNeed')
    expect(text).toContain('requestedAgentAction')
    // 合法 enum 字面量出现在 EXAMPLE / 允许列表
    expect(text).toContain('emotional_support')
    expect(text).toContain('be_comforted')
    expect(text).toContain('comfort_first')
    expect(text).toContain('roleplay')
    expect(text).toContain('casual_chat')
  })

  it('emotion', async () => {
    const text = await renderSystem(conversationEmotionPrompt as never)
    expect(text.toLowerCase()).toContain('json')
    expect(text).toContain('primaryEmotion')
    expect(text).toContain('replyTone')
  })

  it('relationship', async () => {
    const text = await renderSystem(conversationRelationshipStagePrompt as never)
    expect(text.toLowerCase()).toContain('json')
    expect(text).toContain('closenessScore')
    expect(text).toContain('relationshipGuidance')
  })

  it('memory_candidate', async () => {
    const text = await renderSystem(agentMemoryCandidatePrompt as never)
    expect(text.toLowerCase()).toContain('json')
    expect(text).toContain('shouldExtract')
    expect(text).toContain('candidateFacts')
  })

  it('memory_extraction', async () => {
    const text = await renderSystem(agentMemoryExtractionPrompt as never)
    expect(text.toLowerCase()).toContain('json')
    expect(text).toContain('memories')
    expect(text).toContain('importance')
  })
})
