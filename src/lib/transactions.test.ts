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

    // §4(1)(w) ZDP: the holding period must *exceed* three years.
    it('fails on the third anniversary itself', () => {
      const lots = realizedPL([buy('2021-01-01', 1, 100), sell('2024-01-01', 1, 200)])
      expect(lots[0].passesTimeTest).toBe(false)
    })

    it('passes the day after the third anniversary', () => {
      const lots = realizedPL([buy('2021-01-01', 1, 100), sell('2024-01-02', 1, 200)])
      expect(lots[0].passesTimeTest).toBe(true)
    })

    it('is not fooled by a leap day inside the span', () => {
      // 2020-02-29 → 2023-02-28 is 1095 days but only 2 years 364 days.
      const lots = realizedPL([buy('2020-02-29', 1, 100), sell('2023-02-28', 1, 200)])
      expect(lots[0].holdingDays).toBe(1095)
      expect(lots[0].passesTimeTest).toBe(false)
    })

    it('treats 29 Feb + 3 years as 1 March (exempt from 2 March)', () => {
      const onAnniversary = realizedPL([buy('2020-02-29', 1, 100), sell('2023-03-01', 1, 200)])
      expect(onAnniversary[0].passesTimeTest).toBe(false)
      const after = realizedPL([buy('2020-02-29', 1, 100), sell('2023-03-02', 1, 200)])
      expect(after[0].passesTimeTest).toBe(true)
    })

    it('keeps per-lot dates under average cost', () => {
      // 10 @ $80 in 2020 and 10 @ $220 in 2025, sell 15 in 2026.
      const lots = realizedPL([
        buy('2020-01-15', 10, 800),
        buy('2025-06-01', 10, 2200),
        sell('2026-03-01', 15, 15 * 200),
      ], 'avg')
      expect(lots).toHaveLength(2)
      const exempt = lots.filter(l => l.passesTimeTest)
      const taxable = lots.filter(l => !l.passesTimeTest)
      expect(exempt.reduce((s, l) => s + l.shares, 0)).toBe(10)
      expect(taxable.reduce((s, l) => s + l.shares, 0)).toBe(5)
      // Both priced at the $150 pool average.
      for (const l of lots) expect(l.costLocal / l.shares).toBeCloseTo(150, 9)
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

import { backfillRows, backfillKey } from './transactions'

describe('backfillRows', () => {
  const base = {
    holdings: [{ id: 'h1', symbol: 'AAPL', shares: 25, avg_price: 150, currency: 'USD', purchase_date: '2020-01-15' }],
    lots: [
      { holding_id: 'h1', symbol: 'AAPL', shares: 10, purchase_price: 80, purchase_date: '2020-01-15' },
      { holding_id: 'h1', symbol: 'AAPL', shares: 10, purchase_price: 220, purchase_date: '2025-06-01' },
    ],
    dividends: [],
    today: '2026-09-30',
  }
  const rates: Record<string, number> = { '2020-01-15': 22.7, '2025-06-01': 21.9 }

  it('writes one buy per lot at that date\'s rate, plus the unlotted residual', () => {
    const r = backfillRows({ ...base, existingKeys: new Set(), rateOn: (_c, d) => rates[d] ?? null })
    expect(r.rows).toHaveLength(3)
    expect(r.rows.map(x => x.fx_rate_czk)).toEqual([22.7, 21.9, 22.7])
    expect(r.rows[2].quantity).toBe(5)
  })

  it('skips — never guesses — when a historical rate is missing', () => {
    const r = backfillRows({ ...base, existingKeys: new Set(), rateOn: () => null })
    expect(r.rows).toHaveLength(0)
    expect(r.skipped.length).toBeGreaterThan(0)
  })

  it('is idempotent via existing keys', () => {
    const keys = new Set([backfillKey('buy', 'AAPL', '2020-01-15', 10), backfillKey('buy', 'AAPL', '2025-06-01', 10), backfillKey('buy', 'AAPL', '2020-01-15', 5)])
    expect(backfillRows({ ...base, existingKeys: keys, rateOn: () => 20 }).rows).toHaveLength(0)
  })
})

describe('stock splits', () => {
  it('carries cost and dates through a 4-for-1 split', () => {
    const lots = realizedPL([
      buy('2020-01-02', 10, 1000),                                          // $100/sh
      txn({ txn_date: '2022-01-02', type: 'split', symbol: 'AAPL', quantity: 4 }),
      sell('2024-01-03', 40, 4000),                                         // $100/post-split sh
    ])
    expect(lots).toHaveLength(1)
    expect(lots[0].shares).toBe(40)
    expect(lots[0].costLocal).toBeCloseTo(1000, 9)
    expect(lots[0].gainLocal).toBeCloseTo(3000, 9)
    expect(lots[0].passesTimeTest).toBe(true)
  })
})
