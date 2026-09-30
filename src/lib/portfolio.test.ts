import { describe, it, expect } from 'vitest'
import {
  positionMetrics, portfolioTotals, buildPositions, netWorthCZK, investableNetWorthCZK,
  investableByClass, cashTier, totalsByClass, investedCostAndValue, holdingAssetClass,
  type QuoteSource,
} from './portfolio'
import { currencyExposure } from './exposure'
import { snapshotBlockers, snapshotValues } from './snapshot'
import type { Holding, BankAccount, RealEstate, CryptoHolding, BondHolding } from './supabase'

const fx = { CZK: 1, USD: 20.65, EUR: 25, GBP: 27.5 }
const TODAY = '2026-09-30'

const holding = (p: Partial<Holding> = {}): Holding => ({
  id: 'h1', symbol: 'AAPL', name: 'Apple', shares: 100, avg_price: 150, currency: 'USD',
  exchange: null, purchase_date: null, is_dividend_payer: true,
  created_at: '', updated_at: '', ...p,
})

const quotes = (q: Record<string, { price: number; currency: string }>): QuoteSource => ({
  getPrice: (s, f) => q[s]?.price ?? f,
  getQuoteCurrency: (s, f) => q[s]?.currency ?? f,
  getAnnualDiv: () => null,
  hasPrice: s => (q[s]?.price ?? 0) > 0,
  quotes: {},
})
const noCrypto = { getPrice: (_: string, f: number) => f, hasPrice: () => false }

const account = (p: Partial<BankAccount> = {}): BankAccount => ({
  id: 'a1', name: 'Spořicí', institution: 'Fio', account_type: 'savings', balance: 100_000,
  currency: 'CZK', interest_rate: 0.04, interest_type: 'annual', maturity_date: null,
  notes: null, is_active: true, liquidity_tier: null, created_at: '', updated_at: '', ...p,
})

const property = (p: Partial<RealEstate> = {}): RealEstate => ({
  id: 'r1', name: 'Byt', property_type: 'residential', address: null,
  purchase_price: 8_000_000, current_value: 10_000_000, currency: 'CZK', purchase_date: null,
  monthly_rent: 0, mortgage_balance: 4_000_000, mortgage_rate: 0.05, monthly_mortgage: 0,
  ownership_pct: 50, notes: null, is_primary_residence: false, liquidity_tier: null,
  created_at: '', updated_at: '', ...p,
})

const empty = { holdings: [], bankAccounts: [], cryptoHoldings: [], realEstate: [] }

describe('positionMetrics', () => {
  it('folds a pence quote into pounds exactly once', () => {
    const m = positionMetrics(holding({ symbol: 'ULVR', shares: 10, currency: 'GBP', avg_price: 20 }),
      quotes({ ULVR: { price: 2450, currency: 'GBp' } }), fx)
    expect(m.marketCZK).toBeCloseTo(6737.5, 6)
  })

  it('values a symbol with no quote at cost and says so', () => {
    const m = positionMetrics(holding(), quotes({}), fx)
    expect(m.isLivePrice).toBe(false)
    expect(m.marketCZK).toBeCloseTo(m.costCZK, 6)
  })

  it('uses the frozen purchase rate for cost, exposing the currency loss', () => {
    // $150 bought at 23.50 CZK/USD; still $150, but USD now 20.65.
    const m = positionMetrics(holding({ avg_fx_czk: 23.5 }),
      quotes({ AAPL: { price: 150, currency: 'USD' } }), fx)
    expect(m.costCZK).toBeCloseTo(352_500, 6)
    expect(m.plCZK).toBeCloseTo(-42_750, 6)
    expect(m.fxPLCZK).toBeCloseTo(-42_750, 6)
    expect(m.costFxFrozen).toBe(true)
  })

  it('falls back to today\'s rate and flags it when the purchase rate is unknown', () => {
    const m = positionMetrics(holding(), quotes({ AAPL: { price: 150, currency: 'USD' } }), fx)
    expect(m.plCZK).toBeCloseTo(0, 6)
    expect(m.costFxFrozen).toBe(false)
    expect(m.fxPLCZK).toBeNull()
    expect(portfolioTotals([m]).costFxUnknown).toEqual(['AAPL'])
  })

  it('reports no percentage for a zero-cost position', () => {
    const m = positionMetrics(holding({ avg_price: 0 }), quotes({ AAPL: { price: 10, currency: 'USD' } }), fx)
    expect(m.plPct).toBeNull()
    expect(portfolioTotals([m]).plPct).toBeNull()
  })
})

describe('buildPositions', () => {
  it('splits property into asset and mortgage at the ownership share', () => {
    const ps = buildPositions({ ...empty, realEstate: [property()] }, fx, quotes({}), noCrypto, TODAY)
    expect(ps.map(p => p.valueCZK)).toEqual([5_000_000, -2_000_000])
    expect(netWorthCZK(ps)).toBe(3_000_000)
  })

  it('drops a primary residence and its mortgage together from investable net worth', () => {
    const ps = buildPositions({ ...empty, realEstate: [property({ is_primary_residence: true })] },
      fx, quotes({}), noCrypto, TODAY)
    expect(investableNetWorthCZK(ps)).toBe(0)
    expect(investableNetWorthCZK(ps, { includePrimaryResidence: true })).toBe(3_000_000)
  })

  it('gives Monte Carlo property gross with the debt separate', () => {
    const ps = buildPositions({
      ...empty,
      bankAccounts: [account({ balance: 2_000_000 })],
      realEstate: [property({ ownership_pct: 100, current_value: 5_000_000, mortgage_balance: 3_000_000, is_primary_residence: true })],
    }, fx, quotes({}), noCrypto, TODAY)
    expect(investableByClass(ps).byClass.realestate).toBe(0)
    expect(investableByClass(ps).byClass.cash).toBe(2_000_000)
    const incl = investableByClass(ps, { includePrimaryResidence: true })
    expect(incl.byClass.realestate).toBe(5_000_000)
    expect(incl.debtCZK).toBe(3_000_000)
  })

  it('classifies a tagged bond ETF as fixed income', () => {
    expect(holdingAssetClass({ asset_type: 'bond_etf' } as never)).toBe('bond')
    expect(holdingAssetClass({ sector: 'ETF' } as never)).toBe('etf')
    expect(holdingAssetClass(undefined)).toBe('stock')
  })

  it('values a directly held bond with accrued interest', () => {
    const bond: BondHolding = {
      id: 'b1', profile_id: 'p', isin: 'CZ0001', name: 'CZGB', issuer_type: 'government',
      currency: 'CZK', face_value: 10_000, quantity: 10, coupon_rate: 0.045, coupon_freq: 1,
      coupon_type: 'fixed', day_count: 'ACT/365', issue_date: '2020-06-15', maturity_date: '2030-06-15',
      purchase_date: null, purchase_clean_price_pct: 98, purchase_fx_czk: 1, clean_price_pct: 101,
      price_date: null, redeemable_early: false, liquidity_tier: null, notes: null, is_active: true,
      created_at: '', updated_at: '',
    }
    const [p] = buildPositions({ ...empty, bondHoldings: [bond] }, fx, quotes({}), noCrypto, '2025-11-08')
    expect(p.assetClass).toBe('bond')
    expect(p.valueCZK).toBeCloseTo(10 * (10_100 + 180), 6)
    expect(p.annualIncomeCZK).toBe(4_500)
    expect(p.duration!).toBeGreaterThan(3)
    expect(totalsByClass([p]).bond).toBeCloseTo(p.valueCZK, 6)
  })

  it('uses the frozen rate for crypto cost', () => {
    const coin: CryptoHolding = {
      id: 'c1', coin_id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', amount: 1, avg_cost_usd: 50_000,
      wallet_label: null, purchase_date: null, staking_apy: 0, notes: null, liquidity_tier: null,
      avg_fx_czk: 22, created_at: '', updated_at: '',
    }
    const [p] = buildPositions({ ...empty, cryptoHoldings: [coin] }, fx, quotes({}), noCrypto, TODAY)
    expect(p.costCZK).toBe(1_100_000)
    expect(p.isLivePrice).toBe(false)
  })

  it('excludes cash from invested cost', () => {
    const ps = buildPositions({ ...empty, bankAccounts: [account()], realEstate: [property()] },
      fx, quotes({}), noCrypto, TODAY)
    expect(investedCostAndValue(ps)).toEqual({ costCZK: 4_000_000, valueCZK: 5_000_000 })
  })
})

describe('cashTier', () => {
  it('ignores the migration-002 "instant" default on a term deposit', () => {
    expect(cashTier(account({ account_type: 'fixed_deposit', liquidity_tier: 'instant', maturity_date: '2027-11-04' }), TODAY)).toBe('year')
  })
  it('respects a deliberately chosen tier', () => {
    expect(cashTier(account({ account_type: 'fixed_deposit', liquidity_tier: 'week', maturity_date: '2029-01-01' }), TODAY)).toBe('week')
    expect(cashTier(account({ liquidity_tier: 'month' }), TODAY)).toBe('month')
  })
})

describe('currencyExposure', () => {
  it('carries a CZK mortgage as negative CZK exposure', () => {
    const ps = buildPositions({ ...empty, realEstate: [property({ ownership_pct: 100, current_value: 1_000_000, mortgage_balance: 3_000_000 })] },
      fx, quotes({}), noCrypto, TODAY)
    expect(currencyExposure(ps, fx).czkLocal).toBe(-2_000_000)
  })
})

describe('snapshot', () => {
  it('refuses a day with an unpriced stock', () => {
    const ps = buildPositions({ ...empty, holdings: [holding()] }, fx, quotes({}), noCrypto, TODAY)
    expect(snapshotBlockers(ps)).toEqual(['AAPL'])
  })
  it('records negative net worth rather than dropping it', () => {
    const ps = buildPositions({ ...empty, realEstate: [property({ ownership_pct: 100, current_value: 5_000_000, mortgage_balance: 5_500_000 })] },
      fx, quotes({}), noCrypto, TODAY)
    expect(snapshotBlockers(ps)).toEqual([])
    expect(snapshotValues(ps, fx).total_value_czk).toBe(-500_000)
  })
})
