/**
 * bonds.ts — fixed income maths.
 *
 * A bond's value is not "price × quantity". The price is a percentage of the
 * nominal, interest accrues daily between coupons and belongs to whoever holds
 * the paper on each of those days, and the return you actually earn depends on
 * getting the nominal back at maturity — none of which falls out of the equity
 * model. Everything here works in the bond's own currency; conversion to CZK
 * happens once, in portfolio.ts.
 *
 * Conventions follow the French OAT, which is what prompted the module:
 * annual coupons, ACT/ACT (ICMA) accrual, clean prices quoted in percent of par.
 */
import type { Bond } from './supabase'

const MS_PER_DAY = 86_400_000

// ─── Dates ────────────────────────────────────────────────────────────────────

/** Parse an ISO date as a UTC midnight, so day counts never straddle a DST shift. */
export function parseISO(d: string | null | undefined): Date | null {
  if (!d) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  if (!m) return null
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return isNaN(date.getTime()) ? null : date
}

export const toISO = (d: Date): string => d.toISOString().slice(0, 10)

export const daysBetween = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / MS_PER_DAY)

/**
 * Add months, clamping to the end of the target month.
 *
 * A bond maturing on the 31st pays its semi-annual coupon on the 30th (or the
 * 28th/29th), not on the 1st of the following month — which is where naive
 * date arithmetic lands and why a coupon date can otherwise drift a day later
 * every period.
 */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + months
  const day = d.getUTCDate()
  const daysInTarget = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(day, daysInTarget)))
}

// ─── Coupon schedule ──────────────────────────────────────────────────────────

/**
 * Coupon frequency, coerced to something usable.
 * A zero-coupon bond is `coupon_rate = 0`; the frequency still has to be ≥ 1 or
 * every period length below divides by zero.
 */
export const couponsPerYear = (b: Pick<Bond, 'coupons_per_year'>): number => {
  const f = Math.round(Number(b.coupons_per_year))
  return [1, 2, 4, 12].includes(f) ? f : 1
}

/**
 * The coupon period bracketing `asOf`, counted back from maturity.
 *
 * Coupon dates are anniversaries of the redemption date — that is how the
 * schedule is actually defined — so they are generated backwards from maturity
 * rather than forwards from issue, which would leave a stub at the wrong end.
 */
export function couponPeriod(
  b: Pick<Bond, 'coupons_per_year' | 'maturity_date' | 'issue_date'>,
  asOf: Date
): { previous: Date; next: Date } | null {
  const maturity = parseISO(b.maturity_date)
  if (!maturity) return null

  const freq = couponsPerYear(b)
  const step = 12 / freq

  // Walk back from maturity until we are at or before `asOf`.
  let next = maturity
  let guard = 0
  while (next.getTime() > asOf.getTime() && guard++ < 2400) {
    const candidate = addMonths(next, -step)
    if (candidate.getTime() <= asOf.getTime()) {
      return { previous: candidate, next }
    }
    next = candidate
  }

  // `asOf` is on or after maturity, or before the first generated date: fall
  // back to a single period ending at `next`.
  return { previous: addMonths(next, -step), next }
}

/** Remaining coupon payment dates, ascending, up to and including maturity. */
export function remainingCouponDates(
  b: Pick<Bond, 'coupons_per_year' | 'maturity_date' | 'issue_date'>,
  asOf: Date,
  limit = 200
): Date[] {
  const maturity = parseISO(b.maturity_date)
  if (!maturity || maturity.getTime() <= asOf.getTime()) return []

  const period = couponPeriod(b, asOf)
  if (!period) return []

  const step = 12 / couponsPerYear(b)
  const dates: Date[] = []
  let d = period.next
  while (d.getTime() <= maturity.getTime() && dates.length < limit) {
    if (d.getTime() > asOf.getTime()) dates.push(d)
    const nextD = addMonths(d, step)
    if (nextD.getTime() <= d.getTime()) break
    d = nextD
  }
  return dates
}

// ─── Day counts ───────────────────────────────────────────────────────────────

/** 30/360 (bond basis) day count between two dates. */
function days30360(start: Date, end: Date): number {
  let d1 = start.getUTCDate()
  let d2 = end.getUTCDate()
  if (d1 === 31) d1 = 30
  if (d2 === 31 && d1 === 30) d2 = 30
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 360 +
    (end.getUTCMonth() - start.getUTCMonth()) * 30 +
    (d2 - d1)
  )
}

/**
 * Fraction of the current coupon period that has elapsed at `asOf`, in [0, 1].
 *
 * ACT/ACT (ICMA) — the OAT convention — measures against the actual length of
 * the actual period, which is why a leap year does not distort the accrual.
 */
export function accrualFraction(
  b: Pick<Bond, 'coupons_per_year' | 'maturity_date' | 'issue_date' | 'day_count'>,
  asOf: Date
): number {
  const period = couponPeriod(b, asOf)
  if (!period) return 0

  const { previous, next } = period
  const convention = (b.day_count ?? 'ACT/ACT').toUpperCase()

  if (convention === '30/360') {
    const elapsed = days30360(previous, asOf)
    const total = days30360(previous, next)
    return total > 0 ? clamp01(elapsed / total) : 0
  }

  const elapsedDays = daysBetween(previous, asOf)

  if (convention === 'ACT/365') {
    // Accrual is measured against a fixed 365-day year rather than the period,
    // so it is expressed back in period units to stay comparable.
    const freq = couponsPerYear(b)
    return clamp01((elapsedDays / 365) * freq)
  }

  const periodDays = daysBetween(previous, next)
  return periodDays > 0 ? clamp01(elapsedDays / periodDays) : 0
}

const clamp01 = (n: number): number =>
  !isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n

// ─── Valuation ────────────────────────────────────────────────────────────────

export interface BondValuation {
  bond: Bond
  /** Nominal held, index-adjusted, in the bond's currency. */
  nominal: number
  /** Clean price as a fraction of par (0.9235 = 92.35%). */
  cleanPricePct: number
  /** False when no market price has been entered and cost is standing in for it. */
  hasMarketPrice: boolean
  cleanValue: number
  accruedInterest: number
  /** Clean + accrued: what the position would actually settle for today. */
  dirtyValue: number
  /** Clean cost + accrued paid to the seller at purchase. */
  costValue: number
  plValue: number
  plPct: number
  /** One coupon payment, gross, in the bond's currency. */
  couponAmount: number
  annualCouponGross: number
  annualCouponNet: number
  /** Coupon over clean market value. Null for a zero-coupon or unpriced bond. */
  currentYield: number | null
  /** Annualised yield to maturity as a decimal fraction. Null when unsolvable. */
  ytm: number | null
  /** Price sensitivity: a 1pp yield rise costs roughly this fraction of value. */
  modifiedDuration: number | null
  yearsToMaturity: number
  previousCouponDate: string | null
  nextCouponDate: string | null
  isMatured: boolean
}

/** Nominal amount held, after any inflation indexation. */
export const bondNominal = (b: Bond): number => {
  const ratio = b.is_inflation_linked && isFinite(b.index_ratio) && b.index_ratio > 0
    ? b.index_ratio
    : 1
  return num(b.quantity) * num(b.face_value) * ratio
}

const num = (v: unknown): number => {
  const n = Number(v)
  return isFinite(n) ? n : 0
}

/**
 * Everything derivable about one bond position as of `asOf`.
 *
 * `current_price_pct` is optional on purpose: bond quotes are hard to come by
 * for a retail holder, and a bond held to maturity is a perfectly sensible
 * position to track at cost. When it is absent the valuation says so via
 * `hasMarketPrice` rather than quietly implying a live mark.
 */
export function valueBond(b: Bond, asOf: Date = new Date()): BondValuation {
  const day = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()))
  const maturity = parseISO(b.maturity_date)
  const isMatured = !!maturity && maturity.getTime() <= day.getTime()

  const nominal = bondNominal(b)
  const hasMarketPrice = b.current_price_pct != null && isFinite(Number(b.current_price_pct))

  // A matured bond is worth its nominal — it has been redeemed at par, whatever
  // the last price it traded at was.
  const cleanPricePct = isMatured
    ? 1
    : (hasMarketPrice ? num(b.current_price_pct) : num(b.purchase_price_pct)) / 100

  const cleanValue = nominal * cleanPricePct

  const couponRate = num(b.coupon_rate)
  const freq = couponsPerYear(b)
  const couponAmount = (nominal * couponRate) / freq
  const annualCouponGross = isMatured ? 0 : nominal * couponRate
  const withholding = clamp01(num(b.withholding_tax_pct))
  const annualCouponNet = annualCouponGross * (1 - withholding)

  const accruedInterest = isMatured ? 0 : couponAmount * accrualFraction(b, day)
  const dirtyValue = cleanValue + accruedInterest

  // Cost is the clean price paid plus the coupon couru handed to the seller.
  const costValue =
    (num(b.quantity) * num(b.face_value) * num(b.purchase_price_pct)) / 100 +
    num(b.accrued_at_purchase)
  const plValue = dirtyValue - costValue

  const msToMaturity = maturity ? maturity.getTime() - day.getTime() : 0
  const yearsToMaturity = Math.max(0, msToMaturity / (MS_PER_DAY * 365.25))

  const period = couponPeriod(b, day)
  const cashflows = isMatured ? [] : remainingCouponDates(b, day)

  const ytm = isMatured || cashflows.length === 0 || dirtyValue <= 0
    ? null
    : solveYTM(dirtyValue, nominal, couponAmount, freq, cashflows.length, accrualFraction(b, day))

  const modifiedDuration = ytm == null
    ? null
    : durationAt(ytm, nominal, couponAmount, freq, cashflows.length, accrualFraction(b, day))

  return {
    bond: b,
    nominal,
    cleanPricePct,
    hasMarketPrice,
    cleanValue,
    accruedInterest,
    dirtyValue,
    costValue,
    plValue,
    plPct: costValue > 0 ? plValue / costValue : 0,
    couponAmount,
    annualCouponGross,
    annualCouponNet,
    currentYield: cleanValue > 0 && annualCouponGross > 0 ? annualCouponGross / cleanValue : null,
    ytm,
    modifiedDuration,
    yearsToMaturity,
    previousCouponDate: period ? toISO(period.previous) : null,
    nextCouponDate: cashflows.length > 0 ? toISO(cashflows[0]) : null,
    isMatured,
  }
}

// ─── Yield & duration ─────────────────────────────────────────────────────────

/**
 * Present value of the remaining cash flows at a periodic yield.
 *
 * Exponents are measured in coupon periods from settlement: the first coupon is
 * `1 - elapsed` periods away, the next one a full period after that. Discounting
 * the first coupon as if a whole period remained is the classic error that
 * makes a bond bought mid-period look cheap.
 */
function priceAt(
  annualYield: number,
  nominal: number,
  couponAmount: number,
  freq: number,
  periods: number,
  elapsed: number
): number {
  const y = annualYield / freq
  if (y <= -1) return Infinity
  let pv = 0
  for (let k = 0; k < periods; k++) {
    const t = k + (1 - elapsed)
    const cf = couponAmount + (k === periods - 1 ? nominal : 0)
    pv += cf / Math.pow(1 + y, t)
  }
  return pv
}

/**
 * Yield to maturity by bisection.
 *
 * Bisection rather than Newton–Raphson: price is monotonic in yield, the
 * bracket is known, and a deeply discounted long bond is exactly where Newton
 * likes to shoot off to a nonsense root. Negative yields are inside the bracket
 * because European government paper has genuinely traded there.
 */
export function solveYTM(
  dirtyPrice: number,
  nominal: number,
  couponAmount: number,
  freq: number,
  periods: number,
  elapsed: number,
  tolerance = 1e-10
): number | null {
  if (!(dirtyPrice > 0) || periods <= 0) return null

  let lo = -0.9 * freq   // periodic yield floor of -90%
  let hi = 10

  const f = (y: number) => priceAt(y, nominal, couponAmount, freq, periods, elapsed) - dirtyPrice

  let fLo = f(lo)
  let fHi = f(hi)
  if (!isFinite(fLo) || !isFinite(fHi) || fLo * fHi > 0) return null

  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2
    const fMid = f(mid)
    if (!isFinite(fMid)) return null
    if (Math.abs(fMid) < tolerance || hi - lo < 1e-12) return mid
    if (fLo * fMid <= 0) { hi = mid; fHi = fMid } else { lo = mid; fLo = fMid }
  }
  return (lo + hi) / 2
}

/**
 * Modified duration in years: the fractional price fall per 1.00 (100bp) rise
 * in yield. This is the number that says what a rate move does to the position,
 * and the only reason a 30-year OAT feels different from a 2-year one.
 */
export function durationAt(
  annualYield: number,
  nominal: number,
  couponAmount: number,
  freq: number,
  periods: number,
  elapsed: number
): number | null {
  const y = annualYield / freq
  if (y <= -1 || periods <= 0) return null

  let pv = 0
  let weighted = 0
  for (let k = 0; k < periods; k++) {
    const t = k + (1 - elapsed)
    const cf = couponAmount + (k === periods - 1 ? nominal : 0)
    const discounted = cf / Math.pow(1 + y, t)
    pv += discounted
    weighted += (t / freq) * discounted
  }
  if (pv <= 0) return null

  const macaulay = weighted / pv
  return macaulay / (1 + y)
}

/**
 * Approximate value after a parallel shift in yields, via modified duration.
 *
 * First order only — convexity is deliberately omitted. For the shift sizes a
 * scenario page uses it is close enough, and pretending to more precision than
 * a hand-entered price supports would be false comfort.
 */
export function shockedValue(v: BondValuation, yieldShiftBp: number): number {
  if (v.modifiedDuration == null || yieldShiftBp === 0) return v.dirtyValue
  const shift = yieldShiftBp / 10_000
  return Math.max(0, v.dirtyValue * (1 - v.modifiedDuration * shift))
}

// ─── Aggregates ───────────────────────────────────────────────────────────────

export interface BondTotals {
  nominal: number
  cleanValue: number
  accruedInterest: number
  dirtyValue: number
  costValue: number
  plValue: number
  plPct: number
  annualCouponGross: number
  annualCouponNet: number
  /** Value-weighted average, in years. Null when nothing is priceable. */
  averageDuration: number | null
  /** Value-weighted average YTM, as a decimal fraction. */
  averageYTM: number | null
  averageYearsToMaturity: number | null
  count: number
  maturedCount: number
}

/**
 * Portfolio-level bond figures.
 *
 * Duration and yield are weighted by value, not averaged flat: a €500 line and
 * a €50,000 line do not move the book's rate sensitivity equally, and a plain
 * mean of the two says they do.
 *
 * Only meaningful when every bond shares a currency — the caller converts
 * first, or accepts that the money figures mix units.
 */
export function bondTotals(valuations: BondValuation[]): BondTotals {
  const sum = (fn: (v: BondValuation) => number) =>
    valuations.reduce((s, v) => s + fn(v), 0)

  const dirtyValue = sum(v => v.dirtyValue)
  const costValue = sum(v => v.costValue)
  const plValue = dirtyValue - costValue

  const weighted = (pick: (v: BondValuation) => number | null): number | null => {
    let weight = 0
    let acc = 0
    for (const v of valuations) {
      const value = pick(v)
      if (value == null || v.dirtyValue <= 0) continue
      acc += value * v.dirtyValue
      weight += v.dirtyValue
    }
    return weight > 0 ? acc / weight : null
  }

  return {
    nominal: sum(v => v.nominal),
    cleanValue: sum(v => v.cleanValue),
    accruedInterest: sum(v => v.accruedInterest),
    dirtyValue,
    costValue,
    plValue,
    plPct: costValue > 0 ? plValue / costValue : 0,
    annualCouponGross: sum(v => v.annualCouponGross),
    annualCouponNet: sum(v => v.annualCouponNet),
    averageDuration: weighted(v => v.modifiedDuration),
    averageYTM: weighted(v => v.ytm),
    averageYearsToMaturity: weighted(v => (v.isMatured ? null : v.yearsToMaturity)),
    count: valuations.length,
    maturedCount: valuations.filter(v => v.isMatured).length,
  }
}

/** Upcoming coupon payments across a set of bonds, ascending by date. */
export interface UpcomingCoupon {
  bond: Bond
  date: string
  grossAmount: number
  netAmount: number
  currency: string
}

export function upcomingCoupons(
  bonds: Bond[],
  monthsAhead = 12,
  asOf: Date = new Date()
): UpcomingCoupon[] {
  const horizon = addMonths(asOf, monthsAhead)
  const out: UpcomingCoupon[] = []

  for (const b of bonds) {
    const v = valueBond(b, asOf)
    if (v.isMatured || v.couponAmount <= 0) continue
    const withholding = clamp01(num(b.withholding_tax_pct))
    for (const d of remainingCouponDates(b, asOf)) {
      if (d.getTime() > horizon.getTime()) break
      out.push({
        bond: b,
        date: toISO(d),
        grossAmount: v.couponAmount,
        netAmount: v.couponAmount * (1 - withholding),
        currency: b.currency,
      })
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export const BOND_TYPE_LABELS: Record<string, string> = {
  government: 'Government',
  corporate: 'Corporate',
  municipal: 'Municipal',
  supranational: 'Supranational',
  inflation_linked: 'Inflation-linked',
}

export const BOND_TYPE_COLORS: Record<string, string> = {
  government: 'var(--blue)',
  corporate: 'var(--amber)',
  municipal: 'var(--teal)',
  supranational: 'var(--purple)',
  inflation_linked: 'var(--green)',
}

export const COUPON_FREQUENCY_LABELS: Record<number, string> = {
  1: 'Annual',
  2: 'Semi-annual',
  4: 'Quarterly',
  12: 'Monthly',
}
