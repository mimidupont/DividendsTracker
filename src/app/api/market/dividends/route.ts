import { NextRequest, NextResponse } from 'next/server'
import { getYahooSession, toYahoo, fetchYahooQuoteSummary, batchedMap } from '@/lib/yahoo'
import { batchFetchSAQuotes, isSASupported } from '@/lib/stockanalysis'

export interface DividendSummary {
  symbol: string
  exDividendDate: number | null        // Unix timestamp (for compatibility)
  dividendRate: number | null
  trailingAnnualDividendRate: number | null
  lastDividendValue: number | null
  lastDividendDate: number | null      // Unix timestamp
  payoutFrequency: number | null
  currency: string
  /** ISO string of ex-date when coming from SA (more reliable) */
  exDividendDateISO?: string | null
  /** ISO string of pay date when coming from SA */
  payDividendDateISO?: string | null
  dataSource?: 'stockanalysis' | 'yahoo'
  error?: string
}

export interface DividendSummaryResponse {
  summaries: Record<string, DividendSummary>
  fetchedAt: string
}

// ─── Yahoo fetch (unchanged) ──────────────────────────────────────────────────

async function fetchYahooDividendSummary(
  symbol: string,
  crumb: string,
  cookie: string
): Promise<DividendSummary> {
  const empty: DividendSummary = {
    symbol, exDividendDate: null, dividendRate: null,
    trailingAnnualDividendRate: null, lastDividendValue: null,
    lastDividendDate: null, payoutFrequency: null, currency: 'USD',
    dataSource: 'yahoo',
  }
  try {
    const result = await fetchYahooQuoteSummary(
      toYahoo(symbol),
      'summaryDetail,calendarEvents,defaultKeyStatistics',
      crumb,
      cookie
    )
    const sd  = result.summaryDetail ?? {}
    const cal = result.calendarEvents ?? {}
    const ks  = result.defaultKeyStatistics ?? {}

    const exDate     = cal.exDividendDate?.raw ?? sd.exDividendDate?.raw ?? null
    const lastDiv    = ks.lastDividendValue?.raw ?? null
    const annualRate: number | null = sd.trailingAnnualDividendRate?.raw ?? null

    let freq: number | null = null
    if (annualRate && lastDiv && lastDiv > 0) {
      const ratio = annualRate / lastDiv
      freq = ratio < 1.5 ? 1 : ratio < 3 ? 2 : ratio < 8 ? 4 : 12
    }

    return {
      symbol,
      exDividendDate: exDate,
      dividendRate: sd.dividendRate?.raw ?? null,
      trailingAnnualDividendRate: annualRate,
      lastDividendValue: lastDiv,
      lastDividendDate: ks.lastDividendDate?.raw ?? null,
      payoutFrequency: freq,
      currency: sd.currency ?? 'USD',
      dataSource: 'yahoo',
    }
  } catch (e) {
    return { ...empty, error: String(e) }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an ISO date string "YYYY-MM-DD" to a Unix timestamp (midnight UTC) */
function isoToUnix(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return isNaN(ms) ? null : Math.floor(ms / 1000)
}

/** Estimate payout frequency from annual rate ÷ per-payment amount */
function estimateFrequency(annual: number | null, perPayment: number | null): number | null {
  if (!annual || !perPayment || perPayment <= 0) return null
  const ratio = annual / perPayment
  return ratio < 1.5 ? 1 : ratio < 3 ? 2 : ratio < 8 ? 4 : 12
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { symbols } = (await req.json()) as { symbols: string[] }
    if (!symbols?.length) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }

    // 1. StockAnalysis pass — reliable ex-dates and dividend amounts for US tickers
    const saResults = await batchFetchSAQuotes(symbols, 6)

    // 2. Which symbols still need Yahoo?
    const needsYahoo = symbols.filter(s => {
      const sa = saResults[s]
      // Need Yahoo if: SA doesn't support the symbol, OR SA has no dividend data
      return !sa || !!sa.error || (sa.exDividendDate === null && sa.annualDividend === null)
    })

    // 3. Yahoo pass for the remainder
    let yahooMap: Record<string, DividendSummary> = {}
    if (needsYahoo.length > 0) {
      const session = await getYahooSession()
      if (session) {
        const results = await batchedMap(
          needsYahoo,
          8,
          s => fetchYahooDividendSummary(s, session.crumb, session.cookie)
        )
        yahooMap = Object.fromEntries(results.map(r => [r.symbol, r]))
      } else {
        // No session — fill empty
        for (const s of needsYahoo) {
          yahooMap[s] = {
            symbol: s, exDividendDate: null, dividendRate: null,
            trailingAnnualDividendRate: null, lastDividendValue: null,
            lastDividendDate: null, payoutFrequency: null, currency: 'USD',
            error: 'No Yahoo session',
          }
        }
      }
    }

    // 4. Merge into a unified DividendSummary per symbol
    const summaries: Record<string, DividendSummary> = {}

    for (const symbol of symbols) {
      const sa    = saResults[symbol]
      const yahoo = yahooMap[symbol]

      if (sa && !sa.error && (sa.exDividendDate || sa.annualDividend)) {
        // SA has useful dividend data — use it as primary
        const annual = sa.annualDividend ?? null
        const perPmt = sa.lastDividendAmount ?? null
        const freq   = estimateFrequency(annual, perPmt) ?? 4

        summaries[symbol] = {
          symbol,
          // Convert ISO date strings to Unix timestamps so existing
          // calendar/DRIP code works without changes
          exDividendDate:           isoToUnix(sa.exDividendDate),
          exDividendDateISO:        sa.exDividendDate,
          payDividendDateISO:       sa.payDividendDate,
          dividendRate:             annual,
          trailingAnnualDividendRate: annual,
          lastDividendValue:        perPmt,
          // SA doesn't give us a lastDividendDate timestamp directly —
          // fall through to Yahoo if it has one
          lastDividendDate:         yahoo?.lastDividendDate ?? null,
          payoutFrequency:          freq,
          currency:                 'USD',
          dataSource:               'stockanalysis',
        }
      } else if (yahoo) {
        // SA not available / no dividend data → use Yahoo
        summaries[symbol] = yahoo
      } else {
        // Both failed
        summaries[symbol] = {
          symbol,
          exDividendDate: null, dividendRate: null,
          trailingAnnualDividendRate: null, lastDividendValue: null,
          lastDividendDate: null, payoutFrequency: null, currency: 'USD',
          error: 'No data from either source',
        }
      }
    }

    return NextResponse.json({
      summaries,
      fetchedAt: new Date().toISOString(),
    } satisfies DividendSummaryResponse)
  } catch (err) {
    console.error('[market/dividends]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
