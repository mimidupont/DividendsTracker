import { describe, it, expect } from 'vitest'
import { attributePeriod, attributionTotals } from './fxattribution'

const snap = (date: string, p: Record<string, number>) => ({ snapshot_date: date, ...p })

describe('attributePeriod', () => {
  it('splits a GBP move into its currency effect', () => {
    const rows = attributePeriod(
      snap('2026-01-01', { exposure_gbp_local: 10_000, fx_gbp: 27.5 }),
      snap('2026-02-01', { exposure_gbp_local: 10_000, fx_gbp: 25 }),
    )
    const gbp = rows.find(r => r.currency === 'GBP')!
    expect(gbp.currencyEffectCZK).toBeCloseTo(-25_000, 9)
    expect(gbp.assetEffectCZK).toBeCloseTo(0, 9)
  })

  it('keeps a deposit out of the asset effect', () => {
    const rows = attributePeriod(
      snap('2026-01-01', { exposure_czk_local: 1_000_000 }),
      snap('2026-02-01', { exposure_czk_local: 1_050_000 }),
      [{ date: '2026-01-15', amountCZK: 50_000 }],
    )
    const czk = rows.find(r => r.currency === 'CZK')!
    expect(czk.assetEffectCZK).toBe(0)
    expect(czk.flowsCZK).toBe(50_000)
    const t = attributionTotals(rows)
    expect(t.totalCZK).toBe(50_000)
  })

  it('reports untracked currencies as one unsplit row so totals reconcile', () => {
    const rows = attributePeriod(
      snap('2026-01-01', { exposure_other_czk: 100_000 }),
      snap('2026-02-01', { exposure_other_czk: 90_000 }),
    )
    expect(rows).toEqual([expect.objectContaining({ currency: 'Other', totalCZK: -10_000, unsplit: true })])
  })
})
