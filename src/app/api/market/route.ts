import { NextRequest, NextResponse } from 'next/server'
import { getYahooSession, toYahoo, fetchYahooQuoteSummary, batchedMap } from '@/lib/yahoo'

export interface MarketQuote {
  price: number
  changePercent: number | null
  dividendYield: number | null
  forwardAnnualDividendRate: number | null
  trailingAnnualDividendRate: number | null
  currency: string
  longName?: string
}

export interface MarketDataResponse {
  quotes: Record<string, MarketQuote>
  fetchedAt: string
}

const EMPTY_QUOTE: MarketQuote = {
  price: 0, changePercent: null, dividendYield: null,
  forwardAnnualDividendRate: null, trailingAnnualDividendRate: null, currency: 'USD',
}

async function fetchQuote(
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
    if (!regularPrice) return [symbol, EMPTY_QUOTE]

    return [symbol, {
      price: regularPrice,
      changePercent: price.regularMarketChangePercent?.raw ?? null,
      dividendYield: sd.trailingAnnualDividendYield?.raw ?? price.dividendYield?.raw ?? null,
      forwardAnnualDividendRate: sd.dividendRate?.raw ?? null,
      trailingAnnualDividendRate: sd.trailingAnnualDividendRate?.raw ?? null,
      currency: price.currency ?? sd.currency ?? 'USD',
      longName: price.longName ?? price.shortName ?? undefined,
    }]
  } catch {
    return [symbol, EMPTY_QUOTE]
  }
}

export async function POST(req: NextRequest) {
  try {
    const { symbols } = (await req.json()) as { symbols: string[] }
    if (!symbols?.length) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }

    const session = await getYahooSession()
    if (!session) {
      const quotes = Object.fromEntries(symbols.map(s => [s, EMPTY_QUOTE]))
      return NextResponse.json({ quotes, fetchedAt: new Date().toISOString() } satisfies MarketDataResponse)
    }

    const pairs = await batchedMap(symbols, 8, s => fetchQuote(s, session.crumb, session.cookie))
    const quotes = Object.fromEntries(pairs)

    return NextResponse.json({ quotes, fetchedAt: new Date().toISOString() } satisfies MarketDataResponse)
  } catch (err) {
    console.error('[market]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
