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

// ── Session / crumb ───────────────────────────────────────────────────────────

async function getSession(): Promise<{ crumb: string; cookie: string } | null> {
  try {
    const homeRes = await fetch('https://finance.yahoo.com/quote/AAPL/', {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
    })
    // Use getSetCookie() (Node 18+) with fallback
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

// ── Batch price/quote fetch ───────────────────────────────────────────────────

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
      console.error(`[market] batch ${res.status}`)
      return null
    }
    const data = await res.json()
    return data?.quoteResponse?.result ?? null
  } catch {
    return null
  }
}

// ── Per-symbol chart fallback (no auth) ───────────────────────────────────────

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

// ── quoteSummary — reliable dividend data ─────────────────────────────────────
// Yahoo's v8/finance/quote often returns null for dividend fields even for
// known payers. quoteSummary?modules=summaryDetail is the reliable source.

async function fetchDividendSummary(
  symbol: string,
  cookie: string,
  crumb: string
): Promise<Partial<MarketQuote> | null> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=summaryDetail&crumb=${encodeURIComponent(crumb)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: cookie },
      next: { revalidate: 0 },
    })
    if (!res.ok) return null
    const data = await res.json()
    const sd = data?.quoteSummary?.result?.[0]?.summaryDetail
    if (!sd) return null

    // Yahoo returns yield as decimal (0.0174 = 1.74%) in summaryDetail
    const yieldRaw: number | null = sd.trailingAnnualDividendYield?.raw ?? null
    const rateRaw: number | null  = sd.trailingAnnualDividendRate?.raw ?? null
    const fwdRate: number | null  = sd.dividendRate?.raw ?? null

    return {
      // Only override if the batch quote gave us nothing
      dividendYield: yieldRaw,
      trailingAnnualDividendRate: rateRaw,
      forwardAnnualDividendRate: fwdRate,
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

    // Step 1: get Yahoo session
    const session = await getSession()

    // Step 2: batch price fetch
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

    // Step 3: chart fallback for any symbol that got no price
    const noPriceSymbols = symbols.filter(s => !result[s] || result[s].price === 0)
    if (noPriceSymbols.length > 0) {
      console.log(`[market] chart fallback for: ${noPriceSymbols.join(', ')}`)
      await Promise.all(
        noPriceSymbols.map(async sym => {
          const chart = await fetchChartQuote(sym)
          result[sym] = chart?.price
            ? { ...emptyQuote(sym), ...chart }
            : emptyQuote(sym)
        })
      )
    }

    // Step 4: enrich dividend data via quoteSummary for ALL symbols that
    // are missing yield — Yahoo's quote endpoint frequently omits these fields
    // even for confirmed dividend payers like HPQ, O, KO, etc.
    if (session) {
      const noDivSymbols = symbols.filter(s => result[s] && result[s].dividendYield === null)
      if (noDivSymbols.length > 0) {
        console.log(`[market] enriching dividend data for: ${noDivSymbols.join(', ')}`)
        await Promise.all(
          noDivSymbols.map(async sym => {
            const div = await fetchDividendSummary(sym, session.cookie, session.crumb)
            if (div && result[sym]) {
              result[sym] = { ...result[sym], ...div }
            }
          })
        )
      }
    }

    // Step 5: fill any still-missing symbols
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
