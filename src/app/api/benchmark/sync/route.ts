import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const configError = supabaseUrl && supabaseAnonKey
  ? null
  : 'Supabase is not configured on the server.'

const supabase = createClient(
  supabaseUrl ?? 'http://localhost:54321',
  supabaseAnonKey ?? 'missing-anon-key'
)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** Yahoo symbol for each benchmark we support. */
const BENCHMARK_YAHOO: Record<string, { symbol: string; currency: string }> = {
  SPY:  { symbol: 'SPY',      currency: 'USD' },
  IWDA: { symbol: 'IWDA.AS',  currency: 'USD' },
  URTH: { symbol: 'URTH',     currency: 'USD' },
}

interface Close { price_date: string; close: number }

/**
 * Daily closes from Yahoo's chart endpoint.
 *
 * This is a scrape of an undocumented endpoint, so it is expected to fail from
 * time to time. Callers degrade to whatever history is already stored rather
 * than showing an empty comparison.
 */
async function fetchHistory(yahooSymbol: string, range = '5y'): Promise<Close[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
    `?range=${range}&interval=1d`

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`)

  const data = await res.json()
  const result = data?.chart?.result?.[0]
  const timestamps: number[] = result?.timestamp ?? []
  const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? []
  if (timestamps.length === 0) throw new Error('No history returned')

  const out: Close[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i]
    if (close == null || !isFinite(close) || close <= 0) continue
    out.push({
      price_date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      close,
    })
  }
  return out
}

// POST /api/benchmark/sync  { symbol?: string }
export async function POST(req: NextRequest) {
  if (configError) return NextResponse.json({ error: configError }, { status: 500 })

  try {
    const body = await req.json().catch(() => ({}))
    const requested: string[] = body?.symbol
      ? [String(body.symbol).toUpperCase()]
      : Object.keys(BENCHMARK_YAHOO)

    const results: Record<string, { rows: number; error?: string }> = {}

    for (const symbol of requested) {
      const entry = BENCHMARK_YAHOO[symbol]
      if (!entry) { results[symbol] = { rows: 0, error: 'unsupported benchmark' }; continue }

      try {
        const history = await fetchHistory(entry.symbol)
        if (history.length === 0) { results[symbol] = { rows: 0, error: 'no data' }; continue }

        // Upsert in chunks — a single 1200-row insert is rejected by some
        // PostgREST configurations.
        let written = 0
        for (let i = 0; i < history.length; i += 400) {
          const chunk = history.slice(i, i + 400).map(h => ({
            symbol, price_date: h.price_date, close: h.close, currency: entry.currency,
          }))
          const { error } = await supabase
            .from('benchmark_prices')
            .upsert(chunk, { onConflict: 'symbol,price_date' })
          if (error) throw new Error(error.message)
          written += chunk.length
        }
        results[symbol] = { rows: written }
      } catch (e) {
        results[symbol] = { rows: 0, error: String(e) }
      }
    }

    return NextResponse.json({ results, syncedAt: new Date().toISOString() })
  } catch (err) {
    console.error('[benchmark/sync]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
