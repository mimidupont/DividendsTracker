/**
 * montecarlo.ts — projection under uncertainty.
 *
 * The width of the band is the honest part of the answer. A single "you will
 * have X in 20 years" line is a prediction nobody can make; a fan chart at
 * least shows how much the assumptions are doing.
 *
 * Runs are seeded so the same inputs give the same fan — a chart that jumps on
 * every refresh teaches users to distrust it.
 */
import type { AssetClass } from './portfolio'

export interface MarketAssumptionInput {
  assetClass: AssetClass
  /** Real (after-inflation) expected annual return, as a fraction. */
  expectedRealReturn: number
  /** Annualised volatility, as a fraction. */
  volatility: number
}

export interface McConfig {
  startValueByClass: Partial<Record<AssetClass, number>>
  monthlyContributionCZK: number
  /** Annual raise applied to the contribution, as a fraction. */
  contributionGrowthPct: number
  years: number
  simulations: number
  assumptions: MarketAssumptionInput[]
  seed?: number
  withdrawalStartYear?: number
  annualWithdrawalCZK?: number
  /** Target to measure success against (usually the FI number). */
  targetCZK?: number
}

export interface Percentiles {
  year: number
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
}

export interface McResult {
  percentiles: Percentiles[]
  finalValues: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number }
  /** P(ending value ≥ target). Null when no target was supplied. */
  probabilityOfTarget: number | null
  /** P(hitting zero before the horizon) — only meaningful with withdrawals. */
  probabilityOfRuin: number
  medianYearReachingTarget: number | null
  /** Every simulation's ending value, for the histogram. */
  finalDistribution: number[]
  simulations: number
}

export const DEFAULT_ASSUMPTIONS: MarketAssumptionInput[] = [
  { assetClass: 'stock',      expectedRealReturn: 0.055, volatility: 0.16 },
  { assetClass: 'etf',        expectedRealReturn: 0.055, volatility: 0.16 },
  { assetClass: 'crypto',     expectedRealReturn: 0.08,  volatility: 0.70 },
  { assetClass: 'cash',       expectedRealReturn: 0.005, volatility: 0.01 },
  { assetClass: 'realestate', expectedRealReturn: 0.03,  volatility: 0.10 },
]

/**
 * Correlation between asset classes. Rough but deliberate: pretending crypto
 * and equities are independent would understate the fat left tail, which is
 * exactly the part of the distribution that matters.
 */
export const CORRELATIONS: Record<string, number> = {
  'stock|etf': 0.98,
  'stock|crypto': 0.4,
  'stock|realestate': 0.3,
  'stock|cash': 0.0,
  'etf|crypto': 0.4,
  'etf|realestate': 0.3,
  'etf|cash': 0.0,
  'crypto|realestate': 0.15,
  'crypto|cash': 0.0,
  'realestate|cash': 0.0,
}

function correlationOf(a: AssetClass, b: AssetClass): number {
  if (a === b) return 1
  return CORRELATIONS[`${a}|${b}`] ?? CORRELATIONS[`${b}|${a}`] ?? 0
}

/** mulberry32 — small, fast, seedable. Reproducibility matters more than crypto quality here. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller transform: uniform → standard normal. */
function gaussian(rand: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Cholesky decomposition, used to turn independent normals into correlated ones.
 * Falls back to the identity if the matrix is not positive-definite, which
 * degrades to uncorrelated draws rather than producing NaNs.
 */
export function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k]
      if (i === j) {
        const d = matrix[i][i] - sum
        if (d <= 0) return Array.from({ length: n }, (_, r) =>
          Array.from({ length: n }, (_, c) => (r === c ? 1 : 0)))
        L[i][j] = Math.sqrt(d)
      } else {
        if (L[j][j] === 0) return Array.from({ length: n }, (_, r) =>
          Array.from({ length: n }, (_, c) => (r === c ? 1 : 0)))
        L[i][j] = (matrix[i][j] - sum) / L[j][j]
      }
    }
  }
  return L
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/**
 * Run the simulation.
 *
 * Monthly steps with log-normal returns:
 *   μ_m = ln(1+μ)/12 − σ_m²/2 ,  r_m = exp(μ_m + σ_m·z) − 1
 * The −σ²/2 drift adjustment is what makes the *arithmetic* mean of the
 * resulting path match the expected return rather than exceeding it.
 */
export function runMonteCarlo(config: McConfig): McResult {
  const classes = (Object.keys(config.startValueByClass) as AssetClass[])
    .filter(c => (config.startValueByClass[c] ?? 0) !== 0)

  const sims = Math.max(1, Math.floor(config.simulations || 1000))
  const months = Math.max(1, Math.round(config.years * 12))
  const rand = mulberry32(config.seed ?? 12345)

  // Assumptions per class, defaulted when missing
  const params = classes.map(c => {
    const a = config.assumptions.find(x => x.assetClass === c)
      ?? DEFAULT_ASSUMPTIONS.find(x => x.assetClass === c)
      ?? { assetClass: c, expectedRealReturn: 0.04, volatility: 0.15 }
    const sigmaM = a.volatility / Math.sqrt(12)
    return {
      assetClass: c,
      sigmaM,
      muM: Math.log(1 + a.expectedRealReturn) / 12 - (sigmaM * sigmaM) / 2,
    }
  })

  const corr = classes.map(a => classes.map(b => correlationOf(a, b)))
  const L = cholesky(corr)

  // Yearly snapshots of every simulation
  const yearlyValues: number[][] = Array.from({ length: config.years + 1 }, () => [])
  const finalValues: number[] = []
  let ruinCount = 0
  const yearReachedTarget: number[] = []

  const withdrawalStartMonth = config.withdrawalStartYear != null
    ? config.withdrawalStartYear * 12
    : Infinity
  const monthlyWithdrawal = (config.annualWithdrawalCZK ?? 0) / 12

  for (let s = 0; s < sims; s++) {
    const values = classes.map(c => config.startValueByClass[c] ?? 0)
    let contribution = config.monthlyContributionCZK
    let ruined = false
    let reachedYear: number | null = null

    yearlyValues[0].push(values.reduce((a, b) => a + b, 0))

    for (let m = 1; m <= months; m++) {
      // Correlated standard normals
      const z = classes.map(() => gaussian(rand))
      const correlated = L.map(row => row.reduce((sum, v, i) => sum + v * z[i], 0))

      for (let i = 0; i < classes.length; i++) {
        const { muM, sigmaM } = params[i]
        const r = Math.exp(muM + sigmaM * correlated[i]) - 1
        values[i] *= 1 + r
      }

      // Contributions land proportionally to the current mix, so the portfolio
      // keeps its shape rather than drifting into whichever class grew fastest.
      let total = values.reduce((a, b) => a + b, 0)
      if (m < withdrawalStartMonth && contribution > 0) {
        if (total > 0) {
          for (let i = 0; i < values.length; i++) values[i] += contribution * (values[i] / total)
        } else {
          for (let i = 0; i < values.length; i++) values[i] += contribution / values.length
        }
      }

      if (m >= withdrawalStartMonth && monthlyWithdrawal > 0) {
        total = values.reduce((a, b) => a + b, 0)
        if (total > 0) {
          for (let i = 0; i < values.length; i++) {
            values[i] = Math.max(0, values[i] - monthlyWithdrawal * (values[i] / total))
          }
        }
      }

      total = values.reduce((a, b) => a + b, 0)
      if (total <= 0) ruined = true

      if (config.targetCZK != null && reachedYear == null && total >= config.targetCZK) {
        reachedYear = m / 12
      }

      // Annual contribution raise
      if (m % 12 === 0) {
        contribution *= 1 + (config.contributionGrowthPct ?? 0)
        yearlyValues[m / 12].push(total)
      }
    }

    const final = values.reduce((a, b) => a + b, 0)
    finalValues.push(final)
    if (ruined) ruinCount++
    if (reachedYear != null) yearReachedTarget.push(reachedYear)
  }

  const percentiles: Percentiles[] = yearlyValues.map((vals, year) => {
    const sorted = [...vals].sort((a, b) => a - b)
    return {
      year,
      p5: percentile(sorted, 0.05),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.50),
      p75: percentile(sorted, 0.75),
      p95: percentile(sorted, 0.95),
    }
  })

  const sortedFinal = [...finalValues].sort((a, b) => a - b)
  const sortedReached = [...yearReachedTarget].sort((a, b) => a - b)

  return {
    percentiles,
    finalValues: {
      p5: percentile(sortedFinal, 0.05),
      p25: percentile(sortedFinal, 0.25),
      p50: percentile(sortedFinal, 0.50),
      p75: percentile(sortedFinal, 0.75),
      p95: percentile(sortedFinal, 0.95),
      mean: sortedFinal.reduce((a, b) => a + b, 0) / (sortedFinal.length || 1),
    },
    probabilityOfTarget: config.targetCZK == null
      ? null
      : sortedFinal.filter(v => v >= config.targetCZK!).length / sims,
    probabilityOfRuin: ruinCount / sims,
    medianYearReachingTarget: sortedReached.length > 0
      ? percentile(sortedReached, 0.5)
      : null,
    finalDistribution: sortedFinal,
    simulations: sims,
  }
}

/** Probability of clearing `target` by a given year. */
export function probabilityByYear(
  result: McResult,
  target: number,
  year: number
): number | null {
  const row = result.percentiles.find(p => p.year === year)
  if (!row) return null
  // Interpolate across the five reported percentiles — cheaper than keeping
  // every path, and accurate enough for a headline probability.
  const points: [number, number][] = [
    [row.p5, 0.05], [row.p25, 0.25], [row.p50, 0.5], [row.p75, 0.75], [row.p95, 0.95],
  ]
  if (target <= points[0][0]) return 0.95
  if (target >= points[points.length - 1][0]) return 0.05
  for (let i = 1; i < points.length; i++) {
    const [v0, q0] = points[i - 1]
    const [v1, q1] = points[i]
    if (target >= v0 && target <= v1) {
      const t = v1 === v0 ? 0 : (target - v0) / (v1 - v0)
      return 1 - (q0 + t * (q1 - q0))
    }
  }
  return null
}
