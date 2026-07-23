import { describe, expect, it, vi } from 'vitest'
import {
  runWithRepairBudgetState,
  tryConsumeRepair,
} from '@/modules/companion/langchain/structured-repair-budget.js'

describe('structured repair budget (D10)', () => {
  it('allows only 1 consume per turn state', () => {
    const state = { used: 0, budget: 1 }
    expect(tryConsumeRepair(state)).toBe(true)
    expect(state.used).toBe(1)
    expect(tryConsumeRepair(state)).toBe(false)
    expect(state.used).toBe(1)
  })

  it('without state returns false (no unbounded repair)', () => {
    expect(tryConsumeRepair(null)).toBe(false)
    expect(tryConsumeRepair(undefined)).toBe(false)
  })

  it('shared state across nodes caps total repairs at 1', () => {
    const state = { used: 0, budget: 1 }
    const invokeNode = vi.fn((budget: { used: number; budget: number }) => {
      // simulate parse fail → try repair
      return tryConsumeRepair(budget)
    })

    const first = invokeNode(state)
    const second = invokeNode(state)
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(invokeNode).toHaveBeenCalledTimes(2)
  })

  it('ALS helper works for isolated tests', () => {
    const state = { used: 0, budget: 1 }
    runWithRepairBudgetState(state, () => {
      expect(tryConsumeRepair()).toBe(true)
      expect(tryConsumeRepair()).toBe(false)
    })
  })
})
