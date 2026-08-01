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
}

export interface RealizedLot {
  symbol: string
  sellDate: string
  shares: number
  proceedsLocal: number
  costLocal: number
  gainLocal: number
  gainCZK: number
  currency: string
  /** Days held — matters for the Czech 3-year time test. */
  holdingDays: number
  /** True when the lot was held ≥ 3 years (Czech time-test exemption). */
  passesTimeTest: boolean
}

export interface CostBasis {
  shares: number
  avgPrice: number
  lots: Lot[]
  currency: string
}

const THREE_YEARS_DAYS = 365 * 3
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

const byDate = (a: Transaction, b: Transaction) =>
  a.txn_date.localeCompare(b.txn_date) || a.created_at.localeCompare(b.created_at)

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
    .filter(t => t.symbol === symbol && (t.type === 'buy' || t.type === 'sell'))
    .sort(byDate)

  let lots: Lot[] = []
  let currency = rows[0]?.currency ?? 'USD'

  for (const t of rows) {
    const qty = Math.abs(t.quantity ?? 0)
    if (qty <= 0) continue
    currency = t.currency

    if (t.type === 'buy') {
      const gross = Math.abs(t.amount) + (t.fee ?? 0)
      lots.push({ date: t.txn_date, shares: qty, price: gross / qty, currency: t.currency })
      continue
    }

    // Sell: consume lots
    let remaining = qty
    if (method === 'avg') {
      const totalShares = lots.reduce((s, l) => s + l.shares, 0)
      const totalCost = lots.reduce((s, l) => s + l.shares * l.price, 0)
      const avg = totalShares > 0 ? totalCost / totalShares : 0
      const left = Math.max(0, totalShares - remaining)
      lots = left > 0 ? [{ date: t.txn_date, shares: left, price: avg, currency: t.currency }] : []
      continue
    }
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
      .filter(t => t.symbol === symbol && (t.type === 'buy' || t.type === 'sell'))
      .sort(byDate)

    let lots: Lot[] = []

    for (const t of rows) {
      const qty = Math.abs(t.quantity ?? 0)
      if (qty <= 0) continue

      if (t.type === 'buy') {
        const gross = Math.abs(t.amount) + (t.fee ?? 0)
        lots.push({ date: t.txn_date, shares: qty, price: gross / qty, currency: t.currency })
        continue
      }

      // Sell: proceeds net of fees, matched against consumed lots
      const proceeds = Math.abs(t.amount) - (t.fee ?? 0)
      const proceedsPerShare = qty > 0 ? proceeds / qty : 0
      let remaining = qty

      if (method === 'avg') {
        const totalShares = lots.reduce((s, l) => s + l.shares, 0)
        const totalCost = lots.reduce((s, l) => s + l.shares * l.price, 0)
        const avg = totalShares > 0 ? totalCost / totalShares : 0
        const matched = Math.min(remaining, totalShares)
        const oldest = lots[0]?.date ?? t.txn_date
        const held = daysBetween(oldest, t.txn_date)
        const costLocal = avg * matched
        const proceedsLocal = proceedsPerShare * matched
        out.push({
          symbol, sellDate: t.txn_date, shares: matched,
          proceedsLocal, costLocal, gainLocal: proceedsLocal - costLocal,
          gainCZK: (proceedsLocal - costLocal) * t.fx_rate_czk,
          currency: t.currency, holdingDays: held,
          passesTimeTest: held >= THREE_YEARS_DAYS,
        })
        const left = Math.max(0, totalShares - matched)
        lots = left > 0 ? [{ date: oldest, shares: left, price: avg, currency: t.currency }] : []
        continue
      }

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0]
        const take = Math.min(lot.shares, remaining)
        const costLocal = take * lot.price
        const proceedsLocal = take * proceedsPerShare
        const held = daysBetween(lot.date, t.txn_date)
        out.push({
          symbol, sellDate: t.txn_date, shares: take,
          proceedsLocal, costLocal, gainLocal: proceedsLocal - costLocal,
          gainCZK: (proceedsLocal - costLocal) * t.fx_rate_czk,
          currency: t.currency, holdingDays: held,
          passesTimeTest: held >= THREE_YEARS_DAYS,
        })
        lot.shares -= take
        remaining -= take
        if (lot.shares <= 1e-9) lots.shift()
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
    const czk = isFinite(t.amount_czk) ? t.amount_czk : t.amount * t.fx_rate_czk
    if (!isFinite(czk)) continue
    byDay.set(t.txn_date, (byDay.get(t.txn_date) ?? 0) + czk)
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

  return sorted.map(s => {
    const contributed = flows
      .filter(f => f.date > startDate && f.date <= s.snapshot_date)
      .reduce((sum, f) => sum + f.amountCZK, 0)
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

  const czk = (t: Transaction) =>
    isFinite(t.amount_czk) ? t.amount_czk : t.amount * t.fx_rate_czk

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
    feesCZK: rows.reduce((s, t) => s + (t.fee ?? 0) * t.fx_rate_czk, 0),
    taxCZK: rows.reduce((s, t) => s + (t.tax ?? 0) * t.fx_rate_czk, 0),
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
    balance += isFinite(t.amount_czk) ? t.amount_czk : t.amount * t.fx_rate_czk
    out.set(t.id, balance)
  }
  return out
}
