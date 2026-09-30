/**
 * purchasefx.ts — fill in the FX rate a position was actually bought at.
 *
 * Positions entered before migration 010 have no `avg_fx_czk`, so their cost
 * is converted at today's rate and the currency part of P&L is invisible. The
 * ledger backfill wrote historical rates into `transactions` but never back
 * onto the position, so the "purchase FX unknown" alert could not be cleared
 * except by editing each position by hand.
 *
 * The rate of a position is the cost-weighted average of its parts:
 *
 *   avg_fx = Σ(costᵢ · fxᵢ) / Σ costᵢ
 *
 * which makes CZK cost = Σ costᵢ · fxᵢ exactly. The parts are the recorded lots
 * plus, when lots do not cover every share, a residual whose cost is the
 * position's total cost minus the lots' cost (not the residual shares at the
 * average price — that double-counts when lots were dearer or cheaper).
 */
import type { Holding, HoldingLot } from './supabase'
import { normalizeCurrencyCode } from './fx'

export type SkipReason = 'placeholder-date' | 'no-date' | 'no-rate' | 'inconsistent-lots'

export interface PurchaseFxPlan {
  holdings: { id: string; symbol: string; avgFx: number }[]
  lots: { id: string; fx: number }[]
  skipped: { symbol: string; reason: SkipReason; date?: string }[]
}

/**
 * 1 January is a market holiday everywhere; a purchase dated then is almost
 * always a placeholder typed when the real date was unknown. Its "historical"
 * rate would look precise while resting on a guess, so it is not used.
 */
export const isPlaceholderDate = (d: string | null | undefined): boolean =>
  !!d && /^\d{4}-01-01$/.test(d)

export const SKIP_LABEL: Record<SkipReason, string> = {
  'placeholder-date': 'purchase date is 1 January — looks like a placeholder; set the real date',
  'no-date': 'no purchase date',
  'no-rate': 'no ECB rate for the date',
  'inconsistent-lots': "lots cost more than the position's total — check the lots",
}

const countBySymbol = (holdings: Holding[]) => {
  const m = new Map<string, number>()
  for (const h of holdings) m.set(h.symbol, (m.get(h.symbol) ?? 0) + 1)
  return m
}

/** A holding's lots: by id, or by symbol for an unlinked lot when the symbol is unambiguous. */
const lotsOf = (h: Holding, lots: HoldingLot[], bySymbol: Map<string, number>) =>
  lots.filter(l => l.shares > 0 && (
    l.holding_id === h.id || (!l.holding_id && l.symbol === h.symbol && bySymbol.get(h.symbol) === 1)))

export function purchaseFxPlan(input: {
  holdings: Holding[]
  lots: HoldingLot[]
  /** CZK per unit of `ccy` on `date`, or null when unknown. */
  rateOn: (ccy: string, date: string) => number | null
}): PurchaseFxPlan {
  const plan: PurchaseFxPlan = { holdings: [], lots: [], skipped: [] }
  const bySymbol = countBySymbol(input.holdings)

  for (const h of input.holdings) {
    const ccy = normalizeCurrencyCode(h.currency)
    const totalCost = h.shares * h.avg_price
    // CZK needs no rate; a zero-cost position (RSUs, a gift) has no currency
    // effect; one that already has a rate is left alone.
    if (ccy === 'CZK' || !(h.shares > 0) || !(totalCost > 0) || h.avg_fx_czk != null) continue

    const lots = lotsOf(h, input.lots, bySymbol)

    const parts: { cost: number; date: string | null; lotId?: string; known?: number | null }[] =
      lots.map(l => ({ cost: l.shares * l.purchase_price, date: l.purchase_date ?? h.purchase_date, lotId: l.id, known: l.fx_rate_czk }))
    const lotShares = lots.reduce((s, l) => s + l.shares, 0)
    const lotCost = parts.reduce((s, p) => s + p.cost, 0)
    const residualShares = h.shares - lotShares
    if (residualShares > 1e-9) {
      const residualCost = totalCost - lotCost
      if (!(residualCost > 0)) { plan.skipped.push({ symbol: h.symbol, reason: 'inconsistent-lots' }); continue }
      parts.push({ cost: residualCost, date: h.purchase_date })
    }

    let num = 0, den = 0
    let skip: PurchaseFxPlan['skipped'][number] | null = null
    const lotRates: { id: string; fx: number }[] = []
    for (const p of parts) {
      if (!(p.cost > 0)) continue
      let rate = p.known != null && p.known > 0 ? p.known : null
      if (rate == null) {
        if (!p.date) { skip = { symbol: h.symbol, reason: 'no-date' }; break }
        if (isPlaceholderDate(p.date)) { skip = { symbol: h.symbol, reason: 'placeholder-date', date: p.date }; break }
        rate = input.rateOn(ccy, p.date)
        if (rate == null || !(rate > 0)) { skip = { symbol: h.symbol, reason: 'no-rate', date: p.date }; break }
        if (p.lotId) lotRates.push({ id: p.lotId, fx: rate })
      }
      num += p.cost * rate
      den += p.cost
    }
    if (skip) { plan.skipped.push(skip); continue }
    if (!(den > 0)) continue
    plan.holdings.push({ id: h.id, symbol: h.symbol, avgFx: num / den })
    plan.lots.push(...lotRates)
  }
  return plan
}

/** Every distinct date the plan may need a historical rate for. */
export function datesNeeded(holdings: Holding[], lots: HoldingLot[]): string[] {
  const d = new Set<string>()
  const bySymbol = countBySymbol(holdings)
  for (const h of holdings) {
    if (h.avg_fx_czk != null || normalizeCurrencyCode(h.currency) === 'CZK') continue
    if (h.purchase_date && !isPlaceholderDate(h.purchase_date)) d.add(h.purchase_date)
    for (const l of lotsOf(h, lots, bySymbol)) {
      if (l.fx_rate_czk == null && l.purchase_date && !isPlaceholderDate(l.purchase_date)) d.add(l.purchase_date)
    }
  }
  return Array.from(d).sort()
}
