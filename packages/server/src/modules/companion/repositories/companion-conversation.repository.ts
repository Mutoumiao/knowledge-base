import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { CompanionConversation, CompanionMessage, Prisma } from '@prisma/client'
import { PrismaService } from '../../../processors/database/prisma.service.js'
import type { PaginationResult } from '../../../shared/interfaces/paginator.interface.js'

@Injectable()
export class CompanionConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.CompanionConversationCreateInput): Promise<CompanionConversation> {
    return this.prisma.companionConversation.create({ data })
  }

  async findById(
    id: string,
  ): Promise<(CompanionConversation & { messages?: CompanionMessage[] }) | null> {
    return this.prisma.companionConversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
  }

  async findByUserAndCompanion(
    userId: string,
    companionId: string,
  ): Promise<CompanionConversation | null> {
    return this.prisma.companionConversation.findUnique({
      where: { userId_companionId: { userId, companionId } },
    })
  }

  async getOrCreate(
    id: string | undefined,
    userId: string,
    companionId: string,
  ): Promise<CompanionConversation> {
    if (id) {
      const found = await this.findById(id)
      if (found) return found
    }
    const existing = await this.findByUserAndCompanion(userId, companionId)
    if (existing) return existing
    return this.create({
      user: { connect: { id: userId } },
      companion: { connect: { id: companionId } },
    })
  }

  /**
   * 「新会话」语义（唯一会话模型下）：清空消息与反馈、摘要与计数。
   * 长期记忆按 user×companion 保留，供跨会话回忆。
   */
  async resetChatHistory(conversationId: string): Promise<CompanionConversation> {
    await this.prisma.companionMessageFeedback.deleteMany({ where: { conversationId } })
    await this.prisma.companionMessage.deleteMany({ where: { conversationId } })
    return this.prisma.companionConversation.update({
      where: { id: conversationId },
      data: {
        summary: null,
        messageCount: 0,
        lastMessageAtMs: null,
      },
    })
  }

  async findByUserId(
    userId: string,
    options?: { page?: number; size?: number; companionId?: string },
  ): Promise<PaginationResult<CompanionConversation>> {
    const where: Prisma.CompanionConversationWhereInput = { userId }
    if (options?.companionId) where.companionId = options.companionId

    if (options?.page && options?.size) {
      const result = await this.prisma.companionConversation.paginate(
        { where, orderBy: { updatedAt: 'desc' } },
        { page: options.page, size: options.size },
      )
      return result as unknown as PaginationResult<CompanionConversation>
    }

    const data = await this.prisma.companionConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    })

    return {
      data,
      pagination: {
        total: data.length,
        size: data.length,
        totalPage: 1,
        currentPage: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    }
  }

  async update(
    id: string,
    data: Prisma.CompanionConversationUpdateInput,
  ): Promise<CompanionConversation> {
    return this.prisma.companionConversation.update({ where: { id }, data })
  }

  async incrementMessageCount(id: string): Promise<CompanionConversation> {
    return this.prisma.companionConversation.update({
      where: { id },
      data: {
        messageCount: { increment: 1 },
        lastMessageAtMs: BigInt(Date.now()),
      },
    })
  }

  async updateSummary(id: string, summaryText: string): Promise<CompanionConversation> {
    return this.prisma.companionConversation.update({
      where: { id },
      data: { summary: summaryText },
    })
  }

  async delete(id: string): Promise<CompanionConversation> {
    return this.prisma.companionConversation.delete({ where: { id } })
  }

  async findByIdAndAuthorize(id: string, userId: string): Promise<CompanionConversation> {
    const conversation = await this.prisma.companionConversation.findUnique({
      where: { id },
      select: { userId: true, id: true, companionId: true },
    })
    if (!conversation) throw new NotFoundException('会话不存在')
    if (conversation.userId !== userId) throw new ForbiddenException('无权访问此会话')
    return conversation as CompanionConversation
  }
}
