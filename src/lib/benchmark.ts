/**
 * benchmark.ts — "would the index have done better?", answered honestly.
 *
 * The naive comparison (buy-and-hold the index from day one) flatters or
 * punishes you for money you hadn't invested yet. The shadow portfolio replays
 * *your* actual cash flows into the benchmark instead, so both series see the
 * same money at the same times.
 *
 * Benchmarks are converted to CZK at the rate of each date: a Czech investor's
 * SPY return includes the FX move, and hiding that would make the comparison
 * dishonest.
 */
import type { BenchmarkPrice } from './supabase'
import type { ValuePoint } from './returns'

export interface Flow {
  date: string
  /** Positive = money in, matching the ledger's sign convention. */
  amountCZK: number
}

export interface ShadowPoint {
  date: string
  valueCZK: number
  units: number
}

/** CZK per 1 unit of the benchmark's currency, by date. */
export type FxByDate = Record<string, number>

/** Nearest rate at or before `date`, falling back to the earliest known. */
function rateOn(fxByDate: FxByDate, date: string): number | null {
  if (fxByDate[date] != null && isFinite(fxByDate[date])) return fxByDate[date]
  const dates = Object.keys(fxByDate).sort()
  if (dates.length === 0) return null
  let candidate: string | null = null
  for (const d of dates) {
    if (d <= date) candidate = d
    else break
  }
  const chosen = candidate ?? dates[0]
  const rate = fxByDate[chosen]
  return isFinite(rate) ? rate : null
}

/** Most recent close at or before `date`. */
function priceOn(prices: BenchmarkPrice[], date: string): number | null {
  let candidate: number | null = null
  for (const p of prices) {
    if (p.price_date <= date) candidate = p.close
    else break
  }
  return candidate != null && isFinite(candidate) && candidate > 0 ? candidate : null
}

/**
 * Replay external cash flows into the benchmark.
 *
 * Each contribution buys units at that day's price and FX; each withdrawal
 * sells them. The result is what you'd hold today had every koruna gone into
 * the index on the day you actually invested it.
 */
export function shadowPortfolio(
  flows: Flow[],
  prices: BenchmarkPrice[],
  fxByDate: FxByDate
): ShadowPoint[] {
  const sortedPrices = [...prices].sort((a, b) => a.price_date.localeCompare(b.price_date))
  if (sortedPrices.length === 0) return []

  const sortedFlows = [...flows]
    .filter(f => isFinite(f.amountCZK))
    .sort((a, b) => a.date.localeCompare(b.date))

  const out: ShadowPoint[] = []
  let units = 0
  let flowIdx = 0

  for (const p of sortedPrices) {
    // Apply every flow up to and including this price date
    while (flowIdx < sortedFlows.length && sortedFlows[flowIdx].date <= p.price_date) {
      const flow = sortedFlows[flowIdx]
      const px = priceOn(sortedPrices, flow.date)
      const fx = rateOn(fxByDate, flow.date)
      if (px != null && fx != null && px * fx > 0) {
        units += flow.amountCZK / (px * fx)
      }
      flowIdx++
    }

    const fx = rateOn(fxByDate, p.price_date)
    if (fx == null) continue
    out.push({
      date: p.price_date,
      // Units can go negative if withdrawals exceed contributions; clamping
      // would hide that, so the raw figure is kept.
      units,
      valueCZK: units * p.close * fx,
    })
  }

  return out
}

/** Difference between two indexed series at their last common date, in points. */
export function trackingDifference(mine: ValuePoint[], bench: ValuePoint[]): number | null {
  if (mine.length === 0 || bench.length === 0) return null
  const benchByDate: Record<string, number> = {}
  for (const b of bench) benchByDate[b.date] = b.value

  const common = [...mine]
    .filter(m => benchByDate[m.date] != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (common.length === 0) return null

  const last = common[common.length - 1]
  return last.value - benchByDate[last.date]
}

/** Overlapping date range of two series — the only window worth comparing over. */
export function commonWindow(
  a: { date: string }[],
  b: { date: string }[]
): { from: string; to: string } | null {
  if (a.length === 0 || b.length === 0) return null
  const aDates = a.map(x => x.date).sort()
  const bDates = b.map(x => x.date).sort()
  const from = aDates[0] > bDates[0] ? aDates[0] : bDates[0]
  const to = aDates[aDates.length - 1] < bDates[bDates.length - 1]
    ? aDates[aDates.length - 1]
    : bDates[bDates.length - 1]
  return from <= to ? { from, to } : null
}

/** Restrict a series to a date window. */
export const clipSeries = <T extends { date: string }>(
  series: T[], from: string, to: string
): T[] => series.filter(p => p.date >= from && p.date <= to)

export const BENCHMARK_OPTIONS = [
  { symbol: 'SPY',  label: 'S&P 500 (SPY)',        currency: 'USD' },
  { symbol: 'IWDA', label: 'MSCI World (IWDA)',    currency: 'USD' },
  { symbol: 'URTH', label: 'MSCI World (URTH)',    currency: 'USD' },
  { symbol: 'CZK_SAVINGS', label: 'CZK savings account', currency: 'CZK' },
]

export type BenchmarkWindow = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'

/** Start date for a named window, given today. */
export function windowStart(window: BenchmarkWindow, today: string): string | null {
  if (window === 'ALL') return null
  if (window === 'YTD') return `${today.slice(0, 4)}-01-01`
  const days = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365 }[window]
  const d = new Date(Date.parse(today) - days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

/**
 * Build a date→rate lookup from snapshots, which already record the FX rate
 * each historical value was struck at.
 *
 * Rows written before live FX was available carry null and are skipped rather
 * than defaulted — a fabricated rate would silently corrupt the comparison.
 */
export function fxByDateFromSnapshots(
  snapshots: { snapshot_date: string; fx_usd?: number | null; fx_eur?: number | null }[],
  currency: string
): FxByDate {
  const out: FxByDate = {}
  for (const s of snapshots) {
    const rate = currency === 'USD' ? s.fx_usd
      : currency === 'EUR' ? s.fx_eur
      : currency === 'CZK' ? 1
      : null
    if (rate == null || !isFinite(rate) || rate <= 0) continue
    out[s.snapshot_date] = rate
  }
  return out
}
