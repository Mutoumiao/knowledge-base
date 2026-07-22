import { chatMessageFeedbackRequestSchema } from '@goferbot/data'
import { Body, Controller, Get, Logger, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { createZodDto } from 'nestjs-zod'
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js'
import { JwtAuthGuard } from '../../auth/guards/jwt.guard.js'
import { BypassResponse } from '../../common/decorators/bypass-response.decorator.js'
import { SseResponseHelper } from '../../common/helpers/sse-response.helper.js'
import { ChatService } from './chat.service.js'
import { ConversationService } from './conversation.service.js'
import { ChatMessagesDto, MessageListQueryDto } from './dto/chat.dto.js'
import { ModelRegistryService } from './model-registry.service.js'

class ChatMessageFeedbackDto extends createZodDto(chatMessageFeedbackRequestSchema) {}

@Controller('chat-messages')
@UseGuards(JwtAuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name)

  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    private readonly modelRegistry: ModelRegistryService,
    private readonly sseHelper: SseResponseHelper,
  ) {}

  @Post()
  @BypassResponse()
  async chat(
    @CurrentUser('id') userId: string,
    @Body() dto: ChatMessagesDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.chatService.validateChatAccess(userId, dto)

    const abortController = this.sseHelper.init(req, reply)

    try {
      const stream = this.chatService.streamChat(userId, dto, abortController)
      for await (const chunk of stream) {
        if (!this.sseHelper.write({ event: chunk.event, data: chunk })) {
          break
        }
      }
    } catch (err: unknown) {
      // C1: 过滤敏感信息，避免将 LLM 错误详情（可能含 API Key 提示）暴露给客户端
      this.logger.error(`SSE 流异常: ${err instanceof Error ? err.message : '未知错误'}`)
      this.sseHelper.writeError('服务暂时不可用，请稍后重试', {
        conversationId: dto.conversation_id,
      })
    } finally {
      this.sseHelper.end()
    }
  }

  @Get()
  async listMessages(@CurrentUser('id') userId: string, @Query() query: MessageListQueryDto) {
    await this.conversationService.ensureOwnership(userId, query.conversation_id)
    const result = await this.conversationService.paginateMessages(query.conversation_id, {
      page: query.page,
      size: query.size,
    })
    // 统一分页响应格式：前端 MessageListResponse 期望 { items, pagination }
    // 透出 status/metadata（含 sources / retrieval_empty）供历史回放
    const items = (result.data ?? []).map((m) => {
      const row = m as {
        id: string
        sessionId: string
        role: string
        content: string
        createdAt: Date | string
        status?: string | null
        metadata?: unknown
      }
      return {
        id: row.id,
        sessionId: row.sessionId,
        role: row.role,
        content: row.content,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : typeof row.createdAt === 'string'
              ? row.createdAt
              : new Date().toISOString(),
        status: row.status ?? undefined,
        metadata: row.metadata ?? null,
      }
    })
    return { items, pagination: result.pagination }
  }

  @Get('providers')
  async providers() {
    return { providers: this.modelRegistry.list() }
  }

  /** 知识库问答显式反馈 CTA */
  @Post('feedback')
  async feedback(@CurrentUser('id') userId: string, @Body() dto: ChatMessageFeedbackDto) {
    return this.chatService.submitFeedback(userId, dto)
  }
}
