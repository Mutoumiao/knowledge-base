import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import type { PaginationResult } from '../../shared/interfaces/paginator.interface.js'

// 扩展 PrismaClient 类型
type ExtendedPrismaClient = ReturnType<typeof createExtendedPrismaClient>

interface MinimalModelDelegate {
  count(args?: Record<string, unknown>): Promise<number>
  findMany(args?: Record<string, unknown>): Promise<unknown[]>
}

function createExtendedPrismaClient(options?: Prisma.PrismaClientOptions) {
  const client = new PrismaClient(options)

  return client.$extends({
    model: {
      $allModels: {
        async paginate<T, A>(
          this: T,
          x: Prisma.Exact<
            A,
            Pick<Prisma.Args<T, 'findFirst'>, 'where' | 'select' | 'include' | 'orderBy'>
          >,
          options: { page: number; size: number },
        ): Promise<PaginationResult<Prisma.Result<T, A, 'findFirst'>>> {
          if (typeof x !== 'object' || x === null) {
            return {
              data: [],
              pagination: {
                total: 0,
                size: 0,
                totalPage: 0,
                currentPage: 0,
                hasNextPage: false,
                hasPrevPage: false,
              },
            } as unknown as PaginationResult<Prisma.Result<T, A, 'findFirst'>>
          }

          const { page, size: perPage } = options
          const skip = page > 0 ? perPage * (page - 1) : 0
          const xRecord = x as unknown as Record<string, unknown>
          const countArgs = xRecord.where ? { where: xRecord.where } : {}

          const model = this as unknown as MinimalModelDelegate
          const [total, data] = await Promise.all([
            model.count(countArgs),
            model.findMany({
              ...xRecord,
              take: perPage,
              skip,
            }),
          ])

          const lastPage = Math.ceil(total / perPage)

          return {
            data,
            pagination: {
              total,
              size: perPage,
              totalPage: lastPage,
              currentPage: page,
              hasNextPage: page < lastPage,
              hasPrevPage: page > 1,
            },
          } as unknown as PaginationResult<Prisma.Result<T, A, 'findFirst'>>
        },

        async exists<T, A>(
          this: T,
          x: Prisma.Exact<A, Pick<Prisma.Args<T, 'findFirst'>, 'where'>>,
        ): Promise<boolean> {
          if (typeof x !== 'object' || x === null || !('where' in x)) {
            return false
          }
          const xRecord = x as unknown as Record<string, unknown>
          const count = await (this as unknown as MinimalModelDelegate).count({
            where: xRecord.where,
          })
          return count > 0
        },
      },
    },
  })
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: ExtendedPrismaClient

  constructor(options?: Prisma.PrismaClientOptions) {
    this.client = createExtendedPrismaClient(options)
  }

  async onModuleInit() {
    await this.client.$connect()
  }

  async onModuleDestroy() {
    try {
      await this.client.$disconnect()
    } catch (err) {
      // ponytail: 忽略关闭连接时的异常，避免中断应用关闭流程
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`Prisma disconnect warning: ${msg}`)
    }
  }

  // 代理所有 PrismaClient 方法
  get user() {
    return this.client.user
  }

  get session() {
    return this.client.session
  }

  get message() {
    return this.client.message
  }

  get knowledgeBase() {
    return this.client.knowledgeBase
  }

  get folder() {
    return this.client.folder
  }

  get document() {
    return this.client.document
  }

  get chunk() {
    return this.client.chunk
  }

  get setting() {
    return this.client.setting
  }

  get companion() {
    return this.client.companion
  }

  get companionConversation() {
    return this.client.companionConversation
  }

  get companionMessage() {
    return this.client.companionMessage
  }

  get companionMemory() {
    return this.client.companionMemory
  }

  get companionMessageFeedback() {
    return this.client.companionMessageFeedback
  }

  get companionCarePlan() {
    return this.client.companionCarePlan
  }

  get companionCareEvent() {
    return this.client.companionCareEvent
  }

  get companionObsEvent() {
    return this.client.companionObsEvent
  }

  get observabilityTurn() {
    return this.client.observabilityTurn
  }

  get groupChat() {
    return this.client.groupChat
  }

  get groupChatMember() {
    return this.client.groupChatMember
  }

  get groupChatMessage() {
    return this.client.groupChatMessage
  }

  get authSession() {
    return this.client.authSession
  }

  get refreshToken() {
    return this.client.refreshToken
  }

  get userRole() {
    return this.client.userRole
  }

  get application() {
    return this.client.application
  }

  get applicationAuthMethod() {
    return this.client.applicationAuthMethod
  }

  get permission() {
    return this.client.permission
  }

  get rolePermission() {
    return this.client.rolePermission
  }

  get role() {
    return this.client.role
  }

  get invitationCode() {
    return this.client.invitationCode
  }

  get systemFlag() {
    return this.client.systemFlag
  }

  get adminAuditLog() {
    return this.client.adminAuditLog
  }

  // 通用代理方法
  $connect() {
    return this.client.$connect()
  }

  $disconnect() {
    return this.client.$disconnect()
  }

  $queryRaw(...args: unknown[]): unknown {
    return (this.client.$queryRaw as (...args: unknown[]) => unknown)(...args)
  }

  $executeRaw(...args: unknown[]): unknown {
    return (this.client.$executeRaw as (...args: unknown[]) => unknown)(...args)
  }

  // ponytail: Prisma extended client 的 transaction 类型复杂，使用 any 简化，调用方自行注解 tx 类型
  $transaction(...args: unknown[]): any {
    return (this.client.$transaction as (...a: unknown[]) => unknown)(...args)
  }
}
