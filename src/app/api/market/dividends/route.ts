import { NextRequest, NextResponse } from 'next/server'
import { getYahooSession, toYahoo, fetchYahooQuoteSummary, batchedMap } from '@/lib/yahoo'
import { batchFetchSAQuotes } from '@/lib/stockanalysis'
import { unixToISODate } from '@/lib/date'

export interface DividendSummary {
  symbol: string
  exDividendDate: number | null        // Unix timestamp (for compatibility)
  dividendRate: number | null
  trailingAnnualDividendRate: number | null
  lastDividendValue: number | null
  lastDividendDate: number | null      // Unix timestamp
  payoutFrequency: number | null
  currency: string
  /** ISO ex-date ("YYYY-MM-DD"). Preferred over the Unix field — no TZ ambiguity. */
  exDividendDateISO?: string | null
  /** ISO pay date ("YYYY-MM-DD"). */
  payDividendDateISO?: string | null
  /** ISO date of the most recent *paid* dividend, whichever source supplied it. */
  lastDividendDateISO?: string | null
  dataSource?: 'stockanalysis' | 'yahoo'
  error?: string
}

export interface DividendSummaryResponse {
  summaries: Record<string, DividendSummary>
  fetchedAt: string
}

// ─── Yahoo fetch ──────────────────────────────────────────────────────────────

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
    const payDate    = cal.dividendDate?.raw ?? null
    const lastDiv    = ks.lastDividendValue?.raw ?? null
    const lastDivTs  = ks.lastDividendDate?.raw ?? null
    const annualRate: number | null = sd.trailingAnnualDividendRate?.raw ?? null

    return {
      symbol,
      exDividendDate: exDate,
      exDividendDateISO: unixToISODate(exDate),
      payDividendDateISO: unixToISODate(payDate),
      dividendRate: sd.dividendRate?.raw ?? null,
      trailingAnnualDividendRate: annualRate,
      lastDividendValue: lastDiv,
      lastDividendDate: lastDivTs,
      lastDividendDateISO: unixToISODate(lastDivTs),
      payoutFrequency: estimateFrequency(annualRate, lastDiv),
      currency: sd.currency ?? 'USD',
      dataSource: 'yahoo',
    }
  } catch (e) {
    return { ...empty, error: String(e) }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an ISO date string "YYYY-MM-DD" to a Unix timestamp (midnight UTC) */
function isoToUnix(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return isNaN(ms) ? null : Math.floor(ms / 1000)
}

/** Estimate payout frequency from annual rate ÷ per-payment amount */
function estimateFrequency(annual: number | null, perPayment: number | null): number | null {
  if (!annual || !perPayment || perPayment <= 0) return null
  const ratio = annual / perPayment
  return ratio < 1.5 ? 1 : ratio < 3 ? 2 : ratio < 8 ? 4 : 12
}

/**
 * Most recent pay date that is not in the future.
 * StockAnalysis' `payDividendDate` is the *next* scheduled payment when one has
 * been declared, so it can only be treated as "last paid" once it is in the past.
 */
function lastPaidDate(payDateISO: string | null | undefined, todayISO: string): string | null {
  if (!payDateISO) return null
  return payDateISO <= todayISO ? payDateISO : null
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { symbols?: unknown }
    const symbols = Array.isArray(body.symbols)
      ? Array.from(new Set(
          body.symbols.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        ))
      : []
    if (!symbols.length) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }

    const today = new Date().toISOString().slice(0, 10)

    // 1. StockAnalysis pass — reliable ex-dates and dividend amounts
    const saResults = await batchFetchSAQuotes(symbols, 6)

    // 2. Which symbols still need Yahoo?
    //    Also ask Yahoo whenever SA gave us no *paid* dividend date, since the
    //    DRIP flow keys off the last payment and SA only publishes the next one.
    const needsYahoo = symbols.filter(s => {
      const sa = saResults[s]
      if (!sa || sa.error) return true
      if (sa.exDividendDate === null && sa.annualDividend === null) return true
      return lastPaidDate(sa.payDividendDate, today) === null
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
        const perPmt = sa.lastDividendAmount ?? yahoo?.lastDividendValue ?? null
        const freq   = estimateFrequency(annual, perPmt) ?? yahoo?.payoutFrequency ?? 4

        // SA's pay date is the *next* payment once declared; only treat it as
        // the last payment when it has already happened. Otherwise use Yahoo's.
        const lastPaidISO =
          lastPaidDate(sa.payDividendDate, today) ?? yahoo?.lastDividendDateISO ?? null

        summaries[symbol] = {
          symbol,
          // Unix timestamps kept so older callers keep working
          exDividendDate:           isoToUnix(sa.exDividendDate),
          exDividendDateISO:        sa.exDividendDate,
          payDividendDateISO:       sa.payDividendDate,
          lastDividendDateISO:      lastPaidISO,
          dividendRate:             annual,
          trailingAnnualDividendRate: annual,
          lastDividendValue:        perPmt,
          lastDividendDate:         isoToUnix(lastPaidISO),
          payoutFrequency:          freq,
          // SA_SYMBOL_MAP knows the native trading currency — the old code
          // hardcoded USD, which mispriced every CZK and EUR listing.
          currency:                 sa.currency || yahoo?.currency || 'USD',
          dataSource:               'stockanalysis',
        }
      } else if (yahoo) {
        summaries[symbol] = yahoo
      } else {
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
