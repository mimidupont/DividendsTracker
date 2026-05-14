import { NextRequest, NextResponse } from 'next/server'
import { getYahooSession, toYahoo, fetchYahooQuoteSummary, batchedMap } from '@/lib/yahoo'
import { batchFetchSAQuotes, isSASupported } from '@/lib/stockanalysis'

export interface MarketQuote {
  price: number
  changePercent: number | null
  dividendYield: number | null
  forwardAnnualDividendRate: number | null
  trailingAnnualDividendRate: number | null
  currency: string
  longName?: string
  /** Which data source actually populated this quote */
  dataSource?: 'stockanalysis' | 'yahoo' | 'fallback'
}

export interface MarketDataResponse {
  quotes: Record<string, MarketQuote>
  fetchedAt: string
}

const EMPTY_QUOTE: MarketQuote = {
  price: 0,
  changePercent: null,
  dividendYield: null,
  forwardAnnualDividendRate: null,
  trailingAnnualDividendRate: null,
  currency: 'USD',
  dataSource: 'fallback',
}

// ─── Yahoo fetch (unchanged from original) ────────────────────────────────────

async function fetchYahooQuote(
  symbol: string,
  crumb: string,
  cookie: string
): Promise<[string, MarketQuote]> {
  try {
    const result = await fetchYahooQuoteSummary(
      toYahoo(symbol),
      'price,summaryDetail',
      crumb,
      cookie
    )
    const price = result.price ?? {}
    const sd    = result.summaryDetail ?? {}
    const regularPrice: number = price.regularMarketPrice?.raw ?? 0
    if (!regularPrice) return [symbol, { ...EMPTY_QUOTE, dataSource: 'yahoo' }]

    return [symbol, {
      price: regularPrice,
      changePercent: price.regularMarketChangePercent?.raw ?? null,
      dividendYield: sd.trailingAnnualDividendYield?.raw ?? price.dividendYield?.raw ?? null,
      forwardAnnualDividendRate: sd.dividendRate?.raw ?? null,
      trailingAnnualDividendRate: sd.trailingAnnualDividendRate?.raw ?? null,
      currency: price.currency ?? sd.currency ?? 'USD',
      longName: price.longName ?? price.shortName ?? undefined,
      dataSource: 'yahoo',
    }]
  } catch {
    return [symbol, { ...EMPTY_QUOTE, dataSource: 'yahoo' }]
  }
}

// ─── Merge SA + Yahoo results ─────────────────────────────────────────────────

/**
 * Strategy:
 * 1. Try StockAnalysis first for supported US tickers — it has clean, structured
 *    dividend data (annualDividend, exDate, payDate) and doesn't need a session.
 * 2. Fall back to Yahoo for anything SA doesn't cover (non-US tickers) OR when
 *    SA returned a null/error price.
 * 3. If Yahoo also fails, keep the SA partial data (yield/div may still be valid).
 */
function mergeQuotes(
  symbol: string,
  saQuote: ReturnType<typeof batchFetchSAQuotes> extends Promise<Record<string, infer V>> ? V : never,
  yahooQuote: MarketQuote
): MarketQuote {
  // SA succeeded with a real price → use it as primary
  if (saQuote && !saQuote.error && saQuote.price) {
    return {
      price: saQuote.price,
      changePercent: saQuote.changePercent,
      // Prefer SA yield (cleaner) but fall back to Yahoo
      dividendYield: saQuote.dividendYield ?? yahooQuote.dividendYield,
      // SA annualDividend maps to forwardAnnualDividendRate
      forwardAnnualDividendRate:
        saQuote.annualDividend ?? yahooQuote.forwardAnnualDividendRate,
      trailingAnnualDividendRate:
        saQuote.annualDividend ?? yahooQuote.trailingAnnualDividendRate,
      currency: saQuote.currency ?? yahooQuote.currency,
      longName: saQuote.longName ?? yahooQuote.longName,
      dataSource: 'stockanalysis',
    }
  }

  // SA not supported or failed → use Yahoo
  if (yahooQuote.price) {
    return yahooQuote
  }

  // Both failed → return empty
  return { ...EMPTY_QUOTE }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { symbols } = (await req.json()) as { symbols: string[] }
    if (!symbols?.length) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }

    // 1. Fetch StockAnalysis data for all symbols (returns null for unsupported)
    const saResults = await batchFetchSAQuotes(symbols, 6)

    // 2. Determine which symbols still need Yahoo data:
    //    - Not SA-supported at all (non-US), OR
    //    - SA returned an error / zero price
    const needsYahoo = symbols.filter(s => {
      const sa = saResults[s]
      return !sa || !!sa.error || !sa.price
    })

    // 3. Fetch Yahoo for the remainder
    let yahooMap: Record<string, MarketQuote> = {}

    if (needsYahoo.length > 0) {
      const session = await getYahooSession()
      if (session) {
        const pairs = await batchedMap(
          needsYahoo,
          8,
          s => fetchYahooQuote(s, session.crumb, session.cookie)
        )
        yahooMap = Object.fromEntries(pairs)
      } else {
        // No Yahoo session — fill with empty quotes
        for (const s of needsYahoo) {
          yahooMap[s] = { ...EMPTY_QUOTE }
        }
      }
    }

    // 4. Merge results
    const quotes: Record<string, MarketQuote> = {}
    for (const symbol of symbols) {
      const sa    = saResults[symbol] ?? null
      const yahoo = yahooMap[symbol] ?? { ...EMPTY_QUOTE }
      quotes[symbol] = mergeQuotes(symbol, sa, yahoo)
    }

    return NextResponse.json({
      quotes,
      fetchedAt: new Date().toISOString(),
    } satisfies MarketDataResponse)
  } catch (err) {
    console.error('[market]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
