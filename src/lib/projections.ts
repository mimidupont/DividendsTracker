import type { DividendProjection, Holding } from './supabase'

/**
 * Compute projected annual dividend total using current shares (not the stale
 * value stored in the DB, which was computed against whatever share count
 * existed when the projection was entered).
 * Falls back to projected_total only when projected_div_per_share is missing.
 */
export function computeProjectedTotal(p: DividendProjection, holdings: Holding[]): number {
  const shares = holdings.find(h => h.symbol === p.symbol)?.shares ?? null
  if (p.projected_div_per_share != null && shares != null) {
    return p.projected_div_per_share * shares
  }
  return p.projected_total ?? 0
}

/**
 * Pick the projection row that best represents *forward* income for a symbol.
 *
 * Projections are stored per year. The nearest year that has not already passed
 * is the relevant one; if every row is historical, the most recent is used so
 * the estimate degrades gracefully instead of disappearing.
 */
export function findProjection(
  projections: DividendProjection[],
  symbol: string,
  year: number = new Date().getFullYear()
): DividendProjection | undefined {
  const rows = projections.filter(p => p.symbol === symbol)
  if (rows.length === 0) return undefined

  const upcoming = rows
    .filter(p => p.year >= year)
    .sort((a, b) => a.year - b.year)
  if (upcoming.length > 0) return upcoming[0]

  return [...rows].sort((a, b) => b.year - a.year)[0]
}
