/**
 * bonds.ts — fixed-income maths.
 *
 * Pure functions over a `BondHolding` row. Conventions:
 *   · prices are "% of par" (98.5 means 98.5 %), rates are decimal fractions
 *   · per-bond amounts are in the bond's currency; multiply by `quantity`
 *   · dates are "YYYY-MM-DD" calendar strings (see date.ts for why)
 *   · anything that cannot be computed returns null, never NaN
 */
import type { BondHolding, DayCount } from './supabase'

type BondTerms = Pick<BondHolding,
  'face_value' | 'coupon_rate' | 'coupon_freq' | 'day_count' | 'issue_date' | 'maturity_date'>

// ── Calendar helpers (UTC, string in / string out) ───────────────────────────

const parse = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return isNaN(d.getTime()) ? null : d
}
const fmt = (d: Date) => d.toISOString().slice(0, 10)
const DAY = 86_400_000

export const daysBetween = (a: string, b: string): number => {
  const da = parse(a), db = parse(b)
  return da && db ? Math.round((db.getTime() - da.getTime()) / DAY) : 0
}

/**
 * Shift by whole months, pinned to the anchor's day-of-month where it exists
 * (31 Jan − 1 month = 31 Dec; 31 Mar − 1 month = 28/29 Feb).
 */
export function addMonths(iso: string, months: number, anchorDay?: number): string {
  const d = parse(iso)
  if (!d) return iso
  const day = anchorDay ?? d.getUTCDate()
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return fmt(target)
}

// ── Coupon schedule ──────────────────────────────────────────────────────────

/**
 * Coupon dates, generated backwards from maturity in steps of 12/freq months
 * (the market convention — it keeps the dates aligned to maturity even when
 * the first coupon is irregular). Stops at the issue date when known, else
 * `backTo`. Ascending order. Empty for a zero-coupon bond.
 */
export function couponSchedule(bond: BondTerms, backTo?: string): string[] {
  if (!bond.coupon_freq || bond.coupon_freq <= 0) return []
  const step = 12 / bond.coupon_freq
  const anchor = parse(bond.maturity_date)
  if (!anchor) return []
  const anchorDay = anchor.getUTCDate()
  const floor = bond.issue_date ?? backTo ?? addMonths(bond.maturity_date, -12 * 50)
  const out: string[] = []
  for (let i = 0; i < 12 * 60; i++) {
    const d = addMonths(bond.maturity_date, -step * i, anchorDay)
    if (d <= floor) break
    out.push(d)
  }
  return out.reverse()
}

/** Last coupon date on/before `settle` and next one after it (the accrual period). */
export function couponPeriod(bond: BondTerms, settle: string): { start: string; end: string } | null {
  if (!bond.coupon_freq || settle >= bond.maturity_date) return null
  const step = 12 / bond.coupon_freq
  const anchorDay = parse(bond.maturity_date)?.getUTCDate()
  let end = bond.maturity_date
  let start = addMonths(end, -step, anchorDay)
  for (let i = 0; i < 12 * 60 && start > settle; i++) {
    end = start
    start = addMonths(end, -step, anchorDay)
  }
  // An accrual period never starts before issue.
  if (bond.issue_date && start < bond.issue_date) start = bond.issue_date
  return { start, end }
}

/** Upcoming coupon payments per bond (and principal at maturity), after `from`. */
export function futureCashFlows(bond: BondTerms, from: string): { date: string; amount: number; isPrincipal: boolean }[] {
  const out: { date: string; amount: number; isPrincipal: boolean }[] = []
  if (bond.maturity_date <= from) return out
  const coupon = bond.coupon_freq > 0 ? (bond.face_value * bond.coupon_rate) / bond.coupon_freq : 0
  for (const d of couponSchedule(bond)) {
    if (d > from && coupon > 0) out.push({ date: d, amount: coupon, isPrincipal: false })
  }
  out.push({ date: bond.maturity_date, amount: bond.face_value, isPrincipal: true })
  return out
}

// ── Day count & accrued interest ─────────────────────────────────────────────

/** Year fraction between two dates under a day-count convention. */
export function yearFraction(
  start: string, end: string, dc: DayCount,
  period?: { start: string; end: string }, freq = 1
): number {
  if (end <= start) return 0
  switch (dc) {
    case '30E/360': {
      const a = parse(start)!, b = parse(end)!
      const d1 = Math.min(a.getUTCDate(), 30), d2 = Math.min(b.getUTCDate(), 30)
      return (360 * (b.getUTCFullYear() - a.getUTCFullYear())
        + 30 * (b.getUTCMonth() - a.getUTCMonth()) + (d2 - d1)) / 360
    }
    case 'ACT/365':
      return daysBetween(start, end) / 365
    case 'ACT/ACT':
    default: {
      // ICMA: actual days over actual days in the coupon period, per coupon.
      if (period && freq > 0) {
        const periodDays = daysBetween(period.start, period.end)
        return periodDays > 0 ? daysBetween(start, end) / periodDays / freq : 0
      }
      return daysBetween(start, end) / 365.25
    }
  }
}

/**
 * Accrued interest on ONE bond at `settle` (AÚV — alikvotní úrokový výnos).
 * Paid by the buyer on top of the clean price, so it belongs in cost basis.
 */
export function accruedInterest(bond: BondTerms, settle: string): number {
  const period = couponPeriod(bond, settle)
  if (!period || bond.coupon_rate <= 0) return 0
  const frac = yearFraction(period.start, settle, bond.day_count, period, bond.coupon_freq)
  return bond.face_value * bond.coupon_rate * frac
}

// ── Valuation ────────────────────────────────────────────────────────────────

export interface BondValuation {
  /** Clean price used, % of par. */
  cleanPct: number
  /** True when a market price was entered; false when valued at cost or par. */
  isMarketPrice: boolean
  /** How the clean price was chosen, for the UI label. */
  basis: 'market' | 'redemption' | 'cost' | 'par'
  /** Accrued interest for the whole position, bond currency. */
  accruedLocal: number
  /** Dirty value of the whole position, bond currency. */
  valueLocal: number
  /** Cost of the whole position (clean price paid × par), bond currency. */
  costLocal: number
}

export function valueBond(bond: BondHolding, settle: string): BondValuation {
  const matured = bond.maturity_date <= settle
  let cleanPct: number
  let basis: BondValuation['basis']
  if (matured) {
    cleanPct = 100; basis = 'par'
  } else if (bond.clean_price_pct != null && isFinite(bond.clean_price_pct) && bond.clean_price_pct > 0) {
    cleanPct = bond.clean_price_pct; basis = 'market'
  } else if (bond.redeemable_early) {
    // A savings bond is worth what the state would pay back today.
    cleanPct = 100; basis = 'redemption'
  } else if (bond.purchase_clean_price_pct != null && bond.purchase_clean_price_pct > 0) {
    cleanPct = bond.purchase_clean_price_pct; basis = 'cost'
  } else {
    cleanPct = 100; basis = 'par'
  }
  const accruedPer = matured ? 0 : accruedInterest(bond, settle)
  const principal = bond.face_value * bond.quantity
  const paidPct = bond.purchase_clean_price_pct ?? 100
  return {
    cleanPct,
    isMarketPrice: basis === 'market',
    basis,
    accruedLocal: accruedPer * bond.quantity,
    valueLocal: principal * cleanPct / 100 + accruedPer * bond.quantity,
    costLocal: principal * paidPct / 100,
  }
}

/** Annual coupon income for the whole position, bond currency, gross. */
export const annualCouponLocal = (bond: Pick<BondHolding, 'face_value' | 'quantity' | 'coupon_rate' | 'coupon_freq' | 'maturity_date'>, today: string): number =>
  bond.maturity_date <= today || bond.coupon_freq === 0 ? 0 : bond.face_value * bond.quantity * bond.coupon_rate

// ── Yield & risk ─────────────────────────────────────────────────────────────

/** Dirty price per bond implied by yield `y` (annual, compounded `freq` times). */
function priceFromYield(flows: { t: number; amount: number }[], y: number, freq: number): number {
  const f = freq > 0 ? freq : 1
  return flows.reduce((s, cf) => s + cf.amount / Math.pow(1 + y / f, f * cf.t), 0)
}

const flowsInYears = (bond: BondTerms, settle: string) =>
  futureCashFlows(bond, settle).map(cf => ({ t: daysBetween(settle, cf.date) / 365, amount: cf.amount }))

/**
 * Yield to maturity for a clean price (% of par), compounded at the coupon
 * frequency. Newton with a bisection fallback; null on non-convergence or for a
 * matured bond.
 */
export function yieldToMaturity(bond: BondTerms, cleanPct: number, settle: string): number | null {
  if (!(cleanPct > 0) || bond.maturity_date <= settle) return null
  const flows = flowsInYears(bond, settle)
  if (flows.length === 0) return null
  const target = bond.face_value * cleanPct / 100 + accruedInterest(bond, settle)
  const f = bond.coupon_freq > 0 ? bond.coupon_freq : 1
  const g = (y: number) => priceFromYield(flows, y, f) - target

  let y = bond.coupon_rate > 0 ? bond.coupon_rate : 0.03
  for (let i = 0; i < 50; i++) {
    const v = g(y)
    const h = 1e-6
    const d = (g(y + h) - v) / h
    if (!isFinite(v) || !isFinite(d) || d === 0) break
    const next = y - v / d
    if (!isFinite(next) || next <= -f + 1e-6) break
    if (Math.abs(next - y) < 1e-10) return next
    y = next
  }
  let lo = -0.5, hi = 1
  let gLo = g(lo), gHi = g(hi)
  if (!isFinite(gLo) || !isFinite(gHi) || gLo * gHi > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const gm = g(mid)
    if (Math.abs(gm) < 1e-9 || hi - lo < 1e-12) return mid
    if (gLo * gm < 0) { hi = mid; gHi = gm } else { lo = mid; gLo = gm }
  }
  return (lo + hi) / 2
}

export interface BondRisk {
  /** Macaulay duration, years. */
  macaulay: number
  /** Modified duration: % price change per 1.00 (100 %) yield change. */
  modified: number
  convexity: number
}

export function bondRisk(bond: BondTerms, ytm: number, settle: string): BondRisk | null {
  const flows = flowsInYears(bond, settle)
  if (flows.length === 0 || !isFinite(ytm)) return null
  const f = bond.coupon_freq > 0 ? bond.coupon_freq : 1
  const disc = (t: number) => Math.pow(1 + ytm / f, f * t)
  const price = flows.reduce((s, cf) => s + cf.amount / disc(cf.t), 0)
  if (!(price > 0)) return null
  const macaulay = flows.reduce((s, cf) => s + cf.t * cf.amount / disc(cf.t), 0) / price
  const modified = macaulay / (1 + ytm / f)
  const convexity = flows.reduce(
    (s, cf) => s + cf.amount * cf.t * (cf.t + 1 / f) / disc(cf.t), 0
  ) / (price * Math.pow(1 + ytm / f, 2))
  return { macaulay, modified, convexity }
}

/**
 * Approximate fractional price change for a parallel yield shift `dy`
 * (0.02 = +200 bp): ΔP/P ≈ −D_mod·Δy + ½·C·Δy².
 */
export function priceChangeForShift(risk: BondRisk, dy: number): number {
  return -risk.modified * dy + 0.5 * risk.convexity * dy * dy
}

/** Liquidity tier for a bond: redeemable savings bonds are near-cash; others by time to maturity. */
export function bondLiquidity(bond: Pick<BondHolding, 'redeemable_early' | 'maturity_date' | 'issuer_type'>, today: string):
  'instant' | 'week' | 'month' | 'year' | 'illiquid' {
  if (bond.redeemable_early) return 'month'
  const days = daysBetween(today, bond.maturity_date)
  if (days <= 31) return 'week'
  // Listed government bonds sell within days; corporates and municipals can take longer.
  return bond.issuer_type === 'government' ? 'week' : 'month'
}
