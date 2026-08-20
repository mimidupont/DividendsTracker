/**
 * runway.ts — how long you could live off what you can actually reach.
 *
 * The question is not "what am I worth" but "what could I turn into rent money
 * next month", so non-cash assets are discounted and property is excluded.
 */
import type { Position, LiquidityTier } from './portfolio'
import { assetPositions, LIQUIDITY_TIERS } from './portfolio'
import { todayISO } from './date'

/**
 * Haircuts applied when treating an asset as emergency money.
 *
 * Stocks count at full market value but may have to be sold at a loss — the UI
 * says so rather than pretending the timing is free. Crypto is discounted for
 * volatility. Property is excluded entirely: a flat is not an emergency fund.
 *
 * Bonds are discounted only lightly: selling before maturity means taking
 * whatever price the market offers, but a government bond is a far steadier
 * thing to liquidate in a hurry than an equity line.
 */
export const EMERGENCY_HAIRCUTS: Record<string, number> = {
  cash: 1.0,
  stock: 1.0,
  etf: 1.0,
  bond: 0.95,
  crypto: 0.7,
  realestate: 0,
}

export type RunwayStatus = 'critical' | 'thin' | 'ok' | 'strong'

export interface Runway {
  tier: LiquidityTier
  availableCZK: number
  cumulativeCZK: number
  months: number
  cumulativeMonths: number
}

/**
 * Money reachable in each liquidity tier, and what that buys in months.
 * Returns zero-filled tiers rather than omitting them, so the UI ladder always
 * has the same five segments.
 */
export function computeRunway(positions: Position[], monthlyExpenses: number): Runway[] {
  const byTier: Record<LiquidityTier, number> = {
    instant: 0, week: 0, month: 0, year: 0, illiquid: 0,
  }

  for (const p of assetPositions(positions)) {
    const haircut = EMERGENCY_HAIRCUTS[p.assetClass] ?? 0
    if (haircut <= 0) continue
    byTier[p.liquidityTier] += p.valueCZK * haircut
  }

  let cumulative = 0
  return LIQUIDITY_TIERS.map(tier => {
    const availableCZK = byTier[tier]
    cumulative += availableCZK
    return {
      tier,
      availableCZK,
      cumulativeCZK: cumulative,
      months: monthlyExpenses > 0 ? availableCZK / monthlyExpenses : 0,
      cumulativeMonths: monthlyExpenses > 0 ? cumulative / monthlyExpenses : 0,
    }
  })
}

export const runwayStatus = (months: number): RunwayStatus =>
  months < 1 ? 'critical' : months < 3 ? 'thin' : months < 6 ? 'ok' : 'strong'

export const RUNWAY_COLORS: Record<RunwayStatus, string> = {
  critical: 'var(--red)',
  thin: 'var(--amber)',
  ok: 'var(--blue)',
  strong: 'var(--green)',
}

export const RUNWAY_LABELS: Record<RunwayStatus, string> = {
  critical: 'Critical',
  thin: 'Thin',
  ok: 'Adequate',
  strong: 'Strong',
}

/** Target months of expenses held in reachable form. */
export const RUNWAY_TARGET_MONTHS = 6

export interface RunwaySummary {
  /** Months covered by instant + week money, the realistic emergency horizon. */
  emergencyMonths: number | null
  emergencyCZK: number
  status: RunwayStatus | null
  /** CZK still needed to reach the 6-month target, or 0 when already there. */
  gapCZK: number
  ladder: Runway[]
}

export function runwaySummary(
  positions: Position[],
  monthlyExpenses: number | null
): RunwaySummary {
  const expenses = monthlyExpenses ?? 0
  const ladder = computeRunway(positions, expenses)
  const emergencyCZK = ladder
    .filter(r => r.tier === 'instant' || r.tier === 'week')
    .reduce((s, r) => s + r.availableCZK, 0)

  if (expenses <= 0) {
    // Without an expense figure "months of runway" has no meaning — say so
    // rather than rendering Infinity.
    return { emergencyMonths: null, emergencyCZK, status: null, gapCZK: 0, ladder }
  }

  const months = emergencyCZK / expenses
  return {
    emergencyMonths: months,
    emergencyCZK,
    status: runwayStatus(months),
    gapCZK: Math.max(0, RUNWAY_TARGET_MONTHS * expenses - emergencyCZK),
    ladder,
  }
}

/**
 * Term deposits whose maturity locks money that would otherwise read as instant.
 * Surfaced as a note so the runway figure is not quietly optimistic.
 */
export function lockedCashWarning(
  accounts: { name: string; balance: number; currency: string; maturity_date: string | null; account_type: string }[]
): { name: string; maturityDate: string }[] {
  // Local calendar date, not UTC: east of Greenwich, toISOString() reports
  // yesterday for the first hours of the day and would un-flag a deposit
  // maturing today.
  const today = todayISO()
  return accounts
    .filter(a =>
      a.account_type === 'fixed_deposit' &&
      a.maturity_date != null &&
      a.maturity_date > today
    )
    .map(a => ({ name: a.name, maturityDate: a.maturity_date! }))
}
