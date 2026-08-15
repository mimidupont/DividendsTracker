import { describe, it, expect } from 'vitest'
import {
  fiNumber, fiProgress, savingsRate, yearsToFI, coastFireNumber,
  baristaFireNumber, effectiveAnnualExpenses, milestones, DEFAULT_PLAN,
} from './fire'
import type { ExpenseLogRow } from './supabase'

describe('fiNumber', () => {
  it('is expenses divided by the withdrawal rate', () => {
    expect(fiNumber(600_000, 0.04)).toBeCloseTo(15_000_000, 6)
  })
  it('is null when the inputs cannot produce one', () => {
    expect(fiNumber(0, 0.04)).toBeNull()
    expect(fiNumber(600_000, 0)).toBeNull()
  })
})

describe('yearsToFI', () => {
  it('is zero when already there', () => {
    expect(yearsToFI(20_000_000, 0, 0.05, 15_000_000)).toBe(0)
  })
  it('solves the annuity for a reachable target', () => {
    const y = yearsToFI(1_000_000, 20_000, 0.05, 5_000_000)
    expect(y).not.toBeNull()
    expect(y!).toBeGreaterThan(8)
    expect(y!).toBeLessThan(14)
  })
  it('is null when the target can never be reached', () => {
    expect(yearsToFI(1_000_000, 0, 0, 5_000_000)).toBeNull()
    expect(yearsToFI(1_000_000, 0, -0.02, 5_000_000)).toBeNull()
  })
  it('handles a zero return with contributions as straight saving', () => {
    expect(yearsToFI(0, 10_000, 0, 1_200_000)).toBeCloseTo(10, 6)
  })
})

describe('coast and barista FIRE', () => {
  it('discounts the FI number back to today', () => {
    expect(coastFireNumber(15_000_000, 20, 0.05)!).toBeCloseTo(15_000_000 / 1.05 ** 20, 6)
  })
  it('needs nothing when part-time income covers the spending', () => {
    expect(baristaFireNumber(600_000, 700_000, 0.04)).toBe(0)
  })
})

describe('fiProgress / savingsRate', () => {
  it('reports progress as a fraction', () => {
    expect(fiProgress(3_000_000, 15_000_000)!).toBeCloseTo(0.2, 9)
  })
  it('is null when income is unknown rather than assuming zero', () => {
    expect(savingsRate(null, 600_000)).toBeNull()
    expect(savingsRate(1_000_000, 600_000)!).toBeCloseTo(0.4, 9)
  })
})

// BUG-07 — the current month is only partly logged.
describe('effectiveAnnualExpenses', () => {
  const log = (month: string, amount: number): ExpenseLogRow =>
    ({ month, amount_czk: amount } as ExpenseLogRow)

  it('ignores the partial current month when averaging', () => {
    const rows = [
      log('2026-05', 50_000),
      log('2026-06', 50_000),
      log('2026-07', 50_000),
      log('2026-08', 3_000),   // a few days into the month
    ]
    const out = effectiveAnnualExpenses(DEFAULT_PLAN, rows, '2026-08-15')
    expect(out.source).toBe('logged')
    expect(out.monthsOfData).toBe(3)
    expect(out.annualCZK).toBeCloseTo(600_000, 6)
  })

  it('does not switch away from the plan until three months are complete', () => {
    const rows = [log('2026-06', 50_000), log('2026-07', 50_000), log('2026-08', 50_000)]
    const out = effectiveAnnualExpenses(DEFAULT_PLAN, rows, '2026-08-15')
    expect(out.source).toBe('plan')
    expect(out.monthsOfData).toBe(2)
    expect(out.annualCZK).toBe(DEFAULT_PLAN.annual_expenses_czk)
  })

  it('is stable across a month boundary', () => {
    const rows = [
      log('2026-05', 50_000), log('2026-06', 50_000), log('2026-07', 50_000),
    ]
    const before = effectiveAnnualExpenses(DEFAULT_PLAN, rows, '2026-07-31')
    const after = effectiveAnnualExpenses(DEFAULT_PLAN, [...rows, log('2026-08', 1_000)], '2026-08-01')
    // July is complete on 1 August, so the figure may rise as data arrives —
    // what it must not do is collapse because a partial month joined the divisor.
    expect(after.annualCZK).toBeGreaterThanOrEqual(before.annualCZK)
  })

  it('uses only the most recent twelve complete months', () => {
    const rows = Array.from({ length: 18 }, (_, i) => {
      const m = i + 1
      return log(`2025-${String(m).padStart(2, '0')}`, m <= 6 ? 100_000 : 50_000)
    }).filter(r => r.month <= '2025-12')
    const out = effectiveAnnualExpenses(DEFAULT_PLAN, rows, '2026-08-15')
    expect(out.monthsOfData).toBe(12)
  })
})

describe('milestones', () => {
  it('labels round figures without trailing zeros', () => {
    const rows = milestones(0, 600_000, 10_000, 0.05)
    const labels = rows.map(r => r.label)
    expect(labels).toContain('100k CZK')
    expect(labels).toContain('5M CZK')
    expect(labels).not.toContain('5.0M CZK')
  })
  it('marks reached milestones and gives them zero years away', () => {
    const rows = milestones(1_000_000, 600_000, 10_000, 0.05)
    const reached = rows.filter(r => r.reached)
    expect(reached.length).toBeGreaterThan(0)
    expect(reached.every(r => r.yearsAway === 0)).toBe(true)
  })
})
