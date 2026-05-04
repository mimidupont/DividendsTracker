import { NextRequest, NextResponse } from 'next/server'

// Re-export types from parent route
export interface DividendSummary {
  symbol: string
  exDividendDate: number | null    // unix timestamp
  dividendRate: number | null      // forward annual rate
  trailingAnnualDividendRate: number | null
  lastDividendValue: number | null // most recent payment amount
  lastDividendDate: number | null  // unix timestamp of last payment
  payoutFrequency: number | null   // estimated payments per year
  currency: string
  error?: string
}

export interface DividendSummaryResponse {
  summaries: Record<string, DividendSummary>
  fetchedAt: string
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

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

async function fetchQuoteSummary(
  symbol: string,
  crumb: string,
  cookie: string
): Promise<DividendSummary> {
  const empty: DividendSummary = {
    symbol, exDividendDate: null, dividendRate: null,
    trailingAnnualDividendRate: null, lastDividendValue: null,
    lastDividendDate: null, payoutFrequency: null, currency: 'USD',
  }

  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=summaryDetail,calendarEvents,defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`

    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: cookie },
      next: { revalidate: 0 },
    })
    if (!res.ok) return { ...empty, error: `HTTP ${res.status}` }

    const data = await res.json()
    const result = data?.quoteSummary?.result?.[0]
    if (!result) return { ...empty, error: 'No data' }

    const sd  = result.summaryDetail ?? {}
    const cal = result.calendarEvents ?? {}
    const ks  = result.defaultKeyStatistics ?? {}

    // exDividendDate: prefer calendarEvents (upcoming) over summaryDetail (may be past)
    const exDate =
      cal.exDividendDate?.raw ??
      sd.exDividendDate?.raw ??
      null

    // Per-payment amount: lastDividendValue from keyStatistics is the most recent actual payment
    const lastDiv = ks.lastDividendValue?.raw ?? null
    const lastDivDate = ks.lastDividendDate?.raw ?? null

    // Estimate payout frequency from trailing rate / last payment
    let freq: number | null = null
    const annualRate: number | null = sd.trailingAnnualDividendRate?.raw ?? null
    if (annualRate && lastDiv && lastDiv > 0) {
      const ratio = annualRate / lastDiv
      // Round to nearest standard frequency: 1, 2, 4, 12
      if      (ratio < 1.5)  freq = 1
      else if (ratio < 3)    freq = 2
      else if (ratio < 8)    freq = 4
      else                   freq = 12
    }

    return {
      symbol,
      exDividendDate: exDate,
      dividendRate: sd.dividendRate?.raw ?? null,
      trailingAnnualDividendRate: annualRate,
      lastDividendValue: lastDiv,
      lastDividendDate: lastDivDate,
      payoutFrequency: freq,
      currency: sd.currency ?? 'USD',
    }
  } catch (e) {
    return { ...empty, error: String(e) }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { symbols } = (await req.json()) as { symbols: string[] }
    if (!symbols?.length) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 })
    }

    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Could not establish Yahoo Finance session' }, { status: 502 })
    }

    const summaries: Record<string, DividendSummary> = {}

    // Fetch concurrently but cap at 8 at a time to avoid rate limiting
    const CONCURRENCY = 8
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY)
      const results = await Promise.all(
        batch.map(sym => fetchQuoteSummary(sym, session.crumb, session.cookie))
      )
      for (const r of results) summaries[r.symbol] = r
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
