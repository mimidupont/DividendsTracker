/**
 * rebalance.ts — drift against targets, and how to fix it with new money.
 *
 * The contribution allocator is the centrepiece: rebalancing by *buying* the
 * underweight buckets avoids realizing gains, which for a Czech investor can
 * also mean losing the 3-year time-test exemption.
 */
import type { Position } from './portfolio'
import { assetPositions } from './portfolio'
import type { AllocationTarget, TargetScope } from './supabase'

export type DriftStatus = 'ok' | 'watch' | 'breach'

export interface DriftRow {
  bucket: string
  currentCZK: number
  currentPct: number
  targetPct: number
  /** Current minus target, in percentage points (0.03 = 3pp overweight). */
  driftPct: number
  status: DriftStatus
  /** Positive = buy this much CZK, negative = sell this much. */
  deltaCZK: number
  bandPct: number
}

export interface Trade {
  bucket: string
  action: 'buy' | 'sell'
  amountCZK: number
}

export interface ContributionSplit {
  bucket: string
  amountCZK: number
  /** Resulting weight once the contribution lands. */
  newPct: number
}

/** Which attribute of a position a target scope refers to. */
function bucketOf(p: Position, scope: TargetScope): string {
  switch (scope) {
    case 'asset_class': return p.assetClass
    case 'sector':      return p.sector ?? 'Unclassified'
    case 'region':      return p.region ?? 'Unclassified'
    case 'symbol':      return p.label
  }
}

/**
 * Current vs target weights.
 *
 * Buckets you hold but have no target for are included with target 0 — that is
 * information, not noise: it is money sitting outside the plan.
 */
export function computeDrift(
  positions: Position[],
  targets: AllocationTarget[],
  scope: TargetScope
): DriftRow[] {
  const assets = assetPositions(positions)
  const total = assets.reduce((s, p) => s + p.valueCZK, 0)

  const currentByBucket: Record<string, number> = {}
  for (const p of assets) {
    const b = bucketOf(p, scope)
    currentByBucket[b] = (currentByBucket[b] ?? 0) + p.valueCZK
  }

  const scoped = targets.filter(t => t.scope === scope)
  const buckets = Array.from(new Set([
    ...Object.keys(currentByBucket),
    ...scoped.map(t => t.bucket),
  ]))

  return buckets.map((bucket): DriftRow => {
    const target = scoped.find(t => t.bucket === bucket)
    const targetPct = target?.target_pct ?? 0
    const bandPct = target?.band_pct ?? 0.05
    const currentCZK = currentByBucket[bucket] ?? 0
    const currentPct = total > 0 ? currentCZK / total : 0
    const driftPct = currentPct - targetPct
    const abs = Math.abs(driftPct)

    return {
      bucket,
      currentCZK,
      currentPct,
      targetPct,
      driftPct,
      bandPct,
      status: abs <= bandPct ? 'ok' : abs <= bandPct * 2 ? 'watch' : 'breach',
      // What it would take to sit exactly on target at today's total
      deltaCZK: targetPct * total - currentCZK,
    }
  }).sort((a, b) => b.currentCZK - a.currentCZK)
}

/**
 * No-sell rebalancing: spread a contribution across the most underweight buckets.
 *
 * Allocates pro-rata to each bucket's shortfall against its post-contribution
 * ideal value, drops tickets too small to be worth a trade fee, and
 * redistributes what it dropped. Never suggests a sell.
 */
export function allocateContribution(
  rows: DriftRow[],
  amountCZK: number,
  opts: { minTicketCZK?: number } = {}
): ContributionSplit[] {
  const minTicket = opts.minTicketCZK ?? 2000
  if (!isFinite(amountCZK) || amountCZK <= 0) return []

  const currentTotal = rows.reduce((s, r) => s + r.currentCZK, 0)
  const newTotal = currentTotal + amountCZK

  // Shortfall against the ideal post-contribution value
  const shortfalls = rows.map(r => ({
    bucket: r.bucket,
    shortfall: Math.max(0, r.targetPct * newTotal - r.currentCZK),
    currentCZK: r.currentCZK,
    targetPct: r.targetPct,
  }))

  let pool = shortfalls.filter(s => s.shortfall > 0)
  let totalShortfall = pool.reduce((s, r) => s + r.shortfall, 0)

  // Nothing is underweight (or no targets set): fall back to target weights so
  // the money still lands somewhere sensible rather than nowhere.
  if (totalShortfall <= 0) {
    const withTargets = rows.filter(r => r.targetPct > 0)
    const targetSum = withTargets.reduce((s, r) => s + r.targetPct, 0)
    if (targetSum <= 0) return []
    return withTargets
      .map(r => {
        const amt = (r.targetPct / targetSum) * amountCZK
        return {
          bucket: r.bucket,
          amountCZK: amt,
          newPct: newTotal > 0 ? (r.currentCZK + amt) / newTotal : 0,
        }
      })
      .filter(s => s.amountCZK > 0)
      .sort((a, b) => b.amountCZK - a.amountCZK)
  }

  // Allocate pro-rata, then iteratively drop sub-minimum tickets and redistribute
  // so the split still sums exactly to the amount the user entered.
  let allocations: Record<string, number> = {}
  for (let pass = 0; pass < 10; pass++) {
    allocations = {}
    for (const s of pool) allocations[s.bucket] = (s.shortfall / totalShortfall) * amountCZK

    const tooSmall = pool.filter(s => allocations[s.bucket] < minTicket)
    // Keep everything if dropping would leave nothing to allocate to
    if (tooSmall.length === 0 || tooSmall.length === pool.length) break

    pool = pool.filter(s => allocations[s.bucket] >= minTicket)
    totalShortfall = pool.reduce((s, r) => s + r.shortfall, 0)
    if (totalShortfall <= 0) break
  }

  const out = pool.map(s => {
    const amt = allocations[s.bucket] ?? 0
    return {
      bucket: s.bucket,
      amountCZK: amt,
      newPct: newTotal > 0 ? (s.currentCZK + amt) / newTotal : 0,
    }
  }).filter(s => s.amountCZK > 0)

  // Push any rounding remainder onto the largest ticket so the split reconciles
  // exactly with what the user said they had to invest.
  const allocated = out.reduce((s, r) => s + r.amountCZK, 0)
  const remainder = amountCZK - allocated
  if (out.length > 0 && Math.abs(remainder) > 1e-6) {
    const biggest = out.reduce((a, b) => (a.amountCZK >= b.amountCZK ? a : b))
    biggest.amountCZK += remainder
    biggest.newPct = newTotal > 0
      ? (shortfalls.find(s => s.bucket === biggest.bucket)!.currentCZK + biggest.amountCZK) / newTotal
      : 0
  }

  return out.sort((a, b) => b.amountCZK - a.amountCZK)
}

/**
 * Full rebalance including sells. Shown separately from the contribution
 * allocator because selling can realize taxable gains.
 */
export function fullRebalanceTrades(rows: DriftRow[], minTicketCZK = 2000): Trade[] {
  return rows
    .filter(r => Math.abs(r.deltaCZK) >= minTicketCZK)
    .map(r => ({
      bucket: r.bucket,
      action: r.deltaCZK > 0 ? ('buy' as const) : ('sell' as const),
      amountCZK: Math.abs(r.deltaCZK),
    }))
    .sort((a, b) => b.amountCZK - a.amountCZK)
}

/** Targets within a scope should sum to 1. Warn, don't block. */
export function targetsSum(targets: AllocationTarget[], scope: TargetScope): number {
  return targets.filter(t => t.scope === scope).reduce((s, t) => s + t.target_pct, 0)
}
