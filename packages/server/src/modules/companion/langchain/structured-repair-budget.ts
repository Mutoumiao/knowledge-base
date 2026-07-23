import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * 每轮 Companion 图执行的全局 repair 预算（默认 1 次）。
 *
 * **生产路径**：`CompanionGraphService.stream` 创建 `{ used, budget }` 对象，
 * 经 `configurable` → `NodeExecutionContext.structuredRepairBudget` →
 * `StructuredOutputOptions.repairBudget` 显式传入 `tryConsumeRepair(state)`。
 *
 * **ALS 包装**（`runWithStructuredRepairBudget*` / `runWithRepairBudgetState`）
 * 仅测试辅助或可选兼容；生产图执行不依赖 AsyncLocalStorage。
 */
export type StructuredRepairBudgetState = {
  used: number
  budget: number
}

const store = new AsyncLocalStorage<StructuredRepairBudgetState>()

export const DEFAULT_REPAIR_BUDGET_PER_TURN = 1

/** @internal 测试/可选：ALS 挂载预算。生产请传 explicit state。 */
export function runWithStructuredRepairBudget<T>(
  fn: () => T,
  budget: number = DEFAULT_REPAIR_BUDGET_PER_TURN,
): T {
  return store.run({ used: 0, budget }, fn)
}

/** @internal 测试/可选：ALS 异步挂载预算。生产请传 explicit state。 */
export async function runWithStructuredRepairBudgetAsync<T>(
  fn: () => Promise<T>,
  budget: number = DEFAULT_REPAIR_BUDGET_PER_TURN,
): Promise<T> {
  return store.run({ used: 0, budget }, fn)
}

/**
 * 若仍有预算则 +1 并返回 true，否则 false。
 * 优先使用显式 `state`（生产）；未传时回退 ALS（测试）。
 * 两者皆无时返回 false（禁止无界 repair）。
 */
export function tryConsumeRepair(state?: StructuredRepairBudgetState | null): boolean {
  const target = state ?? store.getStore()
  if (!target) return false
  if (target.used >= target.budget) return false
  target.used += 1
  return true
}

/** @internal 测试辅助 */
export function getRepairBudgetSnapshot(): StructuredRepairBudgetState | undefined {
  const state = store.getStore()
  if (!state) return undefined
  return { used: state.used, budget: state.budget }
}

/** @internal 测试辅助：在指定 ALS state 下执行 */
export function runWithRepairBudgetState<T>(
  state: StructuredRepairBudgetState,
  fn: () => T,
): T {
  return store.run(state, fn)
}
