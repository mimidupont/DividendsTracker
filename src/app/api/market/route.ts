import { NextRequest, NextResponse } from 'next/server'

export interface MarketQuote {
  symbol: string
  price: number
  previousClose: number
  changePercent: number
  dividendYield: number | null      // as decimal e.g. 0.031
  trailingAnnualDividendRate: number | null
  forwardAnnualDividendRate: number | null
  payoutRatio: number | null
  exDividendDate: number | null     // unix timestamp
  fiftyTwoWeekHigh: number
  fiftyTwoWeekLow: number
  marketCap: number | null
  currency: string
  longName: string | null
  error?: string
}

export interface MarketDataResponse {
  quotes: Record<string, MarketQuote>
  fetchedAt: string
}

// Yahoo Finance v7 quote endpoint — no API key required
async function fetchYahooQuotes(symbols: string[]): Promise<Record<string, MarketQuote>> {
  const joined = symbols.join(',')
  const fields = [
    'symbol', 'longName', 'regularMarketPrice', 'regularMarketPreviousClose',
    'regularMarketChangePercent', 'trailingAnnualDividendYield',
    'trailingAnnualDividendRate', 'forwardAnnualDividendRate',
    'payoutRatio', 'exDividendDate',
    'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'marketCap', 'currency',
  ].join(',')

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(joined)}&fields=${fields}&lang=en-US&region=US&corsDomain=finance.yahoo.com`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    throw new Error(`Yahoo Finance returned ${res.status}`)
  }

  const data = await res.json()
  const result: Record<string, MarketQuote> = {}

  const rawQuotes: Record<string, unknown>[] = data?.quoteResponse?.result ?? []

  for (const q of rawQuotes) {
    const sym = q.symbol as string
    result[sym] = {
      symbol: sym,
      price: (q.regularMarketPrice as number) ?? 0,
      previousClose: (q.regularMarketPreviousClose as number) ?? 0,
      changePercent: (q.regularMarketChangePercent as number) ?? 0,
      dividendYield: (q.trailingAnnualDividendYield as number | null) ?? null,
      trailingAnnualDividendRate: (q.trailingAnnualDividendRate as number | null) ?? null,
      forwardAnnualDividendRate: (q.forwardAnnualDividendRate as number | null) ?? null,
      payoutRatio: (q.payoutRatio as number | null) ?? null,
      exDividendDate: (q.exDividendDate as number | null) ?? null,
      fiftyTwoWeekHigh: (q.fiftyTwoWeekHigh as number) ?? 0,
      fiftyTwoWeekLow: (q.fiftyTwoWeekLow as number) ?? 0,
      marketCap: (q.marketCap as number | null) ?? null,
      currency: (q.currency as string) ?? 'USD',
      longName: (q.longName as string | null) ?? null,
    }
  }

  // Mark any symbols that came back empty
  for (const sym of symbols) {
    if (!result[sym]) {
      result[sym] = {
        symbol: sym, price: 0, previousClose: 0, changePercent: 0,
        dividendYield: null, trailingAnnualDividendRate: null,
        forwardAnnualDividendRate: null, payoutRatio: null, exDividendDate: null,
        fiftyTwoWeekHigh: 0, fiftyTwoWeekLow: 0, marketCap: null,
        currency: 'USD', longName: null, error: 'Not found',
      }
    }
  }

  return result
}

export async function POST(req: NextRequest) {
  try {
    const { symbols } = await req.json() as { symbols: string[] }

    if (!symbols?.length) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }

    // Yahoo has a practical limit of ~100 symbols per request; batch if needed
    const BATCH = 50
    const batches: string[][] = []
    for (let i = 0; i < symbols.length; i += BATCH) {
      batches.push(symbols.slice(i, i + BATCH))
    }

    const results = await Promise.all(batches.map(b => fetchYahooQuotes(b)))
    const merged = Object.assign({}, ...results)

    const response: MarketDataResponse = {
      quotes: merged,
      fetchedAt: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('[market route]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
