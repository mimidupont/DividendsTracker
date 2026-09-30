/**
 * transactions.ts — cost basis, realized P&L and cash-flow separation.
 *
 * The point of the ledger: without it, a 200k rise in net worth is
 * indistinguishable between "the market went up" and "I deposited 200k".
 */
import type { Transaction, TransactionType } from './supabase'

export interface Lot {
  date: string
  shares: number
  /** Per-share cost in the transaction's native currency, fees included. */
  price: number
  currency: string
  /** CZK per unit of `currency` on the day the lot was bought. */
  fxRateCZK: number
}

export interface RealizedLot {
  symbol: string
  sellDate: string
  shares: number
  proceedsLocal: number
  costLocal: number
  gainLocal: number
  /**
   * Gain in CZK, with proceeds converted at the sell-date rate and cost at the
   * buy-date rate. That difference *is* the currency part of the gain, and it is
   * what the Czech return asks for — converting both legs at the sell rate would
   * silently erase it.
   */
  gainCZK: number
  /** The CZK gain the currency move alone contributed. */
  fxGainCZK: number
  /** Proceeds in CZK at the sell-date rate (what the Czech 100 000 CZK test counts). */
  proceedsCZK: number
  currency: string
  /** Days held — matters for the Czech 3-year time test. */
  holdingDays: number
  /** True when the lot was held more than 3 calendar years (Czech time-test exemption). */
  passesTimeTest: boolean
  /**
   * True when no buy lot could be matched to these shares, so `costLocal` is 0
   * and the gain is really just proceeds. Happens when the ledger starts after
   * the original purchase; the UI flags it rather than quietly understating.
   */
  basisIncomplete?: boolean
}

export interface CostBasis {
  shares: number
  avgPrice: number
  lots: Lot[]
  currency: string
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/**
 * The Czech time test is a *calendar* span, not a day count.
 *
 * 365 × 3 = 1095 days, but any three-year span containing a leap day is 1096,
 * so a day count reports a lot as exempt when it is a day short. Being wrong in
 * the permissive direction on a tax figure is the bad direction.
 *
 * §4(1)(w) ZDP requires the holding period to *exceed* three years
 * ("přesáhne"), so a sale on the anniversary itself is still taxable; the
 * earliest exempt date is the day after.
 *
 * 29 February + 3 years has no counterpart date; JavaScript rolls it to 1 March,
 * which is the conservative reading and the one used here.
 */
export function passesThreeYearTest(buyDate: string, sellDate: string): boolean {
  const buy = new Date(`${buyDate}T00:00:00Z`)
  if (isNaN(buy.getTime())) return false
  const anniversary = new Date(buy)
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 3)
  return sellDate > anniversary.toISOString().slice(0, 10)
}

const byDate = (a: Transaction, b: Transaction) =>
  a.txn_date.localeCompare(b.txn_date) ||
  (a.created_at ?? '').localeCompare(b.created_at ?? '')

/**
 * The row's own CZK rate. A missing or nonsensical rate falls back to 1 — that
 * makes a CZK-denominated row exact and a foreign one obviously wrong, which is
 * better than an amount multiplied by zero and silently disappearing.
 */
const fxOf = (t: Transaction): number =>
  isFinite(t.fx_rate_czk) && t.fx_rate_czk > 0 ? t.fx_rate_czk : 1

/**
 * A transaction's CZK value — the single definition, used by realized P&L, the
 * ledger table, external flows and the summary alike.
 *
 * The stored `amount_czk` is authoritative when it is a real number; otherwise
 * the amount is converted with the row's own rate, falling back through `fxOf`.
 * Two different fallbacks in one file meant the same row counted as 0 in one
 * panel and its full value in another.
 */
export const czkOf = (t: Transaction): number => {
  if (isFinite(t.amount_czk) && t.amount_czk !== 0) return t.amount_czk
  const converted = t.amount * fxOf(t)
  return isFinite(converted) ? converted : 0
}

/** Cost-weighted average buy rate across lots. */
function weightedFx(lots: Lot[]): number {
  const cost = lots.reduce((s, l) => s + l.shares * l.price, 0)
  if (cost <= 0) return lots[0]?.fxRateCZK ?? 1
  return lots.reduce((s, l) => s + l.shares * l.price * l.fxRateCZK, 0) / cost
}

/** A ratio-for-1 split: shares × ratio, per-share price ÷ ratio. */
const applySplit = (lots: Lot[], ratio: number): Lot[] =>
  lots.map(l => ({ ...l, shares: l.shares * ratio, price: l.price / ratio }))

/**
 * Re-price every open lot at the pool's average cost and average FX, keeping
 * each lot's own date and share count.
 */
function averageLots(lots: Lot[]): Lot[] {
  const shares = lots.reduce((s, l) => s + l.shares, 0)
  if (shares <= 0) return lots
  const avg = lots.reduce((s, l) => s + l.shares * l.price, 0) / shares
  const avgFx = weightedFx(lots)
  return lots.map(l => ({ ...l, price: avg, fxRateCZK: avgFx }))
}

/**
 * Running cost basis for one symbol.
 *
 * Buy fees increase the basis, sell fees reduce proceeds — the same convention
 * the Czech tax return uses.
 */
export function costBasis(
  symbol: string,
  txns: Transaction[],
  method: 'fifo' | 'avg' = 'fifo'
): CostBasis {
  const rows = txns
    .filter(t => t.symbol === symbol && (t.type === 'buy' || t.type === 'sell' || t.type === 'split'))
    .sort(byDate)

  let lots: Lot[] = []
  let currency = rows[0]?.currency ?? 'USD'

  for (const t of rows) {
    const qty = Math.abs(t.quantity ?? 0)
    if (qty <= 0) continue
    if (t.type === 'split') { lots = applySplit(lots, qty); continue }
    currency = t.currency

    if (t.type === 'buy') {
      const gross = Math.abs(t.amount) + (t.fee ?? 0)
      lots.push({
        date: t.txn_date, shares: qty, price: gross / qty,
        currency: t.currency, fxRateCZK: fxOf(t),
      })
      continue
    }

    // Sell: consume lots
    let remaining = qty
    // Average-cost mode prices every share at the pool average but still
    // consumes shares oldest-first, so each keeps its own acquisition date.
    if (method === 'avg') lots = averageLots(lots)
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0]
      const take = Math.min(lot.shares, remaining)
      lot.shares -= take
      remaining -= take
      if (lot.shares <= 1e-9) lots.shift()
    }
  }

  const shares = lots.reduce((s, l) => s + l.shares, 0)
  const cost = lots.reduce((s, l) => s + l.shares * l.price, 0)
  return { shares, avgPrice: shares > 0 ? cost / shares : 0, lots, currency }
}

/**
 * Realized gains, lot by lot.
 *
 * FIFO matches how Czech reporting normally works; 'avg' is offered because
 * some brokers report that way and mixing the two silently would be worse than
 * making the choice explicit.
 */
export function realizedPL(txns: Transaction[], method: 'fifo' | 'avg' = 'fifo'): RealizedLot[] {
  const symbols = Array.from(new Set(
    txns.filter(t => t.symbol && (t.type === 'buy' || t.type === 'sell')).map(t => t.symbol!)
  ))
  const out: RealizedLot[] = []

  for (const symbol of symbols) {
    const rows = txns
      .filter(t => t.symbol === symbol && (t.type === 'buy' || t.type === 'sell' || t.type === 'split'))
      .sort(byDate)

    let lots: Lot[] = []

    for (const t of rows) {
      const qty = Math.abs(t.quantity ?? 0)
      if (qty <= 0) continue
      // A split changes the share count and per-share cost, never the total
      // cost or the acquisition dates.
      if (t.type === 'split') { lots = applySplit(lots, qty); continue }

      if (t.type === 'buy') {
        const gross = Math.abs(t.amount) + (t.fee ?? 0)
        lots.push({
          date: t.txn_date, shares: qty, price: gross / qty,
          currency: t.currency, fxRateCZK: fxOf(t),
        })
        continue
      }

      // Sell: proceeds net of fees, matched against consumed lots
      const proceeds = Math.abs(t.amount) - (t.fee ?? 0)
      const proceedsPerShare = qty > 0 ? proceeds / qty : 0
      const sellFx = fxOf(t)
      let remaining = qty

      // Proceeds at the sell rate, cost at the buy rate. The gap between that
      // and converting both at the sell rate is the currency component, which
      // is reported alongside rather than folded away.
      const record = (
        shares: number, costLocal: number, proceedsLocal: number,
        buyFx: number, buyDate: string | null
      ) => {
        const gainCZK = proceedsLocal * sellFx - costLocal * buyFx
        out.push({
          symbol, sellDate: t.txn_date, shares,
          proceedsLocal, costLocal, gainLocal: proceedsLocal - costLocal,
          gainCZK,
          fxGainCZK: gainCZK - (proceedsLocal - costLocal) * sellFx,
          proceedsCZK: proceedsLocal * sellFx,
          currency: t.currency,
          holdingDays: buyDate ? daysBetween(buyDate, t.txn_date) : 0,
          // Unmatched shares have no purchase date, so no exemption can be
          // claimed for them until the missing buy is backfilled.
          passesTimeTest: buyDate ? passesThreeYearTest(buyDate, t.txn_date) : false,
          ...(buyDate ? {} : { basisIncomplete: true }),
        })
      }

      // Average cost may set the *amount* of the basis, but the time test is
      // per acquired share: collapsing the pool onto its oldest date reported
      // shares bought last year as exempt. Price at the average, consume FIFO.
      if (method === 'avg') lots = averageLots(lots)

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0]
        const take = Math.min(lot.shares, remaining)
        record(take, take * lot.price, take * proceedsPerShare, lot.fxRateCZK, lot.date)
        lot.shares -= take
        remaining -= take
        if (lot.shares <= 1e-9) lots.shift()
      }

      // Shares sold with no buy behind them. Reporting the sale with a zero
      // basis and a flag beats dropping it: the money did move, and silently
      // understating realized P&L is exactly what a ledger is meant to prevent.
      if (remaining > 1e-9) {
        record(remaining, 0, remaining * proceedsPerShare, sellFx, null)
      }
    }
  }

  return out.sort((a, b) => b.sellDate.localeCompare(a.sellDate))
}

export interface ExternalFlow {
  date: string
  amountCZK: number
}

/**
 * Money crossing the boundary of your wealth, in CZK, one entry per date.
 *
 * Sign is kept as stored: positive = money in. Consumers that need XIRR
 * convention (contributions negative) should negate.
 */
export function externalFlows(txns: Transaction[]): ExternalFlow[] {
  const byDay = new Map<string, number>()
  for (const t of txns) {
    if (!t.is_external) continue
    byDay.set(t.txn_date, (byDay.get(t.txn_date) ?? 0) + czkOf(t))
  }
  return Array.from(byDay, ([date, amountCZK]) => ({ date, amountCZK }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface ContributionSplit {
  date: string
  /** Cumulative external money put in since the first snapshot. */
  contributed: number
  /** Portfolio value minus contributions — the part the market actually earned. */
  growth: number
  value: number
}

/**
 * Splits the net-worth curve into "money I added" and "money the portfolio made".
 * This is the answer to "of the +240k this year, how much did I actually earn?".
 */
export function contributionsVsGrowth(
  txns: Transaction[],
  snapshots: { snapshot_date: string; total_value_czk: number }[]
): ContributionSplit[] {
  const sorted = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  if (sorted.length === 0) return []

  const flows = externalFlows(txns)
  const startValue = sorted[0].total_value_czk
  const startDate = sorted[0].snapshot_date

  // Single ascending pass with a running total. Re-filtering the whole flow
  // list per snapshot was O(n·m), and this runs on every dashboard render.
  let flowIdx = 0
  let contributed = 0
  while (flowIdx < flows.length && flows[flowIdx].date <= startDate) flowIdx++

  return sorted.map(s => {
    while (flowIdx < flows.length && flows[flowIdx].date <= s.snapshot_date) {
      contributed += flows[flowIdx].amountCZK
      flowIdx++
    }
    return {
      date: s.snapshot_date,
      contributed,
      growth: s.total_value_czk - startValue - contributed,
      value: s.total_value_czk,
    }
  })
}

export interface LedgerSummary {
  totalContributedCZK: number
  totalWithdrawnCZK: number
  netContributedCZK: number
  realizedPLCZK: number
  feesCZK: number
  taxCZK: number
  incomeCZK: number
}

/**
 * Headline figures for the ledger page, optionally restricted to one year.
 *
 * Realized P&L is deliberately computed over the *whole* history and only then
 * filtered to sells in the target year. Filtering the transactions first would
 * discard the buy rows that establish the cost basis, so a sale of shares
 * bought in an earlier year would be measured against nothing.
 */
export function summarise(txns: Transaction[], year?: number): LedgerSummary {
  const inYear = (date: string) => year == null || Number(date.slice(0, 4)) === year
  const rows = txns.filter(t => inYear(t.txn_date))

  const realizedCZK = realizedPL(txns)
    .filter(l => inYear(l.sellDate))
    .reduce((s, l) => s + l.gainCZK, 0)

  const czk = czkOf

  const contributed = rows
    .filter(t => t.is_external && czk(t) > 0)
    .reduce((s, t) => s + czk(t), 0)
  const withdrawn = rows
    .filter(t => t.is_external && czk(t) < 0)
    .reduce((s, t) => s + Math.abs(czk(t)), 0)

  const incomeTypes: TransactionType[] = ['dividend', 'interest', 'rent']

  return {
    totalContributedCZK: contributed,
    totalWithdrawnCZK: withdrawn,
    netContributedCZK: contributed - withdrawn,
    realizedPLCZK: realizedCZK,
    feesCZK: rows.reduce((s, t) => s + (t.fee ?? 0) * fxOf(t), 0),
    taxCZK: rows.reduce((s, t) => s + (t.tax ?? 0) * fxOf(t), 0),
    incomeCZK: rows
      .filter(t => incomeTypes.includes(t.type))
      .reduce((s, t) => s + Math.abs(czk(t)), 0),
  }
}

/**
 * Whether a transaction type moves money across the wealth boundary by default.
 * The form pre-fills from this; the user can still override per row, because
 * "dividend withdrawn to spend" is genuinely a second, external, movement.
 */
export function defaultIsExternal(type: TransactionType): boolean {
  return type === 'deposit' || type === 'withdrawal'
}

/** Running CZK balance for the ledger table, oldest first. */
export function runningBalance(txns: Transaction[]): Map<string, number> {
  const sorted = [...txns].sort(byDate)
  const out = new Map<string, number>()
  let balance = 0
  for (const t of sorted) {
    balance += czkOf(t)
    out.set(t.id, balance)
  }
  return out
}

export interface BackfillInput {
  holdings: { id: string; symbol: string; shares: number; avg_price: number; currency: string; purchase_date: string | null }[]
  lots: { holding_id: string | null; symbol: string; shares: number; purchase_price: number; purchase_date: string | null; fx_rate_czk?: number | null }[]
  dividends: { symbol: string; payment_date: string; shares_held: number; amount_per_share: number; gross_amount: number; withholding_tax: number | null; currency: string; fx_rate_czk?: number | null }[]
  /** Already-backfilled keys (see backfillKey), skipped for idempotency. */
  existingKeys: Set<string>
  /** CZK per unit of currency on a date, or null when unknown. */
  rateOn: (currency: string, date: string) => number | null
  today: string
}

/** Identity of a backfilled row: two lots bought the same day differ by quantity. */
export const backfillKey = (type: string, symbol: string | null, date: string, quantity: number | null | undefined) =>
  `${type}::${symbol ?? ''}::${date}::${quantity != null ? Number(quantity).toFixed(6) : ''}`

export interface BackfillResult {
  rows: Record<string, unknown>[]
  /** Rows that could not be written because no historical rate was available. */
  skipped: { what: string; date: string; currency: string }[]
}

/**
 * Ledger rows reconstructed from what is already recorded, one buy per
 * purchase lot on its own date at that date's rate (not one lump at today's
 * rate, which dated every share to the first purchase and froze the wrong FX).
 * Shares a holding has beyond its recorded lots become one residual buy at the
 * average price on the holding's purchase date, labelled as such.
 */
export function backfillRows(input: BackfillInput): BackfillResult {
  const rows: Record<string, unknown>[] = []
  const skipped: BackfillResult['skipped'] = []
  const push = (type: string, symbol: string, date: string, currency: string, row: Record<string, unknown>, rateHint?: number | null) => {
    const key = backfillKey(type, symbol, date, row.quantity as number | null)
    if (input.existingKeys.has(key)) return
    const rate = rateHint != null && rateHint > 0 ? rateHint : input.rateOn(currency, date)
    if (rate == null) { skipped.push({ what: `${type} ${symbol}`, date, currency }); return }
    input.existingKeys.add(key)
    rows.push({ ...row, txn_date: date, symbol, currency, fx_rate_czk: rate, is_external: false })
  }

  for (const h of input.holdings) {
    const lots = input.lots
      .filter(l => l.holding_id === h.id || (l.holding_id == null && l.symbol === h.symbol))
      .filter(l => l.shares > 0)
    let covered = 0
    for (const l of lots) {
      const date = l.purchase_date ?? h.purchase_date ?? input.today
      covered += l.shares
      push('buy', h.symbol, date, h.currency, {
        type: 'buy', asset_class: 'stock', asset_id: h.id, quantity: l.shares, price: l.purchase_price,
        amount: -(l.shares * l.purchase_price), notes: 'backfilled',
      }, l.fx_rate_czk)
    }
    const residual = h.shares - covered
    if (residual > 1e-9) {
      const earliest = lots.map(l => l.purchase_date).filter((d): d is string => !!d).sort()[0]
      const date = h.purchase_date ?? earliest ?? input.today
      push('buy', h.symbol, date, h.currency, {
        type: 'buy', asset_class: 'stock', asset_id: h.id, quantity: residual, price: h.avg_price,
        amount: -(residual * h.avg_price), notes: 'backfilled (shares without a recorded lot, at average cost)',
      })
    }
  }

  for (const d of input.dividends) {
    push('dividend', d.symbol, d.payment_date, d.currency, {
      type: 'dividend', asset_class: 'stock', quantity: d.shares_held, price: d.amount_per_share,
      amount: d.gross_amount, tax: d.withholding_tax ?? 0, notes: 'backfilled',
    }, d.fx_rate_czk)
  }

  return { rows, skipped }
}
