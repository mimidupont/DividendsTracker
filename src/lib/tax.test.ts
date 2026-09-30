import { describe, it, expect } from 'vitest'
import { whtRateFor } from './tax'
import { computeProjectedTotal } from './projections'

describe('whtRateFor', () => {
  it('uses the issuer country', () => {
    expect(whtRateFor({ country: 'CH' }).rate).toBe(0.35)
    expect(whtRateFor({ country: 'ie' }).rate).toBe(0)
  })
  it('falls back to region, then the US treaty rate', () => {
    expect(whtRateFor({ region: 'CZ' })).toEqual({ rate: 0.15, basis: 'region' })
    expect(whtRateFor(undefined)).toEqual({ rate: 0.15, basis: 'default' })
  })
})

describe('computeProjectedTotal', () => {
  const proj = { symbol: 'KO', projected_div_per_share: 2, projected_total: 500 } as never
  it('is zero for a symbol no longer held', () => {
    expect(computeProjectedTotal(proj, [])).toBe(0)
  })
  it('uses current shares when held', () => {
    expect(computeProjectedTotal(proj, [{ symbol: 'KO', shares: 10 } as never])).toBe(20)
  })
})

import { sharesAsOf } from './dividends'

describe('sharesAsOf', () => {
  it('excludes shares bought after the ex-date', () => {
    const r = sharesAsOf({ shares: 150 }, [
      { shares: 100, purchase_date: '2025-01-01' },
      { shares: 50, purchase_date: '2026-05-10' },
    ], '2026-05-01')
    expect(r).toEqual({ atDate: 100, after: 50 })
  })
})

import { paymentCZK } from './dividends'

describe('paymentCZK', () => {
  it('uses the payment-date rate when recorded', () => {
    expect(paymentCZK({ gross_amount: 100, withholding_tax: 15, currency: 'USD', fx_rate_czk: 24.3 }, { USD: 20.65 }))
      .toEqual({ czk: 85 * 24.3, frozen: true })
    expect(paymentCZK({ gross_amount: 100, currency: 'USD', fx_rate_czk: 24.3 }, { USD: 20.65 }, 'gross').czk).toBeCloseTo(2430, 9)
  })
  it('falls back to today and says so', () => {
    expect(paymentCZK({ gross_amount: 100, currency: 'USD' }, { USD: 20 }).frozen).toBe(false)
  })
})

import { czechTaxView } from './tax'
import type { Transaction } from './supabase'

describe('czechTaxView', () => {
  const t = (p: Partial<Transaction>): Transaction => ({
    id: Math.random().toString(), profile_id: 'p', created_at: '', asset_class: 'stock', symbol: 'AAPL',
    quantity: null, price: null, amount: 0, fee: 0, tax: 0, currency: 'USD', fx_rate_czk: 20, amount_czk: NaN,
    is_external: false, asset_id: null, counterparty_account_id: null, notes: null, txn_date: '2020-01-01', type: 'buy', ...p,
  })
  it('separates time-tested gains and applies the 100 000 CZK proceeds test', () => {
    const v = czechTaxView([
      t({ type: 'buy', txn_date: '2020-01-01', quantity: 10, amount: -1000 }),
      t({ type: 'buy', txn_date: '2025-06-01', quantity: 10, amount: -1500 }),
      t({ type: 'sell', txn_date: '2026-03-01', quantity: 15, amount: 3000 }),
    ], 2026)
    expect(v).toHaveLength(1)
    expect(v[0].proceedsCZK).toBe(60_000)
    expect(v[0].underProceedsLimit).toBe(true)
    expect(v[0].timeTestedGainCZK).toBeCloseTo(10 * 200 * 20 - 10 * 100 * 20, 6)
    expect(v[0].otherGainCZK).toBeCloseTo(5 * 200 * 20 - 5 * 150 * 20, 6)
  })
})
