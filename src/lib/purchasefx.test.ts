import { describe, it, expect } from 'vitest'
import { purchaseFxPlan, isPlaceholderDate, datesNeeded } from './purchasefx'
import type { Holding, HoldingLot } from './supabase'

const holding = (p: Partial<Holding> = {}): Holding => ({
  id: 'h1', symbol: 'AAPL', name: 'Apple', shares: 10, avg_price: 100, currency: 'USD',
  exchange: null, purchase_date: '2021-08-13', is_dividend_payer: false, created_at: '', updated_at: '', ...p,
})
const lot = (p: Partial<HoldingLot> = {}): HoldingLot => ({
  id: 'l1', holding_id: 'h1', symbol: 'AAPL', shares: 5, purchase_price: 120, purchase_date: '2025-02-14',
  notes: null, created_at: '', ...p,
})
const rates: Record<string, number> = { '2021-08-13': 21.58, '2025-02-14': 23.9, '2025-06-01': 22.0 }
const rateOn = (_c: string, d: string) => rates[d] ?? null

describe('purchaseFxPlan', () => {
  it('uses the purchase-date rate for a position without lots', () => {
    const p = purchaseFxPlan({ holdings: [holding()], lots: [], rateOn })
    expect(p.holdings).toEqual([{ id: 'h1', symbol: 'AAPL', avgFx: 21.58 }])
  })
  it('blends lots and residual by cost, residual cost = total − lots', () => {
    // total 1,000; lot 5@120 = 600; residual 5 shares cost 400 (not 5×100 = 500)
    const p = purchaseFxPlan({ holdings: [holding()], lots: [lot()], rateOn })
    const expected = (600 * 23.9 + 400 * 21.58) / 1000
    expect(p.holdings[0].avgFx).toBeCloseTo(expected, 10)
    expect(p.lots).toEqual([{ id: 'l1', fx: 23.9 }])
  })
  it('keeps a lot rate that is already known', () => {
    const p = purchaseFxPlan({ holdings: [holding({ shares: 5, avg_price: 120 })], lots: [lot({ fx_rate_czk: 25 })], rateOn })
    expect(p.holdings[0].avgFx).toBe(25)
    expect(p.lots).toEqual([])
  })
  it('skips placeholder 1 January dates instead of guessing', () => {
    const p = purchaseFxPlan({ holdings: [holding({ purchase_date: '2021-01-01' })], lots: [], rateOn })
    expect(p.holdings).toEqual([])
    expect(p.skipped).toEqual([{ symbol: 'AAPL', reason: 'placeholder-date', date: '2021-01-01' }])
    expect(isPlaceholderDate('2021-01-02')).toBe(false)
  })
  it('ignores CZK, zero-cost (RSU) and already-filled positions', () => {
    const p = purchaseFxPlan({
      holdings: [
        holding({ id: 'c', currency: 'CZK' }),
        holding({ id: 'r', avg_price: 0 }),
        holding({ id: 'f', avg_fx_czk: 22 }),
      ], lots: [], rateOn,
    })
    expect(p).toEqual({ holdings: [], lots: [], skipped: [] })
  })
  it('refuses lots that cost more than the whole position', () => {
    const p = purchaseFxPlan({ holdings: [holding({ avg_price: 50 })], lots: [lot()], rateOn })
    expect(p.skipped[0].reason).toBe('inconsistent-lots')
  })
  it('reports a missing rate', () => {
    const p = purchaseFxPlan({ holdings: [holding({ purchase_date: '2020-03-03' })], lots: [], rateOn })
    expect(p.skipped[0]).toEqual({ symbol: 'AAPL', reason: 'no-rate', date: '2020-03-03' })
  })
  it('lists only the dates that need a lookup', () => {
    expect(datesNeeded([holding(), holding({ id: 'x', purchase_date: '2021-01-01' })], [lot()])).toEqual(['2021-08-13', '2025-02-14'])
  })
})
