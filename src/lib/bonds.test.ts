import { describe, it, expect } from 'vitest'
import {
  addMonths, couponSchedule, couponPeriod, accruedInterest, yearFraction,
  valueBond, yieldToMaturity, bondRisk, priceChangeForShift, futureCashFlows, annualCouponLocal,
} from './bonds'
import type { BondHolding } from './supabase'

const bond = (p: Partial<BondHolding> = {}): BondHolding => ({
  id: 'b1', profile_id: 'p1', isin: 'CZ0001', name: 'CZGB 4.5 2030',
  issuer_type: 'government', currency: 'CZK',
  face_value: 10_000, quantity: 10, coupon_rate: 0.045, coupon_freq: 1,
  coupon_type: 'fixed', day_count: 'ACT/365',
  issue_date: '2020-06-15', maturity_date: '2030-06-15',
  purchase_date: '2024-01-10', purchase_clean_price_pct: 98, purchase_fx_czk: 1,
  clean_price_pct: null, price_date: null, redeemable_early: false,
  liquidity_tier: null, notes: null, is_active: true, created_at: '', updated_at: '',
  ...p,
})

describe('addMonths', () => {
  it('pins to month end when the anchor day does not exist', () => {
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29')
    expect(addMonths('2023-03-31', -1)).toBe('2023-02-28')
    expect(addMonths('2024-02-29', 1, 31)).toBe('2024-03-31')
  })
})

describe('couponSchedule', () => {
  it('runs backwards from maturity to issue', () => {
    const s = couponSchedule(bond())
    expect(s[0]).toBe('2021-06-15')
    expect(s[s.length - 1]).toBe('2030-06-15')
    expect(s).toHaveLength(10)
  })
  it('handles semi-annual coupons', () => {
    const s = couponSchedule(bond({ coupon_freq: 2 }))
    expect(s.slice(0, 2)).toEqual(['2020-12-15', '2021-06-15'])
  })
  it('is empty for a zero-coupon bond', () => {
    expect(couponSchedule(bond({ coupon_freq: 0 }))).toEqual([])
  })
})

describe('accruedInterest', () => {
  it('accrues ACT/365 from the last coupon', () => {
    // 146 days after 15 Jun 2025 → 8 Nov 2025. 10 000 × 4.5 % × 146/365 = 180.
    expect(couponPeriod(bond(), '2025-11-08')).toEqual({ start: '2025-06-15', end: '2026-06-15' })
    expect(accruedInterest(bond(), '2025-11-08')).toBeCloseTo(180, 9)
  })
  it('is zero on a coupon date', () => {
    expect(accruedInterest(bond(), '2025-06-15')).toBeCloseTo(0, 9)
  })
  it('uses ICMA actual/actual per period', () => {
    const b = bond({ day_count: 'ACT/ACT', coupon_freq: 2 })
    // Half-way through a 183-day period → half a semi-annual coupon (225 / 2).
    const period = couponPeriod(b, '2025-09-14')!
    const frac = yearFraction(period.start, '2025-09-14', 'ACT/ACT', period, 2)
    expect(accruedInterest(b, '2025-09-14')).toBeCloseTo(10_000 * 0.045 * frac, 9)
  })
  it('counts 30E/360 in 30-day months', () => {
    expect(yearFraction('2025-01-31', '2025-03-31', '30E/360')).toBeCloseTo(60 / 360, 12)
  })
})

describe('valueBond', () => {
  it('uses the market price when one is entered, plus accrued', () => {
    const v = valueBond(bond({ clean_price_pct: 101 }), '2025-11-08')
    expect(v.basis).toBe('market')
    expect(v.valueLocal).toBeCloseTo(10 * (10_000 * 1.01 + 180), 6)
    expect(v.costLocal).toBeCloseTo(10 * 10_000 * 0.98, 6)
  })
  it('falls back to cost, and says so', () => {
    const v = valueBond(bond(), '2025-11-08')
    expect(v.basis).toBe('cost')
    expect(v.isMarketPrice).toBe(false)
  })
  it('values a redeemable savings bond at par', () => {
    expect(valueBond(bond({ redeemable_early: true }), '2025-11-08').cleanPct).toBe(100)
  })
  it('values a matured bond at par with no accrual', () => {
    const v = valueBond(bond({ clean_price_pct: 90 }), '2031-01-01')
    expect(v.valueLocal).toBe(100_000)
  })
})

describe('yieldToMaturity', () => {
  it('equals the coupon for a bond priced at par on a coupon date', () => {
    const y = yieldToMaturity(bond(), 100, '2025-06-15')!
    expect(y).toBeCloseTo(0.045, 3)
  })
  it('is above the coupon when bought below par', () => {
    expect(yieldToMaturity(bond(), 95, '2025-06-15')!).toBeGreaterThan(0.045)
  })
  it('is null for a matured bond', () => {
    expect(yieldToMaturity(bond(), 100, '2031-01-01')).toBeNull()
  })
})

describe('bondRisk', () => {
  it('gives a zero-coupon Macaulay duration equal to its maturity', () => {
    const z = bond({ coupon_freq: 0, coupon_rate: 0, maturity_date: '2030-06-15' })
    const r = bondRisk(z, 0.04, '2025-06-15')!
    expect(r.macaulay).toBeCloseTo(daysYears('2025-06-15', '2030-06-15'), 6)
  })
  it('makes prices fall when yields rise', () => {
    const r = bondRisk(bond(), 0.045, '2025-06-15')!
    expect(r.modified).toBeGreaterThan(3)
    expect(priceChangeForShift(r, 0.02)).toBeLessThan(0)
    // Convexity: a fall is smaller than the matching rise.
    expect(Math.abs(priceChangeForShift(r, 0.02))).toBeLessThan(priceChangeForShift(r, -0.02))
  })
})

describe('cash flows & income', () => {
  it('lists remaining coupons and principal', () => {
    const cfs = futureCashFlows(bond(), '2029-01-01')
    expect(cfs.map(c => c.date)).toEqual(['2029-06-15', '2030-06-15', '2030-06-15'])
    expect(cfs[cfs.length - 1].isPrincipal).toBe(true)
  })
  it('stops paying income after maturity', () => {
    expect(annualCouponLocal(bond(), '2025-01-01')).toBe(4_500)
    expect(annualCouponLocal(bond(), '2031-01-01')).toBe(0)
  })
})

function daysYears(a: string, b: string) {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000 / 365
}
