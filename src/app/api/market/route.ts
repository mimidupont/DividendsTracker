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

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ── Session/crumb ─────────────────────────────────────────────────────────────

async function getCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  try {
    const homeRes = await fetch('https://finance.yahoo.com/quote/AAPL/', {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
    })
    // Parse the set-cookie header — keep only name=value pairs, join with '; '
    const setCookie = homeRes.headers.getSetCookie?.() ?? []
    const cookie = setCookie.length
      ? setCookie.map(c => c.split(';')[0]).join('; ')
      : (homeRes.headers.get('set-cookie') ?? '')
          .split(',')
          .map(s => s.split(';')[0].trim())
          .filter(s => s.includes('='))
          .join('; ')

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

// ── Batch quote fetch (needs crumb) ──────────────────────────────────────────

async function fetchBatchQuotes(
  symbols: string[],
  crumb: string,
  cookie: string
): Promise<Record<string, unknown>[] | null> {
  const fields = [
    'symbol', 'longName', 'regularMarketPrice', 'regularMarketPreviousClose',
    'regularMarketChangePercent', 'trailingAnnualDividendYield',
    'trailingAnnualDividendRate', 'forwardAnnualDividendRate',
    'payoutRatio', 'exDividendDate', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow',
    'marketCap', 'currency',
  ].join(',')

  const url =
    `https://query2.finance.yahoo.com/v8/finance/quote` +
    `?symbols=${encodeURIComponent(symbols.join(','))}` +
    `&fields=${fields}&crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: cookie },
      next: { revalidate: 0 },
    })
    if (!res.ok) {
      console.error(`[market] batch fetch ${res.status}: ${await res.text().catch(() => '')}`)
      return null
    }
    const data = await res.json()
    return data?.quoteResponse?.result ?? null
  } catch {
    return null
  }
}

// ── Per-symbol chart fallback (no auth needed) ────────────────────────────────

async function fetchChartQuote(symbol: string): Promise<Partial<MarketQuote> | null> {
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=1d&range=5d&includePrePost=false`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      next: { revalidate: 0 },
    })
    if (!res.ok) return null
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta?.regularMarketPrice) return null

    const price: number = meta.regularMarketPrice
    const prev: number = meta.previousClose ?? meta.chartPreviousClose ?? price
    return {
      symbol,
      price,
      previousClose: prev,
      changePercent: prev ? ((price - prev) / prev) * 100 : 0,
      currency: meta.currency ?? 'USD',
      longName: meta.longName ?? meta.shortName ?? null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? 0,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? 0,
      dividendYield: null,
      trailingAnnualDividendRate: null,
      forwardAnnualDividendRate: null,
      payoutRatio: null,
      exDividendDate: null,
      marketCap: null,
    }
  } catch {
    return null
  }
}

// ── Per-symbol dividend data via quoteSummary ─────────────────────────────────

async function fetchDividendSummary(
  symbol: string,
  cookie: string
): Promise<Partial<MarketQuote> | null> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=summaryDetail`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: cookie },
      next: { revalidate: 0 },
    })
    if (!res.ok) return null
    const data = await res.json()
    const sd = data?.quoteSummary?.result?.[0]?.summaryDetail
    if (!sd) return null
    return {
      dividendYield: sd.trailingAnnualDividendYield?.raw ?? null,
      trailingAnnualDividendRate: sd.trailingAnnualDividendRate?.raw ?? null,
      forwardAnnualDividendRate: sd.dividendRate?.raw ?? null,
      exDividendDate: sd.exDividendDate?.raw ?? null,
      payoutRatio: sd.payoutRatio?.raw ?? null,
    }
  } catch {
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyQuote(symbol: string, err = 'Not found'): MarketQuote {
  return {
    symbol, price: 0, previousClose: 0, changePercent: 0,
    dividendYield: null, trailingAnnualDividendRate: null,
    forwardAnnualDividendRate: null, payoutRatio: null, exDividendDate: null,
    fiftyTwoWeekHigh: 0, fiftyTwoWeekLow: 0, marketCap: null,
    currency: 'USD', longName: null, error: err,
  }
}

function rawToQuote(q: Record<string, unknown>): MarketQuote {
  return {
    symbol: q.symbol as string,
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

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { symbols } = (await req.json()) as { symbols: string[] }
    if (!symbols?.length) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }

    const result: Record<string, MarketQuote> = {}

    // Step 1: attempt crumb-authenticated batch fetch
    const session = await getCrumb()

    if (session) {
      const BATCH = 50
      for (let i = 0; i < symbols.length; i += BATCH) {
        const batch = symbols.slice(i, i + BATCH)
        const raw = await fetchBatchQuotes(batch, session.crumb, session.cookie)
        if (raw) {
          for (const q of raw) {
            const sym = q.symbol as string
            if (sym) result[sym] = rawToQuote(q)
          }
        }
      }
    }

    // Step 2: for any symbols with no price, fall back to chart API
    const missing = symbols.filter(s => !result[s] || result[s].price === 0)
    if (missing.length > 0) {
      console.log(`[market] chart fallback for: ${missing.join(', ')}`)
      await Promise.all(
        missing.map(async sym => {
          const chart = await fetchChartQuote(sym)
          if (chart?.price) {
            // Optionally enrich dividend data via quoteSummary
            const div = session ? await fetchDividendSummary(sym, session.cookie) : null
            result[sym] = { ...emptyQuote(sym), ...chart, ...(div ?? {}) }
          } else {
            result[sym] = emptyQuote(sym)
          }
        })
      )
    }

    // Step 3: fill anything still missing
    for (const sym of symbols) {
      if (!result[sym]) result[sym] = emptyQuote(sym)
    }

    return NextResponse.json({
      quotes: result,
      fetchedAt: new Date().toISOString(),
    } satisfies MarketDataResponse)
  } catch (err) {
    console.error('[market route]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
