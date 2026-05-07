import type { DividendProjection, Holding } from './supabase'

/**
 * Compute projected annual dividend total using current shares (not stale DB value).
 * Falls back to projected_total only when projected_div_per_share is missing.
 */
export function computeProjectedTotal(p: DividendProjection, holdings: Holding[]): number {
  const shares = holdings.find(h => h.symbol === p.symbol)?.shares ?? null
  if (p.projected_div_per_share != null && shares != null) {
    return p.projected_div_per_share * shares
  }
  return p.projected_total ?? 0
}
