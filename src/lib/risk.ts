/**
 * risk.ts — concentration, exposure and liquidity metrics.
 *
 * All weights are computed over *assets only*: including a mortgage as a
 * negative weight would make the shares sum to something other than 1 and
 * produce nonsense concentration figures.
 */
import type { Position, LiquidityTier, AssetClass } from './portfolio'
import { assetPositions, LIQUIDITY_TIERS } from './portfolio'

export type RiskBand = 'green' | 'amber' | 'red'

export interface Bucket {
  key: string
  valueCZK: number
  pct: number
  count: number
}

export interface ConcentrationRow {
  position: Position
  pct: number
  cumulativePct: number
  band: RiskBand
}

export interface TopNResult {
  pct: number
  rows: Position[]
}

const total = (positions: Position[]) =>
  positions.reduce((s, p) => s + p.valueCZK, 0)

/** Share of the portfolio held in its `n` largest positions. */
export function topNConcentration(positions: Position[], n = 5): TopNResult {
  const assets = assetPositions(positions)
  const sum = total(assets)
  const rows = [...assets].sort((a, b) => b.valueCZK - a.valueCZK).slice(0, n)
  return {
    pct: sum > 0 ? rows.reduce((s, p) => s + p.valueCZK, 0) / sum : 0,
    rows,
  }
}

/** Herfindahl index: Σ wᵢ². Multiply by 10 000 for the conventional HHI points. */
export function herfindahl(positions: Position[]): number {
  const assets = assetPositions(positions)
  const sum = total(assets)
  if (sum <= 0) return 0
  return assets.reduce((s, p) => {
    const w = p.valueCZK / sum
    return s + w * w
  }, 0)
}

/**
 * Effective number of positions: 1 / Σ wᵢ².
 * Ten holdings where one is 90% of the money is not ten bets — it is roughly one.
 */
export function effectiveN(positions: Position[]): number {
  const h = herfindahl(positions)
  return h > 0 ? 1 / h : 0
}

/** Group assets by an attribute and return sorted, percentage-weighted buckets. */
export function exposureBy(
  positions: Position[],
  key: 'sector' | 'region' | 'currency' | 'assetClass' | 'liquidityTier'
): Bucket[] {
  const assets = assetPositions(positions)
  const sum = total(assets)
  const map: Record<string, { valueCZK: number; count: number }> = {}

  for (const p of assets) {
    const raw =
      key === 'assetClass' ? p.assetClass
      : key === 'currency' ? p.currency
      : key === 'liquidityTier' ? p.liquidityTier
      : key === 'sector' ? p.sector
      : p.region
    const bucket = raw ?? 'Unclassified'
    if (!map[bucket]) map[bucket] = { valueCZK: 0, count: 0 }
    map[bucket].valueCZK += p.valueCZK
    map[bucket].count += 1
  }

  return Object.entries(map)
    .map(([k, v]) => ({
      key: k,
      valueCZK: v.valueCZK,
      pct: sum > 0 ? v.valueCZK / sum : 0,
      count: v.count,
    }))
    .sort((a, b) => b.valueCZK - a.valueCZK)
}

/**
 * Share of assets denominated in something other than the base currency.
 *
 * For a CZK investor this is normally a deliberate diversification choice, not
 * a defect — the UI should report it, not scold.
 */
export function unhedgedFxShare(positions: Position[], base = 'CZK'): number {
  const assets = assetPositions(positions)
  const sum = total(assets)
  if (sum <= 0) return 0
  const foreign = assets
    .filter(p => p.currency.toUpperCase() !== base.toUpperCase())
    .reduce((s, p) => s + p.valueCZK, 0)
  return foreign / sum
}

/** How much money sits in each liquidity tier. */
export function liquidityLadder(positions: Position[]): Record<LiquidityTier, number> {
  const ladder: Record<LiquidityTier, number> = {
    instant: 0, week: 0, month: 0, year: 0, illiquid: 0,
  }
  for (const p of assetPositions(positions)) ladder[p.liquidityTier] += p.valueCZK
  return ladder
}

/** Cash raisable within a tier, counting every faster tier too. */
export function raisableWithin(positions: Position[], tier: LiquidityTier): number {
  const ladder = liquidityLadder(positions)
  const cutoff = LIQUIDITY_TIERS.indexOf(tier)
  return LIQUIDITY_TIERS.slice(0, cutoff + 1).reduce((s, t) => s + ladder[t], 0)
}

/** Every position by weight, with a running cumulative share. */
export function concentrationTable(positions: Position[]): ConcentrationRow[] {
  const assets = assetPositions(positions)
  const sum = total(assets)
  let cumulative = 0
  return [...assets]
    .sort((a, b) => b.valueCZK - a.valueCZK)
    .map(p => {
      const pct = sum > 0 ? p.valueCZK / sum : 0
      cumulative += pct
      return { position: p, pct, cumulativePct: cumulative, band: singlePositionBand(pct) }
    })
}

// ─── Interpretation bands ─────────────────────────────────────────────────────
// Thresholds are conventions, not laws. They exist so the UI can colour a
// number consistently rather than each page inventing its own cutoffs.

export const topFiveBand = (pct: number): RiskBand =>
  pct < 0.35 ? 'green' : pct <= 0.55 ? 'amber' : 'red'

export const singlePositionBand = (pct: number): RiskBand =>
  pct < 0.10 ? 'green' : pct <= 0.20 ? 'amber' : 'red'

export const effectiveNBand = (n: number): RiskBand =>
  n > 15 ? 'green' : n >= 8 ? 'amber' : 'red'

export const unhedgedFxBand = (pct: number): RiskBand =>
  pct < 0.40 ? 'green' : pct <= 0.70 ? 'amber' : 'red'

export const liquidityBand = (months: number): RiskBand =>
  months > 6 ? 'green' : months >= 3 ? 'amber' : 'red'

/** Map a risk band onto the Badge component's variants. */
export const bandVariant = (band: RiskBand): 'green' | 'amber' | 'red' => band

export interface RiskSummary {
  topFivePct: number
  effectiveN: number
  hhi: number
  unhedgedPct: number
  instantCZK: number
  instantMonths: number | null
  positionCount: number
}

export function riskSummary(
  positions: Position[],
  monthlyExpensesCZK: number | null
): RiskSummary {
  const instant = liquidityLadder(positions).instant
  return {
    topFivePct: topNConcentration(positions, 5).pct,
    effectiveN: effectiveN(positions),
    hhi: herfindahl(positions),
    unhedgedPct: unhedgedFxShare(positions),
    instantCZK: instant,
    // Null rather than Infinity when expenses are unknown — "not enough data".
    instantMonths:
      monthlyExpensesCZK && monthlyExpensesCZK > 0 ? instant / monthlyExpensesCZK : null,
    positionCount: assetPositions(positions).length,
  }
}

/** Default sector map used to seed asset_metadata for a fresh profile. */
export const SEED_SECTORS: Record<string, { sector: string; region: string }> = {
  SPY5:  { sector: 'ETF', region: 'US' },
  SPYW:  { sector: 'ETF', region: 'EU' },
  SPY:   { sector: 'ETF', region: 'US' },
  JPM:   { sector: 'Financials', region: 'US' },
  ERBAG: { sector: 'Financials', region: 'EU' },
  MONET: { sector: 'Financials', region: 'CZ' },
  CSG1:  { sector: 'Financials', region: 'EU' },
  KPLT:  { sector: 'Financials', region: 'US' },
  KO:    { sector: 'Consumer Staples', region: 'US' },
  PEP:   { sector: 'Consumer Staples', region: 'US' },
  PG:    { sector: 'Consumer Staples', region: 'US' },
  MCD:   { sector: 'Consumer Discretionary', region: 'US' },
  BYND:  { sector: 'Consumer Discretionary', region: 'US' },
  T:     { sector: 'Telecom', region: 'US' },
  VZ:    { sector: 'Telecom', region: 'US' },
  AMZN:  { sector: 'Technology', region: 'US' },
  AAPL:  { sector: 'Technology', region: 'US' },
  SKLZ:  { sector: 'Technology', region: 'US' },
  O:     { sector: 'Real Estate', region: 'US' },
  OPEN:  { sector: 'Real Estate', region: 'US' },
  RIO:   { sector: 'Materials', region: 'Global' },
  ICL:   { sector: 'Materials', region: 'EM' },
  PSNY:  { sector: 'Industrials', region: 'EU' },
}

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  stock: 'Stocks', etf: 'ETFs', bond: 'Bonds', cash: 'Cash', crypto: 'Crypto', realestate: 'Real estate',
}
