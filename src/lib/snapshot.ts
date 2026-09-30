/**
 * snapshot.ts — the daily net-worth record, derived from the position model.
 *
 * The browser and the cron route both write snapshots. They used to value the
 * portfolio with two separate hand-written loops; both now go through
 * buildPositions() and this function, so the two writers cannot disagree.
 */
import type { Position } from './portfolio'
import { totalsByClass, netWorthCZK } from './portfolio'
import { currencyExposure } from './exposure'

export interface SnapshotValues {
  total_value_czk: number
  stocks_czk: number
  bonds_czk: number
  cash_czk: number
  crypto_czk: number
  /** Property equity: asset rows plus (negative) mortgage rows. */
  realestate_czk: number
  fx_usd: number | null
  fx_eur: number | null
  fx_gbp: number | null
  exposure_usd_local: number
  exposure_eur_local: number
  exposure_czk_local: number
  exposure_gbp_local: number
  exposure_other_czk: number
}

export function snapshotValues(positions: Position[], fx: Record<string, number>): SnapshotValues {
  const byClass = totalsByClass(positions)
  const exposure = currencyExposure(positions, fx)
  return {
    total_value_czk: netWorthCZK(positions),
    stocks_czk: byClass.stock + byClass.etf,
    bonds_czk: byClass.bond,
    cash_czk: byClass.cash,
    crypto_czk: byClass.crypto,
    realestate_czk: byClass.realestate,
    fx_usd: fx.USD ?? null,
    fx_eur: fx.EUR ?? null,
    fx_gbp: fx.GBP ?? null,
    exposure_usd_local: exposure.usdLocal,
    exposure_eur_local: exposure.eurLocal,
    exposure_czk_local: exposure.czkLocal,
    exposure_gbp_local: exposure.gbpLocal,
    exposure_other_czk: exposure.otherCZK,
  }
}

/**
 * True for a position valued at cost because no market price exists today: a
 * stock or fund with no quote and no manual price, or a coin with no price.
 * Bonds and property are valued from entered figures by design.
 */
export function isValuedAtCost(p: Position): boolean {
  return !p.isLivePrice && !p.isManualPrice && !p.isLiability &&
    (p.assetClass === 'stock' || p.assetClass === 'etf' || p.assetClass === 'crypto' ||
     (p.assetClass === 'bond' && !!p.isFund))
}

/**
 * Positions whose market value is missing today — a stock with no quote or a
 * coin with no price, valued at cost instead. A snapshot written with any of
 * these records a step change that never happened (a 200k position saved at
 * its 120k cost), which then pollutes returns and FX attribution. Bonds and
 * property are valued from entered figures by design and do not count.
 */
export function snapshotBlockers(positions: Position[]): string[] {
  // A manual price is the user's statement of value and does not flip back
  // and forth with a provider's availability, so it does not block.
  return Array.from(new Set(positions.filter(isValuedAtCost).map(p => p.label)))
}
