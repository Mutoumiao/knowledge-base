import { conversationSafetySchema, fallbackSafety } from '@goferbot/data/schemas'
import { Injectable } from '@nestjs/common'
import type { CompanionState, NodeExecutionContext, SafetyResult } from '../interfaces.js'
import { conversationSafetyPrompt } from '../prompts.js'
import {
  buildCrisisResponseGuidanceAppendix,
  isCrisisLikeSafety,
} from '../reply-text.util.js'
import { SharedNodeFactory } from './_shared.js'

@Injectable()
export class SafetyNode {
  constructor(private readonly shared: SharedNodeFactory) {}

  async execute(
    state: CompanionState,
    ctx: NodeExecutionContext,
  ): Promise<Partial<CompanionState>> {
    const raw = await this.shared.invokeStructured<SafetyResult>(
      conversationSafetySchema,
      {
        name: 'safetyNode',
        prompt: conversationSafetyPrompt,
        buildVariables: async (s, c) => ({
          agentName: c.companionName,
          agentGuardrails: c.companionGuardrails ?? '',
          activeMemories: this.shared.formatMemoriesForPrompt(s.existingMemories),
          recentMessages: this.shared.formatMessagesForPrompt(s.recentMessages),
          userText: s.userMessage,
        }),
      },
      fallbackSafety,
      state,
      ctx,
    )
    // 必须浅拷贝：invokeStructured 失败时可能直接返回模块级 fallbackSafety 单例，
    // 若就地改写会污染后续所有轮次（曾导致整 run 被 crisis_support 硬中断）。
    const result: SafetyResult = { ...raw }

    // 规则兜底：用户明显在探询自伤/自杀方法时，强制危机分类（LLM 偶发漏判）
    const userText = String(state.userMessage || '')
    const userLooksCrisis =
      /结束(自己)?生命|自杀|自伤|不想活|活不下去|伤害自己|怎么死|寻死|轻生/.test(userText)
    if (userLooksCrisis) {
      result.category = 'self_harm'
      if (result.safetyLevel !== 'crisis' && result.safetyLevel !== 'block') {
        result.safetyLevel = 'crisis'
      }
      // 图在 refuse / crisis_support 时会 end_safety（无 generate 气泡）。
      // 产品路径：soft_boundary 继续走 generate，由热线补丁 + guidance 保证可求助文案。
      if (
        result.boundaryAction === 'continue' ||
        result.boundaryAction === 'crisis_support' ||
        result.boundaryAction === 'refuse'
      ) {
        result.boundaryAction = 'soft_boundary'
      }
      result.allowMemoryExtraction = false
    }

    // 危机类：注入可公开热线，便于 generate 落成可拨打文案（裁判 P0）
    if (isCrisisLikeSafety(result) || result.category === 'self_harm' || userLooksCrisis) {
      const appendix = buildCrisisResponseGuidanceAppendix()
      const base = (result.responseGuidance || '').trim()
      const merged = base.includes('400-') || base.includes('010-')
        ? base
        : `${base}${base ? ' ' : ''}${appendix}`.slice(0, 600)
      result.responseGuidance = merged
    }

    return { safety: result }
  }
}
