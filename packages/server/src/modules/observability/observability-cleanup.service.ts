import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ObservabilityTurnRepository } from './observability-turn.repository.js'

/**
 * W2 保留期批删（默认 30d）。失败仅日志，不阻断对话。
 * 多实例：deleteMany by id 幂等。
 */
@Injectable()
export class ObservabilityCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObservabilityCleanupService.name)
  private timer: ReturnType<typeof setInterval> | null = null
  private startTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly repo: ObservabilityTurnRepository) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.OBS_CLEANUP_INTERVAL_MS ?? String(60 * 60 * 1000))
    // 延迟首轮，避免启动尖峰
    const startDelay = Math.min(intervalMs, 60_000)
    this.startTimeout = setTimeout(() => {
      this.startTimeout = null
      void this.runOnce()
      this.timer = setInterval(() => void this.runOnce(), intervalMs)
      if (this.timer.unref) this.timer.unref()
    }, startDelay)
    if (this.startTimeout.unref) this.startTimeout.unref()
  }

  onModuleDestroy(): void {
    if (this.startTimeout) {
      clearTimeout(this.startTimeout)
      this.startTimeout = null
    }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async runOnce(): Promise<number> {
    const days = Number(process.env.OBS_TURN_RETENTION_DAYS ?? '30')
    const cutoff = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000)
    try {
      const deleted = await this.repo.deleteOlderThan(cutoff)
      if (deleted > 0) {
        this.logger.log(`W2 cleanup deleted ${deleted} rows older than ${cutoff.toISOString()}`)
      }
      return deleted
    } catch (err) {
      this.logger.warn(`W2 cleanup failed: ${err instanceof Error ? err.message : String(err)}`)
      return 0
    }
  }
}
