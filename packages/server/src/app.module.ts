import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AuthModule } from './auth/auth.module.js'
import { CommonModule } from './common/common.module.js'
import { AllExceptionsFilter } from './common/filters/all-exception.filter.js'
import { AppGuard } from './common/guards/app.guard.js'
import { SpiderGuard } from './common/guards/spider.guard.js'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js'
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js'
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js'
import { validateEnv } from './env.js'
import { AdminModule } from './modules/admin/admin.module.js'
import { ChatModule } from './modules/chat/chat.module.js'
import { CompanionModule } from './modules/companion/companion.module.js'
import { HealthModule } from './modules/health/health.module.js'
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module.js'
import { ObservabilityModule } from './modules/observability/observability.module.js'
import { SessionModule } from './modules/session/session.module.js'
import { SettingsModule } from './modules/settings/settings.module.js'
import { UserModule } from './modules/user/user.module.js'
import { KnowledgeAiModule } from './processors/knowledge-ai/knowledge-ai.module.js'
import { QueueModule } from './processors/queue/queue.module.js'
import { StorageModule } from './processors/storage/storage.module.js'
import { CacheModule } from './shared/cache/cache.module.js'

// ponytail: 使用 import.meta.url 定位 .env，避免 nest start --watch 在 dist/ 目录运行时 process.cwd() 漂移
// 编译后 app.module.js 位于 packages/server/dist/，到根目录需要上溯三层：dist → server → knowledge-base
const __dirname = dirname(fileURLToPath(import.meta.url))

// 分层环境变量加载路径（后加载的覆盖前者同名变量）：
// 1. packages/server/.env  — Server-Only 变量（JWT、端口、安全策略等）
// 2. 根目录 .env           — Docker-Infra + Shared 变量（数据库、Redis、MinIO 连接参数等）
//
// 详见 docs/guide/backend/configuration-guide.md
const SERVER_ENV_PATH = resolve(__dirname, '../.env')
const ROOT_ENV_PATH = resolve(__dirname, '../../../.env')

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [SERVER_ENV_PATH, ROOT_ENV_PATH],
      validate: (config) => validateEnv(config),
    }),
    EventEmitterModule.forRoot({
      wildcard: false,
      maxListeners: 50,
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60000,
          limit: 60,
        },
      ],
      // 非生产环境（开发 / E2E）跳过限流：本地批量请求与重复登录测试不再被 429。
      // skipIf 在 ThrottlerGuard 最先执行，故 @Throttle() 装饰的接口（如 auth 的 5 次/分）一并豁免。
      skipIf: () => process.env.NODE_ENV !== 'production',
    }),
    CommonModule,
    ObservabilityModule,
    HealthModule,
    CacheModule,
    UserModule,
    AuthModule,
    QueueModule.forRoot(),
    StorageModule,
    KnowledgeBaseModule,
    KnowledgeAiModule,
    SessionModule,
    ChatModule,
    CompanionModule,
    AdminModule,
    SettingsModule,
  ],
  providers: [
    // 全局响应拦截器
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    // 全局日志拦截器（开发环境内部静默）
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // 全局异常过滤器
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // 全局 Zod 验证管道
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
    // 全局速率限制守卫
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // 全局爬虫防护守卫
    {
      provide: APP_GUARD,
      useClass: SpiderGuard,
    },
    // 全局应用上下文隔离守卫
    {
      provide: APP_GUARD,
      useClass: AppGuard,
    },
  ],
})
export class AppModule {}
