import { ChatOpenAI } from '@langchain/openai'
import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { ConfigChangedEvent, MODEL_PROVIDER_ERROR_CODES } from '../../settings/constants.js'
import { ModelProviderService } from '../../settings/model-provider.service.js'
import { BaseProvider } from '../../settings/providers/base.provider.js'
import { ProviderRegistry } from '../../settings/providers/index.js'
import { SystemConfigService } from '../../settings/system-config.service.js'

@Injectable()
export class LlmConfigService implements OnModuleInit {
  private readonly logger = new Logger(LlmConfigService.name)
  private baseProvider: BaseProvider | null = null

  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly modelProviderService: ModelProviderService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshConfig()
  }

  @OnEvent('config.changed')
  async handleConfigChanged(event: ConfigChangedEvent): Promise<void> {
    if (event.category === 'companion' || event.category === 'providers') {
      await this.refreshConfig()
    }
  }

  private async refreshConfig(): Promise<void> {
    const config = await this.systemConfigService.getDecryptedSystemConfig()

    const providerRef = config.companion.provider
    if (!providerRef) {
      this.logger.debug('Companion LLM: 未配置')
      this.baseProvider = null
      return
    }

    try {
      const provider = this.modelProviderService.resolveProvider(
        'companion.provider',
        'llm',
        config,
      )
      this.baseProvider = await this.providerRegistry.get(provider.id, provider.model)
      this.logger.debug(`Companion LLM refreshed: ${provider.model}`)
    } catch (err) {
      this.logger.warn(
        `Companion LLM 配置失败：${err instanceof Error ? err.message : String(err)}`,
      )
      this.baseProvider = null
    }
  }

  /** 当前 Companion 模型 id（未配置时 null）；供 structured 方法链启发式使用 */
  getModelId(): string | null {
    return this.baseProvider?.model ?? null
  }

  createLangChainChatModel(
    overrides?: Partial<ConstructorParameters<typeof ChatOpenAI>[0]>,
  ): ChatOpenAI {
    if (!this.baseProvider) {
      throw new BadRequestException({
        code: MODEL_PROVIDER_ERROR_CODES.NOT_CONFIGURED,
        message: 'Companion LLM 未配置：请先在管理后台配置 companion 模型',
      })
    }

    this.logger.debug(`Creating LangChain model: ${this.baseProvider.model}`)
    return this.baseProvider.toLangChain(overrides as Record<string, unknown>) as ChatOpenAI
  }
}
