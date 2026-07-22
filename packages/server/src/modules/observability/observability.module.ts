import { Global, Module } from '@nestjs/common'
import { LangfuseAdapter } from './langfuse.adapter.js'
import { ObservabilityCleanupService } from './observability-cleanup.service.js'
import { ObservabilityTurnRepository } from './observability-turn.repository.js'
import { ObservabilityTurnService } from './observability-turn.service.js'

@Global()
@Module({
  providers: [
    LangfuseAdapter,
    ObservabilityTurnRepository,
    ObservabilityTurnService,
    ObservabilityCleanupService,
  ],
  exports: [LangfuseAdapter, ObservabilityTurnRepository, ObservabilityTurnService],
})
export class ObservabilityModule {}
