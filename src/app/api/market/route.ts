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
  // Without the absolute change to derive from, the provider's own number is
  // genuinely ambiguous: Yahoo sends 0.0123 for 1.23% on some paths and 1.23 on
  // others, and inside ±0.5 there is no way to tell which. A value that could
  // be either 0.3% or 0.003% is not a measurement, so report nothing rather
  // than guessing — the UI already renders null as an em dash.
  if (Math.abs(providerPercent) < 0.5) return null
  return providerPercent
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

// ─── Server-side quote cache ──────────────────────────────────────────────────
//
// This route scrapes two third-party providers, so every call it can avoid is
// worth avoiding. A POST body cannot be cached by HTTP, so the cache is
// per-symbol and in-process: several pages (and several visitors of the same
// deployment) asking for the same ticker within the window share one fetch.

const QUOTE_TTL = 60 * 1000
/** A single request cannot ask for an unbounded number of scrapes. */
const MAX_SYMBOLS = 100

const quoteCache = new Map<string, { quote: MarketQuote; at: number }>()

function cachedQuote(symbol: string): MarketQuote | null {
  const hit = quoteCache.get(symbol)
  if (!hit) return null
  if (Date.now() - hit.at > QUOTE_TTL) {
    quoteCache.delete(symbol)
    return null
  }
  return hit.quote
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { symbols?: unknown }
    const requested = Array.isArray(body.symbols)
      ? Array.from(new Set(
          body.symbols.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        ))
      : []
    if (!requested.length) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }
    if (requested.length > MAX_SYMBOLS) {
      return NextResponse.json(
        { error: `at most ${MAX_SYMBOLS} symbols per request` },
        { status: 400 }
      )
    }

    // Serve what is still fresh, and only go out for the rest.
    const fromCache: Record<string, MarketQuote> = {}
    const symbols: string[] = []
    for (const s of requested) {
      const hit = cachedQuote(s)
      if (hit) fromCache[s] = hit
      else symbols.push(s)
    }

    if (symbols.length === 0) {
      return NextResponse.json({
        quotes: fromCache,
        fetchedAt: new Date().toISOString(),
      } satisfies MarketDataResponse)
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
    const quotes: Record<string, MarketQuote> = { ...fromCache }
    for (const symbol of symbols) {
      const sa    = saResults[symbol] ?? null
      const yahoo = yahooMap[symbol] ?? { ...EMPTY_QUOTE }
      const merged = mergeQuotes(sa, yahoo)
      quotes[symbol] = merged
      // Only a real quote is cached. Caching an empty one would pin a failed
      // lookup in place for the whole window.
      if (merged.price > 0) quoteCache.set(symbol, { quote: merged, at: Date.now() })
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
