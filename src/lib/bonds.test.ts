import { describe, it, expect } from 'vitest'
import {
  addMonths, couponPeriod, remainingCouponDates, accrualFraction,
  valueBond, bondTotals, solveYTM, durationAt, shockedValue, accruedInterestOn,
  upcomingCoupons, bondNominal, parseISO, toISO,
} from './bonds'
import type { Bond } from './supabase'

/** A real French OAT: 3.00%, redeemed 25 May 2054, annual coupon, ACT/ACT. */
const OAT: Bond = {
  id: 'oat', profile_id: 'p',
  name: 'OAT 3.00% 25/05/2054',
  issuer: 'République Française (AFT)',
  isin: 'FR001400UKX0',
  bond_type: 'government',
  country: 'FR',
  currency: 'EUR',
  face_value: 1,
  quantity: 10_000,
  purchase_price_pct: 92.5,
  current_price_pct: 95.0,
  coupon_rate: 0.03,
  coupons_per_year: 1,
  day_count: 'ACT/ACT',
  issue_date: '2023-05-25',
  maturity_date: '2054-05-25',
  purchase_date: '2025-09-15',
  accrued_at_purchase: 92.05,
  withholding_tax_pct: 0,
  is_inflation_linked: false,
  index_ratio: 1,
  liquidity_tier: null,
  notes: null,
  is_active: true,
  created_at: '', updated_at: '',
}

const at = (iso: string) => parseISO(iso)!

describe('addMonths', () => {
  it('clamps to the end of a shorter month', () => {
    expect(toISO(addMonths(at('2025-08-31'), 1))).toBe('2025-09-30')
    expect(toISO(addMonths(at('2025-01-31'), 1))).toBe('2025-02-28')
    expect(toISO(addMonths(at('2024-01-31'), 1))).toBe('2024-02-29')
  })

  it('goes backwards without drifting', () => {
    expect(toISO(addMonths(at('2054-05-25'), -12))).toBe('2053-05-25')
    expect(toISO(addMonths(at('2054-05-25'), -6))).toBe('2053-11-25')
  })
})

describe('couponPeriod', () => {
  it('brackets the valuation date with coupon anniversaries of maturity', () => {
    const p = couponPeriod(OAT, at('2026-01-15'))!
    expect(toISO(p.previous)).toBe('2025-05-25')
    expect(toISO(p.next)).toBe('2026-05-25')
  })

  it('handles a date sitting exactly on a coupon date', () => {
    const p = couponPeriod(OAT, at('2026-05-25'))!
    expect(toISO(p.previous)).toBe('2026-05-25')
    expect(toISO(p.next)).toBe('2027-05-25')
  })

  it('splits semi-annual bonds into six-month periods', () => {
    const semi = { ...OAT, coupons_per_year: 2 }
    const p = couponPeriod(semi, at('2026-01-15'))!
    expect(toISO(p.previous)).toBe('2025-11-25')
    expect(toISO(p.next)).toBe('2026-05-25')
  })
})

describe('remainingCouponDates', () => {
  it('lists one payment per year up to and including maturity', () => {
    const dates = remainingCouponDates(OAT, at('2053-06-01'))
    expect(dates.map(toISO)).toEqual(['2054-05-25'])
  })

  it('is empty once the bond has matured', () => {
    expect(remainingCouponDates(OAT, at('2054-05-26'))).toEqual([])
  })

  it('counts every remaining annual coupon', () => {
    // 2026-05-25 through 2054-05-25 inclusive = 29 payments.
    expect(remainingCouponDates(OAT, at('2026-01-15')).length).toBe(29)
  })
})

describe('accrualFraction', () => {
  it('is zero on the coupon date itself', () => {
    expect(accrualFraction(OAT, at('2026-05-25'))).toBe(0)
  })

  it('grows linearly through the period under ACT/ACT', () => {
    // 2025-05-25 → 2026-05-25 is 365 days; 2025-11-25 is day 184.
    expect(accrualFraction(OAT, at('2025-11-25'))).toBeCloseTo(184 / 365, 9)
  })

  it('never exceeds one period', () => {
    expect(accrualFraction(OAT, at('2026-05-24'))).toBeLessThanOrEqual(1)
    expect(accrualFraction(OAT, at('2026-05-24'))).toBeGreaterThan(0.99)
  })

  it('uses 30/360 when the bond says so', () => {
    const b = { ...OAT, day_count: '30/360' as const }
    // Half a 360-day year from 25 May to 25 Nov.
    expect(accrualFraction(b, at('2025-11-25'))).toBeCloseTo(0.5, 9)
  })
})

describe('valueBond', () => {
  it('values the position off nominal and a percent-of-par price', () => {
    const v = valueBond(OAT, at('2026-01-15'))
    expect(v.nominal).toBe(10_000)
    // 95% of 10 000 nominal — not 95 x 10 000.
    expect(v.cleanValue).toBeCloseTo(9_500, 6)
    expect(v.hasMarketPrice).toBe(true)
  })

  it('adds accrued interest to reach the settlement value', () => {
    const v = valueBond(OAT, at('2025-11-25'))
    // One annual coupon = 300 EUR; 184/365 of it has accrued.
    expect(v.accruedInterest).toBeCloseTo(300 * (184 / 365), 6)
    expect(v.dirtyValue).toBeCloseTo(v.cleanValue + v.accruedInterest, 9)
  })

  it('counts the coupon couru paid at purchase as part of cost', () => {
    const v = valueBond(OAT, at('2026-01-15'))
    expect(v.costValue).toBeCloseTo(9_250 + 92.05, 6)
  })

  it('separates the capital loss from the coupon accrued since purchase', () => {
    // The real case that prompted this: bought at 102.3, now marked 101.12, and
    // yet the position showed a gain — because 117 days of a 4.5% coupon had
    // accrued and was being folded into one P&L number.
    const oat41: Bond = {
      ...OAT,
      name: "GOVT 4.5 Apr25'41",
      quantity: 4_000, face_value: 1,
      coupon_rate: 0.045, coupons_per_year: 1,
      maturity_date: '2041-04-25',
      purchase_price_pct: 102.3,
      current_price_pct: 101.12,
      purchase_date: '2026-08-11',
      accrued_at_purchase: 0,
    }
    const v = valueBond(oat41, at('2026-08-20'))

    expect(v.cleanValue).toBeCloseTo(4_044.80, 6)
    expect(v.cleanCostValue).toBeCloseTo(4_092.00, 6)
    expect(v.pricePL).toBeCloseTo(-47.20, 6)
    expect(v.accruedInterest).toBeCloseTo(180 * (117 / 365), 6)
    expect(v.incomePL).toBeCloseTo(v.accruedInterest, 6)
    // The two halves always reconstruct the headline figure.
    expect(v.plValue).toBeCloseTo(v.pricePL + v.incomePL, 9)
    expect(v.plValue).toBeCloseTo(10.50, 2)
  })

  it('flags a cost basis missing its coupon couru', () => {
    const v = valueBond({
      ...OAT,
      coupon_rate: 0.045, quantity: 4_000, face_value: 1,
      maturity_date: '2041-04-25',
      purchase_date: '2026-08-11',
      accrued_at_purchase: 0,
    }, at('2026-08-20'))

    // 108 days of a 180/yr coupon had accrued when the position was bought.
    expect(v.unrecordedAccruedAtPurchase).toBeCloseTo(180 * (108 / 365), 6)
  })

  it('does not flag a bond genuinely bought on its coupon date', () => {
    const v = valueBond({
      ...OAT,
      maturity_date: '2041-04-25',
      purchase_date: '2026-04-25',
      accrued_at_purchase: 0,
    }, at('2026-08-20'))
    expect(v.unrecordedAccruedAtPurchase).toBeNull()
  })

  it('does not flag a bond whose coupon couru was recorded', () => {
    const v = valueBond({
      ...OAT,
      maturity_date: '2041-04-25',
      purchase_date: '2026-08-11',
      accrued_at_purchase: 53.26,
    }, at('2026-08-20'))
    expect(v.unrecordedAccruedAtPurchase).toBeNull()
  })

  it('nets the coupon couru paid out of income earned', () => {
    const withCouru = valueBond({
      ...OAT,
      coupon_rate: 0.045, quantity: 4_000, face_value: 1,
      maturity_date: '2041-04-25',
      purchase_price_pct: 102.3, current_price_pct: 101.12,
      purchase_date: '2026-08-11',
      accrued_at_purchase: 53.26,
    }, at('2026-08-20'))

    // Nine days of interest earned, not four months of it.
    expect(withCouru.incomePL).toBeCloseTo(180 * (117 / 365) - 53.26, 6)
    expect(withCouru.plValue).toBeLessThan(0)
  })

  it('falls back to cost when no market price has been entered', () => {
    const v = valueBond({ ...OAT, current_price_pct: null }, at('2026-01-15'))
    expect(v.hasMarketPrice).toBe(false)
    expect(v.cleanValue).toBeCloseTo(9_250, 6)
    // Cost basis and mark agree, so the clean P&L is only the accrued coupon.
    expect(v.plValue).toBeCloseTo(v.accruedInterest - 92.05, 6)
  })

  it('redeems at par once matured, whatever the last quoted price', () => {
    const v = valueBond({ ...OAT, current_price_pct: 80 }, at('2054-06-01'))
    expect(v.isMatured).toBe(true)
    expect(v.cleanValue).toBeCloseTo(10_000, 6)
    expect(v.accruedInterest).toBe(0)
    expect(v.annualCouponGross).toBe(0)
    expect(v.ytm).toBeNull()
  })

  it('scales nominal and coupons by the indexation ratio for an OATi', () => {
    const oati = { ...OAT, is_inflation_linked: true, index_ratio: 1.2 }
    expect(bondNominal(oati)).toBeCloseTo(12_000, 6)
    const v = valueBond(oati, at('2026-01-15'))
    expect(v.annualCouponGross).toBeCloseTo(12_000 * 0.03, 6)
  })

  it('reports coupons net of withholding', () => {
    const taxed = { ...OAT, withholding_tax_pct: 0.3 }
    const v = valueBond(taxed, at('2026-01-15'))
    expect(v.annualCouponGross).toBeCloseTo(300, 6)
    expect(v.annualCouponNet).toBeCloseTo(210, 6)
  })

  it('prices a discount bond above its coupon rate', () => {
    const v = valueBond(OAT, at('2026-01-15'))
    // Bought below par, so yield to maturity exceeds the 3% coupon.
    expect(v.ytm).not.toBeNull()
    expect(v.ytm!).toBeGreaterThan(0.03)
    expect(v.ytm!).toBeLessThan(0.05)
  })

  it('gives a long bond a long duration', () => {
    const v = valueBond(OAT, at('2026-01-15'))
    expect(v.modifiedDuration).not.toBeNull()
    // ~28 years to run at a ~3.3% yield: high teens.
    expect(v.modifiedDuration!).toBeGreaterThan(14)
    expect(v.modifiedDuration!).toBeLessThan(22)
  })
})

describe('solveYTM', () => {
  it('returns the coupon rate for a bond priced exactly at par', () => {
    // 10 annual coupons of 5 on 100 nominal, priced at 100 on a coupon date.
    const y = solveYTM(100, 100, 5, 1, 10, 0)
    expect(y).not.toBeNull()
    expect(y!).toBeCloseTo(0.05, 8)
  })

  it('round-trips: the solved yield reprices the bond', () => {
    const y = solveYTM(92.5, 100, 3, 1, 28, 0.4)!
    const duration = durationAt(y, 100, 3, 1, 28, 0.4)
    expect(duration).not.toBeNull()
    expect(duration!).toBeGreaterThan(0)
  })

  it('solves a zero-coupon bond', () => {
    // 100 due in 10 years, bought at 55.84 → ~6%.
    const y = solveYTM(55.839478, 100, 0, 1, 10, 0)
    expect(y!).toBeCloseTo(0.06, 5)
  })

  it('handles a negative yield, which European govvies have genuinely traded at', () => {
    const y = solveYTM(105, 100, 0, 1, 5, 0)
    expect(y).not.toBeNull()
    expect(y!).toBeLessThan(0)
  })

  it('returns null rather than a fabricated number when there is nothing to solve', () => {
    expect(solveYTM(0, 100, 3, 1, 10, 0)).toBeNull()
    expect(solveYTM(100, 100, 3, 1, 0, 0)).toBeNull()
  })
})

describe('shockedValue', () => {
  it('falls by roughly duration x the shift', () => {
    const v = valueBond(OAT, at('2026-01-15'))
    const after = shockedValue(v, 100) // +100bp
    const expected = v.dirtyValue * (1 - v.modifiedDuration! * 0.01)
    expect(after).toBeCloseTo(expected, 6)
    expect(after).toBeLessThan(v.dirtyValue)
  })

  it('rises when yields fall', () => {
    const v = valueBond(OAT, at('2026-01-15'))
    expect(shockedValue(v, -100)).toBeGreaterThan(v.dirtyValue)
  })

  it('never goes negative on an extreme shift', () => {
    const v = valueBond(OAT, at('2026-01-15'))
    expect(shockedValue(v, 100_000)).toBe(0)
  })
})

describe('bondTotals', () => {
  const short: Bond = {
    ...OAT, id: 'short', name: 'OAT 0.75% 25/05/2028',
    coupon_rate: 0.0075, maturity_date: '2028-05-25',
    quantity: 5_000, purchase_price_pct: 97, current_price_pct: 98,
    accrued_at_purchase: 0,
  }

  it('weights duration by value, not by line count', () => {
    const asOf = at('2026-01-15')
    const long = valueBond(OAT, asOf)
    const brief = valueBond(short, asOf)
    const t = bondTotals([long, brief])

    const flatMean = (long.modifiedDuration! + brief.modifiedDuration!) / 2
    // The long line is ~2x the money, so the book sits above a flat mean.
    expect(t.averageDuration!).toBeGreaterThan(flatMean)
    expect(t.averageDuration!).toBeLessThan(long.modifiedDuration!)
  })

  it('sums money figures across the book', () => {
    const asOf = at('2026-01-15')
    const vals = [valueBond(OAT, asOf), valueBond(short, asOf)]
    const t = bondTotals(vals)
    expect(t.dirtyValue).toBeCloseTo(vals[0].dirtyValue + vals[1].dirtyValue, 6)
    expect(t.annualCouponGross).toBeCloseTo(300 + 37.5, 6)
    expect(t.count).toBe(2)
    expect(t.maturedCount).toBe(0)
  })

  it('splits the book P&L into price and income', () => {
    const asOf = at('2026-01-15')
    const vals = [valueBond(OAT, asOf), valueBond(short, asOf)]
    const t = bondTotals(vals)
    expect(t.plValue).toBeCloseTo(t.pricePL + t.incomePL, 6)
  })

  it('is all zeros for an empty book rather than NaN', () => {
    const t = bondTotals([])
    expect(t.dirtyValue).toBe(0)
    expect(t.plPct).toBe(0)
    expect(t.averageDuration).toBeNull()
    expect(t.averageYTM).toBeNull()
  })
})

describe('upcomingCoupons', () => {
  it('lists the next year of payments in date order', () => {
    const semi = { ...OAT, id: 'semi', coupons_per_year: 2 }
    const rows = upcomingCoupons([OAT, semi], 12, at('2026-01-15'))
    expect(rows.length).toBeGreaterThan(0)
    const dates = rows.map(r => r.date)
    expect([...dates].sort()).toEqual(dates)
    expect(rows.every(r => r.date > '2026-01-15' && r.date <= '2027-01-15')).toBe(true)
  })

  it('reports each payment net of withholding', () => {
    const taxed = { ...OAT, withholding_tax_pct: 0.25 }
    const [next] = upcomingCoupons([taxed], 12, at('2026-01-15'))
    expect(next.grossAmount).toBeCloseTo(300, 6)
    expect(next.netAmount).toBeCloseTo(225, 6)
  })

  it('skips matured bonds', () => {
    expect(upcomingCoupons([OAT], 12, at('2054-06-01'))).toEqual([])
  })
})

describe('accruedInterestOn', () => {
  it('gives the coupon couru at an arbitrary settlement date', () => {
    // 184 days into a 365-day period on a 300/yr coupon.
    expect(accruedInterestOn(OAT, at('2025-11-25'))).toBeCloseTo(300 * (184 / 365), 6)
  })

  it('is zero on a coupon date and after maturity', () => {
    expect(accruedInterestOn(OAT, at('2026-05-25'))).toBe(0)
    expect(accruedInterestOn(OAT, at('2054-06-01'))).toBe(0)
  })
})
