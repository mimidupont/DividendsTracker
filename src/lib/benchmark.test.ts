import { describe, it, expect } from 'vitest'
import { shadowPortfolio, benchmarkReturn } from './benchmark'
import { twr } from './returns'
import type { BenchmarkPrice } from './supabase'

const px = (date: string, close: number): BenchmarkPrice =>
  ({ id: date, symbol: 'SPY', price_date: date, close, currency: 'USD' })
const flat = [px('2026-01-01', 100), px('2026-02-01', 100), px('2026-03-01', 100)]
const fx = { '2026-01-01': 20 }

describe('benchmark return', () => {
  it('does not count replayed contributions as return', () => {
    const flows = [{ date: '2026-01-01', amountCZK: 100_000 }, { date: '2026-02-01', amountCZK: 100_000 }]
    const shadow = shadowPortfolio(flows, flat, fx)
    // The shadow doubles purely from deposits…
    expect(shadow[shadow.length - 1].valueCZK / shadow[0].valueCZK).toBeCloseTo(2, 9)
    // …but the index itself returned nothing.
    expect(benchmarkReturn(flat, fx, '2026-01-01', '2026-03-01')).toBeCloseTo(0, 12)
    const series = shadow.map(p => ({ date: p.date, value: p.valueCZK }))
    expect(twr(series, flows.slice(1))).toBeCloseTo(0, 9)
  })

  it('includes the currency move', () => {
    const r = benchmarkReturn(flat, { '2026-01-01': 20, '2026-03-01': 22 }, '2026-01-01', '2026-03-01')
    expect(r).toBeCloseTo(0.1, 12)
  })

  it('seeds the shadow with the opening balance', () => {
    const shadow = shadowPortfolio([{ date: '2026-02-01', amountCZK: 100_000 }], flat, fx,
      { openingValueCZK: 1_000_000, from: '2026-01-01' })
    expect(shadow[0].valueCZK).toBeCloseTo(1_000_000, 6)
    expect(shadow[shadow.length - 1].valueCZK).toBeCloseTo(1_100_000, 6)
  })
})
