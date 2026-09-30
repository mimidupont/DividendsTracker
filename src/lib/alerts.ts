/**
 * alerts.ts — the "needs attention" list on the dashboard.
 *
 * Signals that used to live only on their own pages (a term deposit about to
 * mature, a position valued at cost, drift outside its band) are gathered here
 * so the overview can say what to look at, with a link to where to fix it.
 */
import type { Position } from './portfolio'
import type { AllocationTarget, BankAccount, BondHolding, AssetMetadata, Holding } from './supabase'
import { computeDrift } from './rebalance'
import { daysBetween, fmtISODate } from './date'

export interface Alert {
  id: string
  level: 'warn' | 'info'
  text: string
  href: string
}

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

  const atCost = input.positions.filter(p => !p.isLivePrice && !p.isLiability &&
    (p.assetClass === 'stock' || p.assetClass === 'etf' || p.assetClass === 'crypto' || (p.assetClass === 'bond' && p.isFund)))
  if (atCost.length > 0) {
    out.push({
      id: 'at-cost', level: 'warn',
      text: `${atCost.length} position${atCost.length > 1 ? 's' : ''} valued at cost — no live price (${atCost.slice(0, 4).map(p => p.label).join(', ')}${atCost.length > 4 ? '…' : ''})`,
      href: atCost[0].assetClass === 'crypto' ? '/crypto' : '/holdings',
    })
  }
  if (input.snapshotBlockedBy.length > 0) {
    out.push({
      id: 'snapshot', level: 'info',
      text: "Today's history point is not saved until every position has a live price",
      href: '/holdings',
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

  const classified = new Set(input.metadata.filter(m => m.sector || m.asset_type).map(m => m.symbol.toUpperCase()))
  const unclassified = input.holdings.filter(h => !classified.has(h.symbol.toUpperCase()))
  if (unclassified.length > 0) {
    out.push({
      id: 'unclassified', level: 'info',
      text: `${unclassified.length} holding${unclassified.length > 1 ? 's have' : ' has'} no sector/type — allocation and risk treat ${unclassified.length > 1 ? 'them' : 'it'} as "Unclassified"`,
      href: '/risk',
    })
  }

  if (input.costFxUnknown.length > 0) {
    out.push({
      id: 'fx-unknown', level: 'info',
      text: `Purchase FX rate unknown for ${input.costFxUnknown.length} position${input.costFxUnknown.length > 1 ? 's' : ''} — their P&L ignores currency moves`,
      href: '/holdings',
    })
  }

  if (input.targets.some(t => t.scope === 'asset_class')) {
    const breaches = computeDrift(input.positions, input.targets, 'asset_class').filter(r => r.status === 'breach')
    if (breaches.length > 0) {
      out.push({
        id: 'drift', level: 'warn',
        text: `Allocation outside its band: ${breaches.map(r => `${r.bucket} ${r.driftPct > 0 ? '+' : '−'}${Math.abs(r.driftPct * 100).toFixed(1)} pp`).join(', ')}`,
        href: '/rebalance',
      })
    }
  }

  return out
}
