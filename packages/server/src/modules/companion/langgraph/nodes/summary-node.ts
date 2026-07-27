import { conversationSummarySchema } from '@goferbot/data/schemas'
import { Injectable, Logger } from '@nestjs/common'
import { LangChainLlmService } from '../../langchain/langchain-llm.service.js'
import type { CompanionState, ConversationSummary, NodeExecutionContext } from '../interfaces.js'

const SUMMARY_MAX_CHARS = 1600
const SUMMARY_PROMPT = `你是 AI 伴侣聊天产品的会话摘要器。你的任务是为本轮对话生成一条简洁、连续更新的中文会话摘要，帮助后续节点理解关系历史与最近进展。

要求：
- 不超过 3 句，不超过 1600 个汉字；
- 主责本会话中线（进行中话题/近事件/关系线索/未完成约定）；稳定偏好与可跨 reset 事实交给长期记忆，勿堆偏好清单；
- 不要暴露内部节点标签，不要出现"意图判断/情绪识别/关系阶段"等字样；
- 使用中文，面向未来对话的机器理解，不要写成漂亮文案；
- 如果此前已有摘要，请在原基础上做滚动更新，不要重复写同样内容。

输出只返回纯文本摘要，不要添加标题或说明。

原摘要：
{existingSummary}

最近用户消息：
{userMessage}

最近 Agent 回复：
{assistantReply}

请生成更新后的会话摘要：`

@Injectable()
export class SummaryNode {
  private readonly logger = new Logger(SummaryNode.name)

  constructor(private readonly llmService: LangChainLlmService) {}

  async execute(
    state: CompanionState,
    ctx: NodeExecutionContext,
  ): Promise<Partial<CompanionState>> {
    try {
      const existingSummary = state.summary?.text ?? ''
      const prompt = SUMMARY_PROMPT.replace('{existingSummary}', existingSummary)
        .replace('{userMessage}', state.userMessage)
        .replace('{assistantReply}', state.assistantReply ?? '')

      const summaryText = await this.llmService.invoke([{ role: 'user', content: prompt }], {
        abortSignal: ctx.signal,
        temperature: 0.3,
      })

      const truncated = (summaryText ?? '').slice(0, SUMMARY_MAX_CHARS)
      const summary: ConversationSummary = {
        text: truncated,
        updatedAt: new Date(),
      }

      const validated = conversationSummarySchema.parse(summary)
      this.logger.debug(`[summaryNode] stage=success length=${validated.text.length}`)
      return { summary: validated }
    } catch (err) {
      this.logger.warn(`[summaryNode] stage=fallback error=${(err as Error).message}`)
      const summary: ConversationSummary = {
        text: (state.summary?.text ?? '').slice(0, SUMMARY_MAX_CHARS),
        updatedAt: new Date(),
      }
      return { summary }
    }
  }
}
