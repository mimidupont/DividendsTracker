import { NextRequest, NextResponse } from 'next/server'

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

const YAHOO_SYMBOL_MAP: Record<string, string> = {
  SPY5:  'SPY5.L',
  SPYW:  'SPYW.DE',
  CSG1:  'CSG1.AS',
  ERBAG: 'ERBAG.PR',
  MONET: 'MONET.PR',
}

const toYahoo = (symbol: string) => YAHOO_SYMBOL_MAP[symbol] ?? symbol

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

async function getSession(): Promise<{ crumb: string; cookie: string } | null> {
  try {
    const homeRes = await fetch('https://finance.yahoo.com/quote/AAPL/', {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
    })
    const setCookies: string[] =
      typeof (homeRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (homeRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : (homeRes.headers.get('set-cookie') ?? '').split(',')
    const cookie = setCookies.map(c => c.split(';')[0].trim()).filter(c => c.includes('=')).join('; ')

    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: cookie },
    })
    if (!crumbRes.ok) return null
    const crumb = (await crumbRes.text()).trim()
    if (!crumb || crumb.startsWith('<') || crumb.length > 20) return null
    return { crumb, cookie }
  } catch {
    return null
  }
}

async function fetchQuote(
  symbol: string,
  crumb: string,
  cookie: string
): Promise<{ symbol: string } & MarketQuote> {
  const empty = {
    symbol,
    price: 0,
    changePercent: null,
    dividendYield: null,
    forwardAnnualDividendRate: null,
    trailingAnnualDividendRate: null,
    currency: 'USD',
  }

  try {
    const yahooSymbol = toYahoo(symbol)
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}` +
      `?modules=price,summaryDetail,defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`

    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: cookie },
      next: { revalidate: 0 },
    })
    if (!res.ok) return empty

    const data = await res.json()
    const result = data?.quoteSummary?.result?.[0]
    if (!result) return empty

    const price  = result.price ?? {}
    const sd     = result.summaryDetail ?? {}
    const ks     = result.defaultKeyStatistics ?? {}

    const regularPrice: number = price.regularMarketPrice?.raw ?? 0
    if (!regularPrice) return empty

    return {
      symbol,
      price: regularPrice,
      changePercent: price.regularMarketChangePercent?.raw ?? null,
      dividendYield: sd.trailingAnnualDividendYield?.raw ?? price.dividendYield?.raw ?? null,
      forwardAnnualDividendRate: sd.dividendRate?.raw ?? null,
      trailingAnnualDividendRate: sd.trailingAnnualDividendRate?.raw ?? null,
      currency: price.currency ?? sd.currency ?? 'USD',
      longName: price.longName ?? price.shortName ?? undefined,
    }
  } catch {
    return empty
  }
}

export async function POST(req: NextRequest) {
  try {
    const { symbols } = (await req.json()) as { symbols: string[] }
    if (!symbols?.length) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }

    const quotes: Record<string, MarketQuote> = {}

    const session = await getSession()
    if (!session) {
      // Session failed — return price:0 for all, UI falls back to avg_price via getPrice()
      for (const sym of symbols) {
        quotes[sym] = {
          price: 0, changePercent: null, dividendYield: null,
          forwardAnnualDividendRate: null, trailingAnnualDividendRate: null, currency: 'USD',
        }
      }
      return NextResponse.json({ quotes, fetchedAt: new Date().toISOString() } satisfies MarketDataResponse)
    }

    const CONCURRENCY = 8
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY)
      const results = await Promise.all(
        batch.map(sym => fetchQuote(sym, session.crumb, session.cookie))
      )
      for (const r of results) {
        const { symbol, ...quote } = r
        quotes[symbol] = quote
      }
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
