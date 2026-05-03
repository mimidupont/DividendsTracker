import { NextRequest, NextResponse } from 'next/server'

export interface MarketQuote {
  symbol: string
  price: number
  previousClose: number
  changePercent: number
  dividendYield: number | null
  trailingAnnualDividendRate: number | null
  forwardAnnualDividendRate: number | null
  payoutRatio: number | null
  exDividendDate: number | null
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

const YF_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

/**
 * Fetch a crumb + cookie from Yahoo Finance.
 * Yahoo now requires a valid session crumb for API calls.
 */
async function getYahooCrumb(): Promise<{ crumb: string; cookie: string }> {
  // Hit the consent/home page to get a cookie
  const consentRes = await fetch('https://finance.yahoo.com/', {
    headers: YF_HEADERS,
    redirect: 'follow',
  })

  const cookie = consentRes.headers.get('set-cookie') ?? ''

  // Now fetch the crumb endpoint
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      ...YF_HEADERS,
      Cookie: cookie,
    },
  })

  if (!crumbRes.ok) {
    throw new Error(`Crumb fetch failed: ${crumbRes.status}`)
  }

  const crumb = await crumbRes.text()
  if (!crumb || crumb.includes('<')) {
    throw new Error('Invalid crumb response')
  }

  return { crumb: crumb.trim(), cookie }
}

async function fetchYahooQuotes(
  symbols: string[],
  crumb: string,
  cookie: string
): Promise<Record<string, MarketQuote>> {
  const joined = symbols.join(',')
  const fields = [
    'symbol',
    'longName',
    'regularMarketPrice',
    'regularMarketPreviousClose',
    'regularMarketChangePercent',
    'trailingAnnualDividendYield',
    'trailingAnnualDividendRate',
    'forwardAnnualDividendRate',
    'payoutRatio',
    'exDividendDate',
    'fiftyTwoWeekHigh',
    'fiftyTwoWeekLow',
    'marketCap',
    'currency',
  ].join(',')

  const url =
    `https://query2.finance.yahoo.com/v8/finance/quote` +
    `?symbols=${encodeURIComponent(joined)}` +
    `&fields=${fields}` +
    `&crumb=${encodeURIComponent(crumb)}` +
    `&lang=en-US&region=US`

  const res = await fetch(url, {
    headers: {
      ...YF_HEADERS,
      Accept: 'application/json',
      Cookie: cookie,
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    throw new Error(`Yahoo Finance returned ${res.status}`)
  }

  const data = await res.json()
  const result: Record<string, MarketQuote> = {}

  const rawQuotes: Record<string, unknown>[] =
    data?.quoteResponse?.result ?? []

  for (const q of rawQuotes) {
    const sym = q.symbol as string
    result[sym] = {
      symbol: sym,
      price: (q.regularMarketPrice as number) ?? 0,
      previousClose: (q.regularMarketPreviousClose as number) ?? 0,
      changePercent: (q.regularMarketChangePercent as number) ?? 0,
      dividendYield: (q.trailingAnnualDividendYield as number | null) ?? null,
      trailingAnnualDividendRate:
        (q.trailingAnnualDividendRate as number | null) ?? null,
      forwardAnnualDividendRate:
        (q.forwardAnnualDividendRate as number | null) ?? null,
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
        symbol: sym,
        price: 0,
        previousClose: 0,
        changePercent: 0,
        dividendYield: null,
        trailingAnnualDividendRate: null,
        forwardAnnualDividendRate: null,
        payoutRatio: null,
        exDividendDate: null,
        fiftyTwoWeekHigh: 0,
        fiftyTwoWeekLow: 0,
        marketCap: null,
        currency: 'USD',
        longName: null,
        error: 'Not found',
      }
    }
  }

  return result
}

export async function POST(req: NextRequest) {
  try {
    const { symbols } = (await req.json()) as { symbols: string[] }

    if (!symbols?.length) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }

    // Get crumb + cookie first
    const { crumb, cookie } = await getYahooCrumb()

    // Batch into groups of 50
    const BATCH = 50
    const batches: string[][] = []
    for (let i = 0; i < symbols.length; i += BATCH) {
      batches.push(symbols.slice(i, i + BATCH))
    }

    const results = await Promise.all(
      batches.map(b => fetchYahooQuotes(b, crumb, cookie))
    )
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
