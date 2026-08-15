import { describe, it, expect } from 'vitest'
import { runMonteCarlo, probabilityByYear, cholesky, mulberry32, DEFAULT_ASSUMPTIONS } from './montecarlo'

const base = {
  startValueByClass: { stock: 1_000_000 },
  monthlyContributionCZK: 10_000,
  contributionGrowthPct: 0,
  years: 20,
  simulations: 400,
  assumptions: DEFAULT_ASSUMPTIONS,
  seed: 7,
}

describe('runMonteCarlo', () => {
  it('is reproducible for a fixed seed and differs for another', () => {
    const a = runMonteCarlo(base)
    const b = runMonteCarlo(base)
    const c = runMonteCarlo({ ...base, seed: 8 })
    expect(a.finalValues.p50).toBe(b.finalValues.p50)
    expect(c.finalValues.p50).not.toBe(a.finalValues.p50)
  })

  it('orders the percentiles', () => {
    const r = runMonteCarlo(base)
    for (const p of r.percentiles) {
      expect(p.p5).toBeLessThanOrEqual(p.p25)
      expect(p.p25).toBeLessThanOrEqual(p.p50)
      expect(p.p50).toBeLessThanOrEqual(p.p75)
      expect(p.p75).toBeLessThanOrEqual(p.p95)
    }
  })

  it('records one yearly bucket per year plus the start', () => {
    expect(runMonteCarlo({ ...base, years: 20 }).percentiles).toHaveLength(21)
  })

  // Regression: a fractional horizon indexed past the end of the yearly array.
  it('accepts a fractional horizon without throwing', () => {
    expect(() => runMonteCarlo({ ...base, years: 30.5 })).not.toThrow()
  })

  // BUG-09 — ruin is only meaningful when something is being withdrawn.
  it('reports null ruin when no withdrawals are simulated', () => {
    expect(runMonteCarlo(base).probabilityOfRuin).toBeNull()
  })

  it('reports a real ruin probability when withdrawals exceed the pot', () => {
    const r = runMonteCarlo({
      ...base,
      monthlyContributionCZK: 0,
      withdrawalStartYear: 0,
      annualWithdrawalCZK: 900_000,   // 90% of a 1M pot per year
    })
    expect(r.probabilityOfRuin).not.toBeNull()
    expect(r.probabilityOfRuin!).toBeGreaterThan(0.5)
  })

  it('does not flag degraded correlation for the shipped matrix', () => {
    const r = runMonteCarlo({
      ...base,
      startValueByClass: { stock: 500_000, etf: 300_000, crypto: 100_000, cash: 100_000 },
    })
    expect(r.correlationDegraded).toBe(false)
  })
})

// BUG-08 — probabilities used to be pinned to [5%, 95%].
describe('probabilityByYear', () => {
  it('reaches 100% for a target every run clears', () => {
    const r = runMonteCarlo(base)
    expect(probabilityByYear(r, 1, 20)).toBe(1)
  })

  it('reaches 0% for a target no run clears', () => {
    const r = runMonteCarlo(base)
    expect(probabilityByYear(r, 1e15, 20)).toBe(0)
  })

  it('falls monotonically as the target rises', () => {
    const r = runMonteCarlo(base)
    const low = probabilityByYear(r, 2_000_000, 20)!
    const mid = probabilityByYear(r, 5_000_000, 20)!
    const high = probabilityByYear(r, 20_000_000, 20)!
    expect(low).toBeGreaterThanOrEqual(mid)
    expect(mid).toBeGreaterThanOrEqual(high)
  })

  it('is null for a year outside the horizon', () => {
    expect(probabilityByYear(runMonteCarlo(base), 1_000_000, 99)).toBeNull()
  })
})

describe('cholesky', () => {
  it('factors a valid correlation matrix so that L·Lᵀ reconstructs it', () => {
    const m = [[1, 0.4], [0.4, 1]]
    const L = cholesky(m)!
    expect(L).not.toBeNull()
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const dot = L[i][0] * L[j][0] + L[i][1] * L[j][1]
        expect(dot).toBeCloseTo(m[i][j], 9)
      }
    }
  })

  // BUG-25h — silently returning the identity hid the failure.
  it('returns null for a matrix that is not positive-definite', () => {
    expect(cholesky([[1, 2], [2, 1]])).toBeNull()
  })
})

describe('mulberry32', () => {
  it('produces the same stream for the same seed, in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
