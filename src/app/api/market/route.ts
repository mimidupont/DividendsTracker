import { NextRequest, NextResponse } from 'next/server'
import { getYahooSession, toYahoo, fetchYahooQuoteSummary, batchedMap } from '@/lib/yahoo'
import { batchFetchSAQuotes, type SAQuote } from '@/lib/stockanalysis'

export interface MarketQuote {
  price: number
  /** Day change in PERCENT units (1.23 = +1.23%), never a fraction. */
  changePercent: number | null
  /** Dividend yield as a decimal fraction (0.031 = 3.1%). */
  dividendYield: number | null
  forwardAnnualDividendRate: number | null
  trailingAnnualDividendRate: number | null
  /** Currency the price is quoted in. Empty when unknown — do not guess. */
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
  currency: '',
  dataSource: 'fallback',
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

/**
 * Yields arrive as a fraction from Yahoo (0.031) but as a percent from
 * StockAnalysis (3.1). Anything above 1 is a percent — a genuine 100%+ yield
 * does not exist outside of data errors, which we want to drop anyway.
 */
function normalizeYield(raw: number | null | undefined): number | null {
  if (raw == null || !isFinite(raw) || raw <= 0) return null
  const y = raw > 1 ? raw / 100 : raw
  return y > 0 && y < 1 ? y : null
}

/**
 * Day change in percent units. Derived from the absolute change when possible —
 * that is unambiguous, unlike the providers' percent fields, which are a
 * fraction on Yahoo and a percent on StockAnalysis.
 */
function changeToPercent(
  price: number | null,
  absChange: number | null,
  providerPercent: number | null
): number | null {
  if (price != null && absChange != null && isFinite(price) && isFinite(absChange)) {
    const prev = price - absChange
    if (prev > 0) return (absChange / prev) * 100
  }
  if (providerPercent == null || !isFinite(providerPercent)) return null
  // |value| below 0.5 came from Yahoo as a fraction (0.0123 = 1.23%); above
  // that it is already a percent. The two readings only overlap inside the
  // ±0.5% band, where both round to roughly the same tiny move.
  return Math.abs(providerPercent) < 0.5 ? providerPercent * 100 : providerPercent
}

// ─── Yahoo fetch ──────────────────────────────────────────────────────────────

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

    const rawYield = sd.trailingAnnualDividendYield?.raw ?? sd.dividendYield?.raw ?? null

    return [symbol, {
      price: regularPrice,
      changePercent: changeToPercent(
        regularPrice,
        price.regularMarketChange?.raw ?? null,
        price.regularMarketChangePercent?.raw ?? null
      ),
      dividendYield: normalizeYield(rawYield),
      forwardAnnualDividendRate: sd.dividendRate?.raw ?? null,
      trailingAnnualDividendRate: sd.trailingAnnualDividendRate?.raw ?? null,
      currency: price.currency ?? sd.currency ?? '',
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
 * 1. Try StockAnalysis first for mapped tickers — clean, structured dividend
 *    data (annualDividend, exDate, payDate) and no session dance.
 * 2. Fall back to Yahoo for anything SA doesn't cover, OR when SA returned a
 *    null/error price.
 * 3. If Yahoo also fails, keep whatever partial SA data we have.
 */
function mergeQuotes(saQuote: SAQuote | null, yahooQuote: MarketQuote): MarketQuote {
  if (saQuote && !saQuote.error && saQuote.price) {
    const annual = saQuote.annualDividend ?? yahooQuote.forwardAnnualDividendRate
    // A yield derived from the annual rate and the price we actually display is
    // self-consistent; the scraped yield is only a fallback.
    const derivedYield =
      annual != null && annual > 0 && saQuote.price > 0 ? annual / saQuote.price : null

    return {
      price: saQuote.price,
      changePercent: saQuote.changePercent,
      dividendYield:
        normalizeYield(derivedYield) ?? normalizeYield(saQuote.dividendYield) ?? yahooQuote.dividendYield,
      forwardAnnualDividendRate: annual,
      trailingAnnualDividendRate:
        saQuote.annualDividend ?? yahooQuote.trailingAnnualDividendRate,
      currency: saQuote.currency || yahooQuote.currency,
      longName: saQuote.longName ?? yahooQuote.longName,
      dataSource: 'stockanalysis',
    }
  }

  if (yahooQuote.price) return yahooQuote

  return { ...EMPTY_QUOTE }
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

    // 1. StockAnalysis for all mapped symbols (null for unmapped ones)
    const saResults = await batchFetchSAQuotes(symbols, 6)

    // 2. Which symbols still need Yahoo?
    const needsYahoo = symbols.filter(s => {
      const sa = saResults[s]
      return !sa || !!sa.error || !sa.price
    })

    // 3. Yahoo pass for the remainder
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
        for (const s of needsYahoo) {
          yahooMap[s] = { ...EMPTY_QUOTE }
        }
      }
    }

    // 4. Merge
    const quotes: Record<string, MarketQuote> = {}
    for (const symbol of symbols) {
      const sa    = saResults[symbol] ?? null
      const yahoo = yahooMap[symbol] ?? { ...EMPTY_QUOTE }
      quotes[symbol] = mergeQuotes(sa, yahoo)
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
