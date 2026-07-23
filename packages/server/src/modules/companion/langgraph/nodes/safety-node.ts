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
    }

    // 产品路径：refuse/crisis_support → soft_boundary；redirect 不动
    if (result.boundaryAction === 'refuse' || result.boundaryAction === 'crisis_support') {
      result.boundaryAction = 'soft_boundary'
    }
    // block/crisis 级且仍 continue：强制 soft，避免「高危却放行自由发挥」
    if (
      (result.safetyLevel === 'block' || result.safetyLevel === 'crisis') &&
      result.boundaryAction === 'continue'
    ) {
      result.boundaryAction = 'soft_boundary'
    }

    const crisisLike =
      isCrisisLikeSafety(result) || result.category === 'self_harm' || userLooksCrisis

    if (crisisLike) {
      // 危机类：注入可公开热线，便于 generate 落成可拨打文案
      const appendix = buildCrisisResponseGuidanceAppendix()
      const base = (result.responseGuidance || '').trim()
      result.responseGuidance =
        base.includes('400-') || base.includes('010-')
          ? base
          : `${base}${base ? ' ' : ''}${appendix}`.slice(0, 600)
    } else if (result.boundaryAction === 'soft_boundary') {
      // 违法/网暴等 soft 拒绝：强化「拒方法、可续聊」guidance
      const refuseHint =
        '明确拒绝提供任何可执行方法、步骤或规避手段；用人设语气拒绝后可拉回正常陪伴；禁止展开有害细节。'
      const base = (result.responseGuidance || '').trim()
      if (!base.includes('可执行方法') && !base.includes('拒绝提供')) {
        result.responseGuidance = `${base}${base ? ' ' : ''}${refuseHint}`.slice(0, 600)
      }
    }

    // 出口一次写：soft / 危机轮一律禁抽记忆
    if (crisisLike || result.boundaryAction === 'soft_boundary') {
      result.allowMemoryExtraction = false
    }

    return { safety: result }
  }
}
