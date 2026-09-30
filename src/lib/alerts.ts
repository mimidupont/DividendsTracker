/**
 * alerts.ts — the "needs attention" list on the dashboard.
 *
 * Signals that used to live only on their own pages (a term deposit about to
 * mature, a position valued at cost, drift outside its band) are gathered here
 * so the overview can say what to look at, with a link to where to fix it.
 */
import type { Position } from './portfolio'
import type { AllocationTarget, BankAccount, BondHolding, AssetMetadata, Holding } from './supabase'
import { computeDrift, targetsStatus } from './rebalance'
import { isValuedAtCost } from './snapshot'
import { daysBetween, fmtISODate } from './date'

export interface Alert {
  id: string
  level: 'warn' | 'info'
  text: string
  href: string
  /** Short verb for the link, e.g. "Fix tickers". */
  action?: string
}

/** A manual price older than this is flagged as stale. */
export const MANUAL_PRICE_STALE_DAYS = 30

const list = (xs: string[], max = 4) =>
  xs.slice(0, max).join(', ') + (xs.length > max ? ` +${xs.length - max} more` : '')
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function attentionItems(input: {
  positions: Position[]
  accounts: BankAccount[]
  bonds: BondHolding[]
  holdings: Holding[]
  metadata: AssetMetadata[]
  targets: AllocationTarget[]
  costFxUnknown: string[]
  snapshotBlockedBy: string[]
  today: string
}): Alert[] {
  const out: Alert[] = []
  const { today } = input

  // One alert for "no price": being valued at cost and blocking today's
  // history point are the same condition, so they used to appear as a pair.
  const atCost = Array.from(new Set(input.positions.filter(isValuedAtCost).map(p => p.label)))
  if (atCost.length > 0) {
    const crypto = input.positions.some(p => p.assetClass === 'crypto' && isValuedAtCost(p))
    const blocked = input.snapshotBlockedBy.length > 0
    out.push({
      id: 'at-cost', level: 'warn',
      text: `${list(atCost)} ${plural(atCost.length, 'has', 'have')} no live price — valued at cost` +
        (blocked ? ", so today's history point isn't saved" : '') +
        '. Check the exchange, or enter a manual price for a delisted ticker',
      href: crypto && atCost.every(l => input.positions.some(p => p.label === l && p.assetClass === 'crypto'))
        ? '/crypto' : '/holdings?filter=at-cost',
      action: 'Fix prices',
    })
  }

  const staleManual = input.holdings.filter(h =>
    h.manual_price != null && h.shares > 0 &&
    input.positions.some(p => p.id === h.id && p.isManualPrice) &&
    (!h.manual_price_date || daysBetween(h.manual_price_date, today) > MANUAL_PRICE_STALE_DAYS))
  if (staleManual.length > 0) {
    out.push({
      id: 'manual-stale', level: 'info',
      text: `Manual price for ${list(staleManual.map(h => h.symbol))} is more than ${MANUAL_PRICE_STALE_DAYS} days old`,
      href: '/holdings?filter=at-cost', action: 'Update',
    })
  }

  for (const a of input.accounts) {
    if (a.account_type !== 'fixed_deposit' || !a.maturity_date) continue
    const d = daysBetween(today, a.maturity_date)
    if (d >= 0 && d <= 60) {
      out.push({ id: `td-${a.id}`, level: 'info', text: `Term deposit ${a.name} matures ${fmtISODate(a.maturity_date)} (${d} days)`, href: '/cash' })
    }
  }
  for (const b of input.bonds) {
    const d = daysBetween(today, b.maturity_date)
    if (b.quantity > 0 && d >= 0 && d <= 90) {
      out.push({ id: `bond-${b.id}`, level: 'info', text: `Bond ${b.name} matures ${fmtISODate(b.maturity_date)} (${d} days)`, href: '/bonds' })
    }
    if (b.quantity > 0 && b.clean_price_pct != null && b.price_date && daysBetween(b.price_date, today) > 45 && !b.redeemable_early) {
      out.push({ id: `bondpx-${b.id}`, level: 'info', text: `Bond ${b.name} price is ${daysBetween(b.price_date, today)} days old`, href: '/bonds' })
    }
  }

  // Counted per ticker, not per row: two rows of the same ticker (an RSU grant
  // and a later purchase) are one thing to classify.
  const classified = new Set(input.metadata.filter(m => m.sector || m.asset_type).map(m => m.symbol.toUpperCase()))
  const unclassified = Array.from(new Set(input.holdings
    .filter(h => h.shares > 0 && !classified.has(h.symbol.toUpperCase()))
    .map(h => h.symbol.toUpperCase())))
  if (unclassified.length > 0) {
    const n = unclassified.length
    out.push({
      id: 'unclassified', level: 'info',
      text: `${n} ${plural(n, 'holding has', 'holdings have')} no sector or type, so allocation and risk show ${plural(n, 'it', 'them')} as Unclassified`,
      href: '/risk#classification', action: 'Classify',
    })
  }

  if (input.costFxUnknown.length > 0) {
    const n = input.costFxUnknown.length
    out.push({
      id: 'fx-unknown', level: 'info',
      text: `${n} ${plural(n, 'position has', 'positions have')} no purchase FX rate, so ${plural(n, 'its', 'their')} P&L leaves out currency moves`,
      href: '/holdings?filter=fx-unknown', action: 'Fill FX',
    })
  }

  // Drift is only meaningful against a plan that adds up. All-zero rows (a
  // targets form opened and saved empty) are no plan at all: measured against
  // 0 %, every holding is a "breach".
  const plan = targetsStatus(input.targets, 'asset_class')
  if (plan.status === 'incomplete') {
    out.push({
      id: 'targets-sum', level: 'info',
      text: `Allocation targets add up to ${(plan.sum * 100).toFixed(1)} %, not 100 % — drift can't be measured until they do`,
      href: '/rebalance', action: 'Finish targets',
    })
  } else if (plan.status === 'ok') {
    const breaches = computeDrift(input.positions, input.targets, 'asset_class').filter(r => r.status === 'breach')
    if (breaches.length > 0) {
      out.push({
        id: 'drift', level: 'warn',
        text: `Allocation outside its band: ${breaches.map(r => `${r.bucket} ${r.driftPct > 0 ? '+' : '−'}${Math.abs(r.driftPct * 100).toFixed(1)} pp`).join(', ')}`,
        href: '/rebalance', action: 'Rebalance',
      })
    }
  }

  // Warnings first: they are the ones that make a number wrong today.
  return [...out.filter(a => a.level === 'warn'), ...out.filter(a => a.level !== 'warn')]
}
