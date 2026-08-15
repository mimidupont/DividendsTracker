/**
 * returns.ts — return maths.
 *
 * Every function here is pure and returns `null` rather than NaN/Infinity when
 * the inputs cannot produce an honest answer. "Not enough data yet" is a real
 * state in a portfolio tracker and the UI renders it as an em dash.
 */

export interface Flow {
  date: Date
  /** Signed: negative = money into the portfolio, positive = money out. */
  amount: number
}

const DAY_MS = 86_400_000
const yearsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (DAY_MS * 365)

/** Net present value of `flows` at annual rate `rate`, discounted from the first date. */
function npv(flows: Flow[], rate: number): number {
  const t0 = flows[0].date
  return flows.reduce(
    (sum, f) => sum + f.amount / Math.pow(1 + rate, yearsBetween(t0, f.date)),
    0
  )
}

/**
 * Internal rate of return for irregularly-timed flows.
 *
 * Newton–Raphson with a bisection fallback, because Newton diverges readily on
 * the flow patterns real portfolios produce. Returns null on non-convergence
 * rather than a number that looks plausible and isn't.
 *
 * Sign convention: contributions are negative, withdrawals positive, and the
 * final portfolio value is a terminal positive flow.
 */
export function xirr(flows: Flow[], guess = 0.1): number | null {
  if (flows.length < 2) return null

  const sorted = [...flows]
    .filter(f => isFinite(f.amount) && !isNaN(f.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  if (sorted.length < 2) return null

  // Needs money in and money out, or there is no rate that balances them.
  if (!sorted.some(f => f.amount > 0) || !sorted.some(f => f.amount < 0)) return null

  // ── Newton–Raphson ──
  let rate = guess
  for (let i = 0; i < 100; i++) {
    const t0 = sorted[0].date
    let f = 0
    let df = 0
    for (const flow of sorted) {
      const t = yearsBetween(t0, flow.date)
      const denom = Math.pow(1 + rate, t)
      if (!isFinite(denom) || denom === 0) { f = NaN; break }
      f += flow.amount / denom
      df -= (t * flow.amount) / (denom * (1 + rate))
    }
    if (!isFinite(f) || !isFinite(df) || df === 0) break
    const next = rate - f / df
    if (!isFinite(next) || next <= -1) break
    if (Math.abs(next - rate) < 1e-9) {
      return isFinite(next) ? next : null
    }
    rate = next
  }

  // ── Bisection fallback over a wide bracket ──
  let lo = -0.9999
  let hi = 10
  let fLo = npv(sorted, lo)
  let fHi = npv(sorted, hi)
  if (!isFinite(fLo) || !isFinite(fHi) || fLo * fHi > 0) return null

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fMid = npv(sorted, mid)
    if (!isFinite(fMid)) return null
    if (Math.abs(fMid) < 1e-7 || (hi - lo) / 2 < 1e-9) return mid
    if (fLo * fMid < 0) { hi = mid; fHi = fMid } else { lo = mid; fLo = fMid }
  }
  return (lo + hi) / 2
}

/** Compound annual growth rate. Null when the inputs cannot produce one. */
export function cagr(start: number, end: number, years: number): number | null {
  if (!isFinite(start) || !isFinite(end) || start <= 0 || years <= 0) return null
  const r = Math.pow(end / start, 1 / years) - 1
  return isFinite(r) ? r : null
}

export interface ValuePoint {
  date: string
  value: number
}

/**
 * Time-weighted return, chained across sub-periods split at each external flow
 * (Modified Dietz within each sub-period).
 *
 * TWR is the number to judge *decisions* by: unlike XIRR it is unaffected by
 * when money was added, so it does not reward or punish you for the timing of
 * a salary payment.
 */
export function twr(points: ValuePoint[], flows: { date: string; amountCZK: number }[]): number | null {
  if (points.length < 2) return null

  const series = [...points]
    .filter(p => isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (series.length < 2) return null

  const flowsByDate: { date: string; amount: number }[] = []
  for (const f of flows) {
    if (!isFinite(f.amountCZK)) continue
    const existing = flowsByDate.find(x => x.date === f.date)
    if (existing) existing.amount += f.amountCZK
    else flowsByDate.push({ date: f.date, amount: f.amountCZK })
  }

  let compounded = 1
  let sawPeriod = false

  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]
    const curr = series[i]

    // Flows landing inside (prev, curr] are treated as arriving at the end of
    // the sub-period, which is exact when snapshots are daily.
    let flow = 0
    for (const f of flowsByDate) {
      if (f.date > prev.date && f.date <= curr.date) flow += f.amount
    }

    if (prev.value <= 0) continue
    const periodReturn = (curr.value - flow - prev.value) / prev.value
    if (!isFinite(periodReturn)) continue
    compounded *= 1 + periodReturn
    sawPeriod = true
  }

  if (!sawPeriod || !isFinite(compounded)) return null
  return compounded - 1
}

/** Annualise a total return achieved over `years`. */
export function annualise(totalReturn: number, years: number): number | null {
  if (!isFinite(totalReturn) || years <= 0 || totalReturn <= -1) return null
  const r = Math.pow(1 + totalReturn, 1 / years) - 1
  return isFinite(r) ? r : null
}

export interface Drawdown {
  pct: number
  peakDate: string
  troughDate: string
}

/** Largest peak-to-trough decline in a value series. */
export function maxDrawdown(series: ValuePoint[]): Drawdown | null {
  if (series.length < 2) return null
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))

  let peak = sorted[0].value
  let peakDate = sorted[0].date
  let worst = 0
  let worstPeak = peakDate
  let worstTrough = peakDate

  for (const point of sorted) {
    if (point.value > peak) { peak = point.value; peakDate = point.date }
    if (peak <= 0) continue
    const dd = (point.value - peak) / peak
    if (dd < worst) { worst = dd; worstPeak = peakDate; worstTrough = point.date }
  }

  // A series that only ever rose has no measured drawdown. Reporting 0.0% would
  // read as a measurement; null lets the UI show an em dash instead.
  if (worst === 0) return null
  return { pct: worst, peakDate: worstPeak, troughDate: worstTrough }
}

/** Rescale a series so its first point is 100 — the basis for comparing two curves. */
export function indexTo100(series: ValuePoint[]): ValuePoint[] {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))
  const base = sorted.find(p => p.value > 0)?.value
  if (!base) return []
  return sorted.map(p => ({ date: p.date, value: (p.value / base) * 100 }))
}

/** Rolling total return over a trailing window, in percent. */
export function rollingReturns(series: ValuePoint[], windowDays: number): ValuePoint[] {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))
  const out: ValuePoint[] = []
  for (let i = 0; i < sorted.length; i++) {
    const cutoff = new Date(Date.parse(sorted[i].date) - windowDays * DAY_MS)
      .toISOString().slice(0, 10)
    const start = sorted.filter(p => p.date <= cutoff).pop()
    if (!start || start.value <= 0) continue
    out.push({ date: sorted[i].date, value: ((sorted[i].value / start.value) - 1) * 100 })
  }
  return out
}
