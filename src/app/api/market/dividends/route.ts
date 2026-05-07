import { NextRequest, NextResponse } from 'next/server'
import { getYahooSession, toYahoo, fetchYahooQuoteSummary, batchedMap } from '@/lib/yahoo'

export interface DividendSummary {
  symbol: string
  exDividendDate: number | null
  dividendRate: number | null
  trailingAnnualDividendRate: number | null
  lastDividendValue: number | null
  lastDividendDate: number | null
  payoutFrequency: number | null
  currency: string
  error?: string
}

export interface DividendSummaryResponse {
  summaries: Record<string, DividendSummary>
  fetchedAt: string
}

async function fetchDividendSummary(
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
    const result = await fetchYahooQuoteSummary(
      toYahoo(symbol),
      'summaryDetail,calendarEvents,defaultKeyStatistics',
      crumb,
      cookie
    )
    const sd  = result.summaryDetail ?? {}
    const cal = result.calendarEvents ?? {}
    const ks  = result.defaultKeyStatistics ?? {}

    const exDate = cal.exDividendDate?.raw ?? sd.exDividendDate?.raw ?? null
    const lastDiv = ks.lastDividendValue?.raw ?? null
    const annualRate: number | null = sd.trailingAnnualDividendRate?.raw ?? null

    let freq: number | null = null
    if (annualRate && lastDiv && lastDiv > 0) {
      const ratio = annualRate / lastDiv
      freq = ratio < 1.5 ? 1 : ratio < 3 ? 2 : ratio < 8 ? 4 : 12
    }

    return {
      symbol,
      exDividendDate: exDate,
      dividendRate: sd.dividendRate?.raw ?? null,
      trailingAnnualDividendRate: annualRate,
      lastDividendValue: lastDiv,
      lastDividendDate: ks.lastDividendDate?.raw ?? null,
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

    const session = await getYahooSession()
    if (!session) {
      return NextResponse.json({ error: 'Could not establish Yahoo Finance session' }, { status: 502 })
    }

    const results = await batchedMap(symbols, 8, s => fetchDividendSummary(s, session.crumb, session.cookie))
    const summaries = Object.fromEntries(results.map(r => [r.symbol, r]))

    return NextResponse.json({ summaries, fetchedAt: new Date().toISOString() } satisfies DividendSummaryResponse)
  } catch (err) {
    console.error('[market/dividends]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
