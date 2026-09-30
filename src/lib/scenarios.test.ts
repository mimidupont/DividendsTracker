import { describe, it, expect } from 'vitest'
import { applyScenario, DEFAULT_BOND_DURATION } from './scenarios'
import type { Position } from './portfolio'

const pos = (p: Partial<Position>): Position => ({
  id: p.label ?? 'x', assetClass: 'cash', label: 'x', name: 'x', currency: 'CZK', quantity: 1,
  valueLocal: 0, valueCZK: 0, costLocal: 0, costCZK: 0, sector: null, region: null,
  liquidityTier: 'instant', annualIncomeCZK: 0, isLiability: false, isLivePrice: true, ...p,
})
const plan = {
  annual_expenses_czk: 480_000, swr_pct: 0.04, expected_real_return: 0.05,
  monthly_contribution_czk: 20_000, include_primary_residence: false, include_property_in_fi: true,
}
const fx = { CZK: 1 }

describe('applyScenario', () => {
  it('delays FI by roughly the gap, not decades, after six months without income', () => {
    const ps = [pos({ label: 'cash', valueLocal: 500_000, valueCZK: 500_000 }),
                pos({ label: 'etf', assetClass: 'etf', valueLocal: 1_500_000, valueCZK: 1_500_000, liquidityTier: 'week' })]
    const r = applyScenario(ps, plan, { income_loss_months: 6 }, fx)
    expect(r.yearsToFIDelta!).toBeGreaterThan(0.4)
    expect(r.yearsToFIDelta!).toBeLessThan(2)
    // Six months of spending came out of cash.
    expect(r.byClass.cash.delta).toBeCloseTo(-240_000, 6)
  })

  it('moves bond prices by duration, leaving equities alone', () => {
    const ps = [pos({ label: 'b', assetClass: 'bond', valueLocal: 100_000, valueCZK: 100_000, duration: 5 }),
                pos({ label: 'f', assetClass: 'bond', valueLocal: 100_000, valueCZK: 100_000 }),
                pos({ label: 'e', assetClass: 'etf', valueLocal: 100_000, valueCZK: 100_000 })]
    const r = applyScenario(ps, plan, { rates_bp: 200 }, fx)
    expect(r.byClass.bond.delta).toBeCloseTo(-100_000 * 0.02 * (5 + DEFAULT_BOND_DURATION), 6)
    expect(r.byClass.etf.delta).toBe(0)
  })
})
