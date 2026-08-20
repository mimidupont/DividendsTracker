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
  /**
   * P(hitting zero before the horizon). Null when no withdrawals were
   * simulated — with nothing being drawn down, a structural zero is not a
   * finding and should not be displayed as one.
   */
  probabilityOfRuin: number | null
  /** True when the correlation matrix could not be decomposed and draws are independent. */
  correlationDegraded: boolean
  medianYearReachingTarget: number | null
  /** Every simulation's ending value, for the histogram. */
  finalDistribution: number[]
  /**
   * Every simulation's value at each year, sorted ascending — index 0 is the
   * start. Kept so probabilities can be read off the real distribution rather
   * than interpolated between five percentiles.
   */
  yearlyDistribution: number[][]
  simulations: number
}

export const DEFAULT_ASSUMPTIONS: MarketAssumptionInput[] = [
  { assetClass: 'stock',      expectedRealReturn: 0.055, volatility: 0.16 },
  { assetClass: 'etf',        expectedRealReturn: 0.055, volatility: 0.16 },
  { assetClass: 'crypto',     expectedRealReturn: 0.08,  volatility: 0.70 },
  { assetClass: 'bond',       expectedRealReturn: 0.015, volatility: 0.06 },
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
  // Mildly positive rather than the textbook negative: the 2022 selloff took
  // bonds and equities down together, and assuming the old hedge holds is
  // precisely how a drawdown ends up worse than the model promised.
  'stock|bond': 0.15,
  'etf|bond': 0.15,
  'etf|crypto': 0.4,
  'etf|realestate': 0.3,
  'etf|cash': 0.0,
  'bond|crypto': 0.1,
  'bond|cash': 0.1,
  'bond|realestate': 0.15,
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

/**
 * Box–Muller: uniform → standard normal.
 *
 * The transform produces two independent normals per pair of uniforms; the
 * spare is cached and returned next call rather than thrown away, halving the
 * RNG calls. The cache lives in the closure, so a seeded run stays reproducible
 * and two runs never share state.
 */
function gaussianSource(rand: () => number): () => number {
  let spare: number | null = null
  return () => {
    if (spare !== null) {
      const value = spare
      spare = null
      return value
    }
    let u = 0
    let v = 0
    while (u === 0) u = rand()
    while (v === 0) v = rand()
    const mag = Math.sqrt(-2 * Math.log(u))
    spare = mag * Math.sin(2 * Math.PI * v)
    return mag * Math.cos(2 * Math.PI * v)
  }
}

const identity = (n: number): number[][] =>
  Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => (r === c ? 1 : 0)))

/**
 * Cholesky decomposition, used to turn independent normals into correlated ones.
 *
 * Returns null when the matrix is not positive-definite. It used to return the
 * identity, which silently degraded every draw to uncorrelated with nothing to
 * distinguish that from a genuinely diagonal correlation matrix — the caller
 * decides what to do and whether to say so.
 */
export function cholesky(matrix: number[][]): number[][] | null {
  const n = matrix.length
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k]
      if (i === j) {
        const d = matrix[i][i] - sum
        if (d <= 0) return null
        L[i][j] = Math.sqrt(d)
      } else {
        if (L[j][j] === 0) return null
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
  // Whole years only: the yearly snapshot array is indexed by m/12, so a
  // fractional horizon (30.5 years → month 366) indexed past the end of it.
  const years = Math.max(1, Math.round(config.years || 1))
  const months = years * 12
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
  const decomposed = cholesky(corr)
  // Uncorrelated draws understate the joint left tail, so the result says when
  // it had to fall back rather than letting the fan look better than it is.
  const correlationDegraded = decomposed === null && classes.length > 1
  const L = decomposed ?? identity(classes.length)
  const gaussian = gaussianSource(rand)

  // Yearly snapshots of every simulation
  const yearlyValues: number[][] = Array.from({ length: years + 1 }, () => [])
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
      const z = classes.map(() => gaussian())
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

  const yearlyDistribution = yearlyValues.map(vals => [...vals].sort((a, b) => a - b))
  const percentiles: Percentiles[] = yearlyDistribution.map((sorted, year) => {
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
    probabilityOfRuin: monthlyWithdrawal > 0 ? ruinCount / sims : null,
    correlationDegraded,
    medianYearReachingTarget: sortedReached.length > 0
      ? percentile(sortedReached, 0.5)
      : null,
    finalDistribution: sortedFinal,
    yearlyDistribution,
    simulations: sims,
  }
}

/**
 * Probability of clearing `target` by a given year.
 *
 * Read straight off the stored per-year distribution. The previous version
 * interpolated between the five reported percentiles, which pinned the answer
 * to [5%, 95%] — reporting 95% for a target cleared in every single run.
 */
export function probabilityByYear(
  result: McResult,
  target: number,
  year: number
): number | null {
  const sorted = result.yearlyDistribution?.[year]
  if (!sorted || sorted.length === 0) return null
  let cleared = 0
  for (const v of sorted) if (v >= target) cleared++
  return cleared / sorted.length
}
