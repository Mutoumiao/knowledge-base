import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Message } from '@prisma/client'
import { MessageRepository } from '../..//modules/session/repositories/message.repository.js'
import { SessionRepository } from '../../modules/session/repositories/session.repository.js'
import type { LlmProvider } from './llm/llm-provider.interface.js'

export interface ConversationContext {
  sessionId: string
  history: Array<{ role: string; content: string }>
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name)

  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly messageRepository: MessageRepository,
  ) {}

  async ensureOwnership(userId: string, sessionId: string): Promise<void> {
    const session = await this.sessionRepository.findById(sessionId)
    if (!session) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: '会话不存在',
      })
    }
    if (session.userId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '无权访问该会话',
      })
    }
  }

  async createSession(
    userId: string,
    title = '新对话',
  ): Promise<{ id: string; userId: string; title: string }> {
    return this.sessionRepository.create({ userId, title })
  }

  async saveUserMessage(sessionId: string, content: string): Promise<Message> {
    return this.messageRepository.create({
      sessionId,
      role: 'user',
      content,
    })
  }

  async saveAssistantMessage(
    sessionId: string,
    messageId: string,
    content: string,
    options?: { status?: string; metadata?: unknown },
  ): Promise<Message> {
    return this.messageRepository.create({
      id: messageId,
      sessionId,
      role: 'assistant',
      content,
      status: options?.status ?? 'completed',
      metadata: options?.metadata ?? undefined,
    })
  }

  async updateAssistantMessage(
    sessionId: string,
    messageId: string,
    data: { content?: string; status?: string; metadata?: unknown },
  ): Promise<Message> {
    const existing = await this.messageRepository.findById(messageId)
    if (!existing || existing.sessionId !== sessionId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: '消息不存在',
      })
    }
    return this.messageRepository.update(messageId, {
      content: data.content,
      status: data.status,
      metadata: data.metadata as object | undefined,
    })
  }

  async getMessage(sessionId: string, messageId: string): Promise<Message | null> {
    const existing = await this.messageRepository.findById(messageId)
    if (!existing || existing.sessionId !== sessionId) return null
    return existing
  }

  /**
   * 最近消息（含 metadata），供观测隐式拒绝等使用
   */
  async loadRecentMessages(
    sessionId: string,
    limit = 10,
  ): Promise<Array<{ role: string; content: string; metadata: unknown }>> {
    const messages = await this.messageRepository.findBySessionId(sessionId)
    return messages.slice(-limit).map((m) => ({
      role: m.role,
      content: m.content,
      metadata: m.metadata,
    }))
  }

  async loadHistory(
    sessionId: string,
    options?: { beforeMessageId?: string },
  ): Promise<Array<{ role: string; content: string }>> {
    const toHistory = (
      messages: Array<{ role: string; content: string; status?: string | null }>,
    ) =>
      messages
        .filter((m) => {
          if (m.role === 'user') return Boolean(m.content?.trim())
          if (m.role !== 'assistant') return false
          // Skip incomplete / failed assistant turns so they do not pollute L1 context
          if (m.status && m.status !== 'completed') return false
          return Boolean(m.content?.trim())
        })
        .map((m) => ({ role: m.role, content: m.content }))

    if (options?.beforeMessageId) {
      const beforeMessage = await this.messageRepository.findById(options.beforeMessageId)
      if (!beforeMessage || beforeMessage.sessionId !== sessionId) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'parent_message_id 不属于当前会话',
        })
      }
      const messages = await this.messageRepository.findUpToMessageId(
        sessionId,
        options.beforeMessageId,
        {
          select: { role: true, content: true, status: true },
        },
      )
      return toHistory(messages as Array<{ role: string; content: string; status?: string | null }>)
    }

    const messages = await this.messageRepository.findBySessionId(sessionId)
    return toHistory(messages)
  }

  async paginateMessages(sessionId: string, options: { page: number; size: number }) {
    return this.messageRepository.paginateBySessionId(sessionId, options)
  }

  async generateTitle(
    sessionId: string,
    userMessage: string,
    assistantMessage: string,
    provider: LlmProvider,
  ): Promise<void> {
    const session = await this.sessionRepository.findById(sessionId)
    if (!session) return
    if (session.title !== '新对话' && session.title !== '会话页') return

    const messages = [
      {
        role: 'system' as const,
        content:
          '你是一个标题生成助手。请根据对话内容生成一个5-10字的简短中文标题，只返回标题本身，不要有任何额外内容或标点解释。',
      },
      { role: 'user' as const, content: `用户：${userMessage}\nAI：${assistantMessage}` },
    ]

    try {
      // H3: 添加 10 秒超时，防止标题生成阻塞
      const title = await Promise.race([
        provider.invoke(messages),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('TITLE_TIMEOUT')), 10_000),
        ),
      ])
      const cleanedTitle = this.cleanTitle(title)
      await this.sessionRepository.update(sessionId, { title: cleanedTitle })
    } catch (err) {
      // 标题生成失败不影响主流程
      if (err instanceof Error && err.message === 'TITLE_TIMEOUT') {
        this.logger?.warn(`生成标题超时 sessionId=${sessionId}`)
      }
    }
  }

  private cleanTitle(title: string): string {
    const cleaned = title
      .replace(/[\n\r\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^["']|["']$/g, '')
    if (!cleaned) return '新对话'
    if (cleaned.length > 30) return cleaned.slice(0, 30)
    return cleaned
  }
}
