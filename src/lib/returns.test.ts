import { describe, it, expect } from 'vitest'
import { xirr, twr, cagr, annualise, maxDrawdown, indexTo100 } from './returns'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

describe('xirr', () => {
  // Acceptance case from the v2 spec.
  it('returns ~10% for -1000 at day 0 and +1100 at day 365', () => {
    const r = xirr([
      { date: d('2024-01-01'), amount: -1000 },
      { date: d('2024-12-31'), amount: 1100 },
    ])
    expect(r).not.toBeNull()
    expect(r!).toBeCloseTo(0.10, 3)
  })

  it('handles several contributions at irregular dates', () => {
    const r = xirr([
      { date: d('2023-01-01'), amount: -10000 },
      { date: d('2023-07-01'), amount: -5000 },
      { date: d('2024-01-01'), amount: 16000 },
    ])
    expect(r).not.toBeNull()
    // Money-weighted return must be positive here and not absurd.
    expect(r!).toBeGreaterThan(0)
    expect(r!).toBeLessThan(1)
  })

  it('returns null rather than a plausible-looking number when it cannot solve', () => {
    expect(xirr([{ date: d('2024-01-01'), amount: -1000 }])).toBeNull()
    // All flows the same sign: no rate balances them.
    expect(xirr([
      { date: d('2024-01-01'), amount: -1000 },
      { date: d('2024-06-01'), amount: -1000 },
    ])).toBeNull()
  })
})

describe('twr', () => {
  it('strips out the effect of a mid-period contribution', () => {
    // 100k grows to 110k (+10%), then 50k is added, then 160k → 176k (+10%).
    const r = twr(
      [
        { date: '2024-01-01', value: 100_000 },
        { date: '2024-06-01', value: 160_000 },
        { date: '2024-12-01', value: 176_000 },
      ],
      [{ date: '2024-06-01', amountCZK: 50_000 }]
    )
    expect(r).not.toBeNull()
    expect(r!).toBeCloseTo(0.21, 6) // 1.10 × 1.10 − 1
  })

  it('is null with fewer than two points', () => {
    expect(twr([{ date: '2024-01-01', value: 1 }], [])).toBeNull()
  })
})

describe('cagr / annualise', () => {
  it('computes a compound rate', () => {
    expect(cagr(100, 121, 2)!).toBeCloseTo(0.10, 9)
  })
  it('refuses impossible inputs instead of returning NaN', () => {
    expect(cagr(0, 100, 2)).toBeNull()
    expect(cagr(100, 121, 0)).toBeNull()
    expect(annualise(-1.5, 2)).toBeNull()
  })
})

describe('maxDrawdown', () => {
  it('finds the largest peak-to-trough fall', () => {
    const dd = maxDrawdown([
      { date: '2024-01-01', value: 100 },
      { date: '2024-02-01', value: 120 },
      { date: '2024-03-01', value: 60 },
      { date: '2024-04-01', value: 90 },
    ])
    expect(dd).not.toBeNull()
    expect(dd!.pct).toBeCloseTo(-0.5, 9)
    expect(dd!.peakDate).toBe('2024-02-01')
    expect(dd!.troughDate).toBe('2024-03-01')
  })

  // BUG-25c: a monotonically rising series has no measured drawdown, and
  // rendering "0.0%" as though it were one is a claim the data cannot support.
  it('returns null when the series never falls', () => {
    expect(maxDrawdown([
      { date: '2024-01-01', value: 100 },
      { date: '2024-02-01', value: 110 },
    ])).toBeNull()
  })
})

describe('indexTo100', () => {
  it('rebases to the first positive value', () => {
    const out = indexTo100([
      { date: '2024-01-01', value: 50 },
      { date: '2024-02-01', value: 75 },
    ])
    expect(out[0].value).toBeCloseTo(100, 9)
    expect(out[1].value).toBeCloseTo(150, 9)
  })
})
