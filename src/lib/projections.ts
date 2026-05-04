import type { DividendProjection, Holding } from './supabase'

/**
 * Compute the projected annual dividend total for a given projection row,
 * using current shares held rather than the stored projected_total.
 *
 * projected_total in the DB was set at a point in time and goes stale
 * whenever shares are added/removed. This always derives from
 * projected_div_per_share × current holdings.shares instead.
 *
 * Falls back to projected_total only when projected_div_per_share is missing.
 */
export function computeProjectedTotal(
  p: DividendProjection,
  holdings: Holding[]
): number {
  const holding = holdings.find(h => h.symbol === p.symbol)
  const shares  = holding?.shares ?? null
  if (p.projected_div_per_share != null && shares != null) {
    return p.projected_div_per_share * shares
  }
  return p.projected_total ?? 0
}

/**
 * Compute estimated annual dividend income in native currency for a holding,
 * preferring live market data, then projection, then zero.
 */
export function computeAnnualDiv(
  holding: Holding,
  projections: DividendProjection[],
  getAnnualDiv: (symbol: string) => number | null
): { amount: number; isLive: boolean } {
  const liveAnnual = getAnnualDiv(holding.symbol)
  if (liveAnnual != null) {
    return { amount: liveAnnual * holding.shares, isLive: true }
  }
  const proj = projections.find(p => p.symbol === holding.symbol)
  if (proj) {
    return { amount: computeProjectedTotal(proj, [holding]), isLive: false }
  }
  return { amount: 0, isLive: false }
}
