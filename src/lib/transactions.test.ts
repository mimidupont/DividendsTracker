import { describe, it, expect } from 'vitest'
import { costBasis, realizedPL, externalFlows, summarise, contributionsVsGrowth } from './transactions'
import type { Transaction } from './supabase'

let seq = 0
function txn(p: Partial<Transaction> & { txn_date: string; type: Transaction['type'] }): Transaction {
  seq++
  return {
    id: `t${seq}`,
    profile_id: 'p1',
    created_at: `${p.txn_date}T00:00:0${seq % 10}Z`,
    symbol: null,
    quantity: null,
    amount: 0,
    currency: 'USD',
    fx_rate_czk: 20,
    amount_czk: 0,
    fee: 0,
    tax: 0,
    is_external: false,
    note: null,
    ...p,
  } as Transaction
}

const buy = (date: string, qty: number, amount: number, extra: Partial<Transaction> = {}) =>
  txn({ txn_date: date, type: 'buy', symbol: 'AAPL', quantity: qty, amount, ...extra })
const sell = (date: string, qty: number, amount: number, extra: Partial<Transaction> = {}) =>
  txn({ txn_date: date, type: 'sell', symbol: 'AAPL', quantity: qty, amount, ...extra })

describe('costBasis', () => {
  it('carries buy fees into the basis', () => {
    const cb = costBasis('AAPL', [buy('2024-01-01', 10, 1000, { fee: 50 })])
    expect(cb.shares).toBe(10)
    expect(cb.avgPrice).toBeCloseTo(105, 9)
  })

  it('consumes the oldest lot first under FIFO', () => {
    const cb = costBasis('AAPL', [
      buy('2024-01-01', 10, 1000),   // $100/sh
      buy('2024-06-01', 10, 1500),   // $150/sh
      sell('2024-09-01', 10, 1800),
    ])
    expect(cb.shares).toBe(10)
    expect(cb.avgPrice).toBeCloseTo(150, 9) // the cheap lot is gone
  })
})

describe('realizedPL', () => {
  // Acceptance case from the v2 spec: hand-calculated FIFO gain.
  it('matches a hand calculation', () => {
    const lots = realizedPL([
      buy('2023-01-01', 10, 1000),  // $100/sh
      sell('2023-06-01', 5, 750),   // $150/sh → gain 5 × 50 = $250
    ])
    expect(lots).toHaveLength(1)
    expect(lots[0].gainLocal).toBeCloseTo(250, 9)
  })

  it('nets sell fees out of proceeds', () => {
    const lots = realizedPL([
      buy('2023-01-01', 10, 1000),
      sell('2023-06-01', 10, 1500, { fee: 100 }),
    ])
    expect(lots[0].proceedsLocal).toBeCloseTo(1400, 9)
    expect(lots[0].gainLocal).toBeCloseTo(400, 9)
  })

  it('converts each leg at its own date rate', () => {
    const lots = realizedPL([
      buy('2023-01-10', 10, 1000, { fx_rate_czk: 20 }),
      sell('2026-06-10', 10, 1200, { fx_rate_czk: 25 }),
    ])
    expect(lots[0].gainCZK).toBeCloseTo(30_000 - 20_000, 6)
    expect(lots[0].fxGainCZK).toBeCloseTo(5_000, 6)
  })

  // BUG-05 — the Czech 3-year time test is a calendar span, not 1095 days.
  describe('Czech 3-year time test', () => {
    it('fails one day short of three calendar years', () => {
      const lots = realizedPL([buy('2021-01-01', 1, 100), sell('2023-12-31', 1, 200)])
      expect(lots[0].passesTimeTest).toBe(false)
    })

    it('passes exactly on the third anniversary', () => {
      const lots = realizedPL([buy('2021-01-01', 1, 100), sell('2024-01-01', 1, 200)])
      expect(lots[0].passesTimeTest).toBe(true)
    })

    it('is not fooled by a leap day inside the span', () => {
      // 2020-02-29 → 2023-02-28 is 1095 days but only 2 years 364 days.
      const lots = realizedPL([buy('2020-02-29', 1, 100), sell('2023-02-28', 1, 200)])
      expect(lots[0].holdingDays).toBe(1095)
      expect(lots[0].passesTimeTest).toBe(false)
    })

    it('treats 29 Feb + 3 years as 1 March', () => {
      const lots = realizedPL([buy('2020-02-29', 1, 100), sell('2023-03-01', 1, 200)])
      expect(lots[0].passesTimeTest).toBe(true)
    })
  })

  // BUG-06 — a ledger that starts mid-history has sells with no matching buys.
  describe('sells with no matching buy lots', () => {
    it('still reports the sale, with the basis flagged incomplete', () => {
      const lots = realizedPL([sell('2024-06-01', 10, 1500)])
      expect(lots).toHaveLength(1)
      expect(lots[0].shares).toBe(10)
      expect(lots[0].costLocal).toBe(0)
      expect(lots[0].proceedsLocal).toBeCloseTo(1500, 9)
      expect(lots[0].basisIncomplete).toBe(true)
    })

    it('splits a partially-matched sale into a matched and an unmatched lot', () => {
      const lots = realizedPL([
        buy('2024-01-01', 4, 400),
        sell('2024-06-01', 10, 1500),   // $150/sh
      ])
      expect(lots).toHaveLength(2)
      const matched = lots.find(l => !l.basisIncomplete)!
      const unmatched = lots.find(l => l.basisIncomplete)!
      expect(matched.shares).toBe(4)
      expect(matched.gainLocal).toBeCloseTo(600 - 400, 9)
      expect(unmatched.shares).toBe(6)
      expect(unmatched.costLocal).toBe(0)
    })
  })
})

describe('summarise', () => {
  it('measures a sale against buys from earlier years', () => {
    const rows = [
      buy('2023-01-01', 10, 1000, { fx_rate_czk: 20 }),
      sell('2026-06-01', 10, 1500, { fx_rate_czk: 20 }),
    ]
    // Filtering to 2026 first would leave the sale with no cost basis at all.
    expect(summarise(rows, 2026).realizedPLCZK).toBeCloseTo(10_000, 6)
    expect(summarise(rows, 2023).realizedPLCZK).toBe(0)
  })
})

describe('externalFlows', () => {
  it('sums same-day movements and ignores internal ones', () => {
    const flows = externalFlows([
      txn({ txn_date: '2024-03-01', type: 'deposit', amount: 1000, amount_czk: 20_000, is_external: true }),
      txn({ txn_date: '2024-03-01', type: 'deposit', amount: 500, amount_czk: 10_000, is_external: true }),
      buy('2024-03-01', 1, 100),
    ])
    expect(flows).toHaveLength(1)
    expect(flows[0].amountCZK).toBeCloseTo(30_000, 6)
  })

  // BUG-10 — one CZK helper, so every panel values the same row identically.
  it('falls back to amount × rate the same way realized P&L does', () => {
    const flows = externalFlows([
      txn({ txn_date: '2024-03-01', type: 'deposit', amount: 1000, currency: 'USD',
            fx_rate_czk: 0, amount_czk: NaN, is_external: true }),
    ])
    // A missing rate is treated as 1, never as 0 — the money did move.
    expect(flows[0].amountCZK).toBeCloseTo(1000, 6)
  })
})

describe('contributionsVsGrowth', () => {
  it('separates deposits from market gains', () => {
    const split = contributionsVsGrowth(
      [txn({ txn_date: '2024-06-01', type: 'deposit', amount: 100_000, amount_czk: 100_000, is_external: true })],
      [
        { snapshot_date: '2024-01-01', total_value_czk: 1_000_000 },
        { snapshot_date: '2024-12-01', total_value_czk: 1_250_000 },
      ]
    )
    expect(split[1].contributed).toBeCloseTo(100_000, 6)
    expect(split[1].growth).toBeCloseTo(150_000, 6)
  })
})
