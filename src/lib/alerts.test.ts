import { describe, it, expect } from 'vitest'
import { attentionItems } from './alerts'
import { buildPositions, positionMetrics, portfolioTotals, type QuoteSource } from './portfolio'
import { snapshotBlockers } from './snapshot'
import { toYahoo, skipStockAnalysis } from './yahoo'
import { seedFor } from './risk'
import type { Holding, BankAccount, AssetMetadata } from './supabase'

const fx = { CZK: 1, USD: 20, EUR: 25 }
const TODAY = '2026-09-30'
const holding = (p: Partial<Holding> = {}): Holding => ({
  id: 'h1', symbol: 'AAPL', name: 'Apple', shares: 10, avg_price: 100, currency: 'USD',
  exchange: null, purchase_date: null, is_dividend_payer: false, created_at: '', updated_at: '', ...p,
})
const quotes = (q: Record<string, number>): QuoteSource => ({
  getPrice: (s, f) => q[s] ?? f,
  getQuoteCurrency: (_s, f) => f,
  getAnnualDiv: () => null,
  hasPrice: s => (q[s] ?? 0) > 0,
  quotes: {},
})
const noCrypto = { getPrice: (_: string, f: number) => f, hasPrice: () => false }

function alertsFor(opts: { holdings: Holding[]; q?: Record<string, number>; accounts?: BankAccount[]; metadata?: AssetMetadata[] }) {
  const market = quotes(opts.q ?? {})
  const positions = buildPositions({ holdings: opts.holdings, bankAccounts: opts.accounts ?? [], cryptoHoldings: [], realEstate: [] }, fx, market, noCrypto, TODAY)
  const totals = portfolioTotals(opts.holdings.map(h => positionMetrics(h, market, fx)))
  return attentionItems({
    positions, accounts: opts.accounts ?? [], bonds: [], holdings: opts.holdings, metadata: opts.metadata ?? [],
    costFxUnknown: totals.costFxUnknown, snapshotBlockedBy: snapshotBlockers(positions), today: TODAY,
  })
}

describe('manual price', () => {
  it('values an unquoted position at the manual price and no longer blocks the snapshot', () => {
    const h = holding({ symbol: 'SKLZ', manual_price: 5, manual_price_date: '2026-09-29' })
    const m = positionMetrics(h, quotes({}), fx)
    expect(m.isManualPrice).toBe(true)
    expect(m.marketCZK).toBe(10 * 5 * 20)
    const pos = buildPositions({ holdings: [h], bankAccounts: [], cryptoHoldings: [], realEstate: [] }, fx, quotes({}), noCrypto, TODAY)
    expect(snapshotBlockers(pos)).toEqual([])
  })
  it('prefers a live quote over the manual price', () => {
    const m = positionMetrics(holding({ manual_price: 5 }), quotes({ AAPL: 120 }), fx)
    expect(m.isManualPrice).toBe(false)
    expect(m.price).toBe(120)
  })
  it('flags a manual price older than 30 days', () => {
    const a = alertsFor({ holdings: [holding({ manual_price: 5, manual_price_date: '2026-08-01' })] })
    expect(a.map(x => x.id)).toContain('manual-stale')
    expect(a.map(x => x.id)).not.toContain('at-cost')
  })
})

describe('at-cost alert', () => {
  it('is one alert naming each ticker once, and says the snapshot is held back', () => {
    const a = alertsFor({ holdings: [holding({ id: 'a', symbol: 'CSG1' }), holding({ id: 'b', symbol: 'SKLZ' }), holding({ id: 'c', symbol: 'SKLZ' })] })
    const atCost = a.filter(x => x.id === 'at-cost')
    expect(atCost).toHaveLength(1)
    expect(atCost[0].text).toMatch(/^CSG1, SKLZ have no live price/)
    expect(atCost[0].text).toMatch(/history point isn't saved/)
    expect(a.map(x => x.id)).not.toContain('snapshot')
  })
})

describe('purchase FX alert', () => {
  it('does not count zero-cost positions (RSUs) or CZK ones, and counts a ticker once', () => {
    const a = alertsFor({
      q: { AMZN: 200, ERBAG: 2000 },
      holdings: [
        holding({ id: 'r', symbol: 'AMZN', shares: 40, avg_price: 0 }),
        holding({ id: 'b', symbol: 'AMZN', shares: 10, avg_price: 118 }),
        holding({ id: 'e', symbol: 'ERBAG', currency: 'CZK', avg_price: 1800 }),
      ],
    })
    expect(a.find(x => x.id === 'fx-unknown')!.text).toMatch(/^1 position has/)
  })
})

describe('unclassified alert', () => {
  it('counts distinct tickers', () => {
    const a = alertsFor({ q: { AMZN: 1 }, holdings: [holding({ id: '1', symbol: 'AMZN' }), holding({ id: '2', symbol: 'AMZN' })] })
    expect(a.find(x => x.id === 'unclassified')!.text).toMatch(/^1 holding has/)
  })
})

describe('quote symbol resolution', () => {
  it('maps the broker code CSG1 to the Euronext listing', () => {
    expect(toYahoo('CSG1', 'AEB')).toBe('CSG.AS')
  })
  it('uses the exchange for a bare European ticker', () => {
    expect(toYahoo('TTE', 'SBF')).toBe('TTE.PA')
    expect(toYahoo('SAP', 'IBIS2')).toBe('SAP.DE')
    expect(skipStockAnalysis('TTE', 'SBF')).toBe(true)
  })
  it('leaves US and already-suffixed tickers alone', () => {
    expect(toYahoo('AAPL', 'NASDAQ')).toBe('AAPL')
    expect(toYahoo('BNP.PA', 'SBF')).toBe('BNP.PA')
    expect(toYahoo('SPY5', 'LSEETF')).toBe('SPY5.L')
    expect(skipStockAnalysis('SPY5', 'LSEETF')).toBe(false)
    expect(skipStockAnalysis('AAPL', 'NASDAQ')).toBe(false)
  })
})

describe('classification seed', () => {
  it('finds suffixed tickers and classifies CSG as industrials', () => {
    expect(seedFor('BNP.PA')?.sector).toBe('Financials')
    expect(seedFor('CSG1')?.sector).toBe('Industrials')
    expect(seedFor('SPYW')?.sector).toBe('ETF')
    expect(seedFor('ZZZZ')).toBeUndefined()
  })
})
