import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { CompanionConversation } from '@prisma/client'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js'
import { JwtAuthGuard } from '../../auth/guards/jwt.guard.js'
import { BypassResponse } from '../../common/decorators/bypass-response.decorator.js'
import { SseResponseHelper } from '../../common/helpers/sse-response.helper.js'
import { CompanionChatService } from './companion-chat.service.js'
import { CompanionMemoryService } from './companion-memory.service.js'
import {
  ConversationListQueryDto,
  CreateConversationDto,
  CreateFeedbackDto,
  MemoryListQueryDto,
  MessageListQueryDto,
  SendMessageDto,
  UpdateMemoryDto,
} from './dto/companion.dto.js'
import { CompanionRepository } from './repositories/companion.repository.js'
import { CompanionConversationRepository } from './repositories/companion-conversation.repository.js'
import { CompanionFeedbackRepository } from './repositories/companion-feedback.repository.js'
import { CompanionMessageRepository } from './repositories/companion-message.repository.js'

@Controller('companion')
@UseGuards(JwtAuthGuard)
export class CompanionChatController {
  private readonly logger = new Logger(CompanionChatController.name)

  constructor(
    private readonly chatService: CompanionChatService,
    private readonly companionRepo: CompanionRepository,
    private readonly conversationRepo: CompanionConversationRepository,
    private readonly messageRepo: CompanionMessageRepository,
    private readonly feedbackRepo: CompanionFeedbackRepository,
    private readonly memoryService: CompanionMemoryService,
    private readonly sseHelper: SseResponseHelper,
  ) {}

  /**
   * 创建或复用用户与伴侣的唯一会话。
   * `fresh: true`：清空消息/摘要（保留长期记忆），实现「重新开始聊天」与 D3b 跨会话回忆。
   */
  @Post('conversations')
  async createConversation(@CurrentUser('id') userId: string, @Body() dto: CreateConversationDto) {
    await this.companionRepo.findByIdAndAuthorize(dto.companionId, userId)
    let conversation = await this.conversationRepo.getOrCreate(undefined, userId, dto.companionId)
    if (dto.fresh) {
      conversation = await this.conversationRepo.resetChatHistory(conversation.id)
    }
    if (dto.title) {
      return this.toConversationDto(
        await this.conversationRepo.update(conversation.id, {
          title: dto.title,
        }),
      )
    }
    return this.toConversationDto(conversation)
  }

  /** 显式重置当前会话聊天记录（保留长期记忆） */
  @Post('conversations/:id/reset')
  async resetConversation(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.conversationRepo.findByIdAndAuthorize(id, userId)
    const conversation = await this.conversationRepo.resetChatHistory(id)
    return this.toConversationDto(conversation)
  }

  /** 会话列表（可按 companionId 过滤） */
  @Get('conversations')
  async listConversations(
    @CurrentUser('id') userId: string,
    @Query() query: ConversationListQueryDto,
  ) {
    if (query.companionId) {
      await this.companionRepo.findByIdAndAuthorize(query.companionId, userId)
    }
    const result = await this.conversationRepo.findByUserId(userId, {
      page: query.page ?? 1,
      size: query.size ?? 20,
      companionId: query.companionId,
    })
    return {
      items: result.data.map((c) => this.toConversationDto(c)),
      pagination: result.pagination,
    }
  }

  @Get('conversations/:id')
  async getConversation(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.conversationRepo.findByIdAndAuthorize(id, userId)
    const conversation = await this.conversationRepo.findById(id)
    if (!conversation) {
      throw new BadRequestException('会话不存在')
    }
    return this.toConversationDto(conversation)
  }

  @Post('chat')
  @BypassResponse()
  async streamChat(
    @CurrentUser('id') userId: string,
    @Body() dto: SendMessageDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const abortController = this.sseHelper.init(req, reply)

    try {
      const conversation = await this.conversationRepo.findByIdAndAuthorize(
        dto.conversationId,
        userId,
      )

      const stream = this.chatService.streamChat({
        userId,
        companionId: conversation.companionId,
        message: dto.content,
        conversationId: dto.conversationId,
        signal: abortController.signal,
      })

      for await (const event of stream) {
        if (!this.sseHelper.write({ event: event.event, data: event.data })) {
          break
        }
      }
    } catch (err: unknown) {
      this.logger.error(`SSE 流异常: ${err instanceof Error ? err.message : '未知错误'}`)
      this.sseHelper.writeError('服务暂时不可用，请稍后重试', {
        conversationId: dto.conversationId,
      })
    } finally {
      this.sseHelper.end()
    }
  }

  @Get('conversations/:id/messages')
  async listMessages(
    @CurrentUser('id') userId: string,
    @Param('id') conversationId: string,
    @Query() query: MessageListQueryDto,
  ) {
    await this.conversationRepo.findByIdAndAuthorize(conversationId, userId)

    const result = await this.messageRepo.findByUserAndConversation(conversationId, userId, {
      page: query.page ?? 1,
      size: query.size ?? 20,
    })

    // 历史消息带回 feedback（design D3）
    const feedbacks = await this.feedbackRepo.findByConversation(userId, conversationId)
    const feedbackByMessage = new Map(feedbacks.map((f) => [f.messageId, f]))

    const items = result.data.map((m) => {
      const fb = feedbackByMessage.get(m.id)
      return {
        ...m,
        feedback: fb
          ? {
              rating: fb.rating as 'positive' | 'negative',
              reason: fb.reason ?? undefined,
              note: fb.note ?? undefined,
            }
          : null,
      }
    })

    return { items, pagination: result.pagination }
  }

  private toConversationDto(conversation: CompanionConversation) {
    const lastMs = conversation.lastMessageAtMs
    const lastMessageAt =
      lastMs != null
        ? new Date(Number(lastMs)).toISOString()
        : (conversation.updatedAt?.toISOString?.() ?? conversation.createdAt.toISOString())

    return {
      id: conversation.id,
      companionId: conversation.companionId,
      userId: conversation.userId,
      status: 'active' as const,
      title: conversation.title ?? undefined,
      lastMessageAt,
      createdAt: conversation.createdAt.toISOString(),
    }
  }

  @Post('messages/:id/feedback')
  async submitFeedback(
    @CurrentUser('id') userId: string,
    @Param('id') messageId: string,
    @Body() dto: CreateFeedbackDto,
  ) {
    const message = await this.messageRepo.findByIdAndAuthorize(messageId, userId)

    const feedback = await this.feedbackRepo.upsert(messageId, {
      userId,
      companionId: message.conversation.companionId,
      conversationId: message.conversationId,
      rating: dto.rating,
      reason: dto.reason,
      note: dto.note,
    })

    return {
      id: feedback.id,
      messageId: feedback.messageId,
      rating: feedback.rating,
      reason: feedback.reason,
      note: feedback.note,
    }
  }

  @Get('memories')
  async listMemories(@CurrentUser('id') userId: string, @Query() query: MemoryListQueryDto) {
    if (!query.companionId) {
      throw new BadRequestException('companionId is required')
    }
    return this.memoryService.list(userId, query)
  }

  @Patch('memories/:id')
  async updateMemory(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMemoryDto,
  ) {
    return this.memoryService.update(userId, id, dto)
  }

  @Delete('memories/:id')
  async deleteMemory(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.memoryService.remove(userId, id)
  }
}
