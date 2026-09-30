import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/** Every outbound call is bounded: one hung scrape used to stall a whole batch. */
const FETCH_TIMEOUT_MS = 8000

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

/**
 * Assumed rate for the "CZK savings account" benchmark, as a decimal fraction.
 *
 * There is no market series for a savings account, so it is generated: a
 * koruna deposited on day one compounding at this rate. Change it here if your
 * bank pays something else — the UI states the rate so the number is never
 * mistaken for an observed one.
 */
const CZK_SAVINGS_APY = 0.04

/** Years of synthetic savings history to generate. */
const CZK_SAVINGS_YEARS = 5

interface Close { price_date: string; close: number }

/**
 * Fixed start of the synthetic savings index. Anchoring to "today − 5 years"
 * re-scaled every overlapping row on each sync while rows that fell out of the
 * window kept the old scale, leaving a step in the series.
 */
const CZK_SAVINGS_EPOCH = Date.UTC(2015, 0, 1)

/**
 * Synthetic daily series for a CZK savings account, compounding at
 * CZK_SAVINGS_APY from a fixed epoch (index 100 on 1 Jan 2015). Written to the
 * same table as real prices so the shadow-portfolio maths needs no special case.
 */
function czkSavingsHistory(years = CZK_SAVINGS_YEARS): Close[] {
  const daily = Math.pow(1 + CZK_SAVINGS_APY, 1 / 365)
  const out: Close[] = []
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const start = Math.max(CZK_SAVINGS_EPOCH, today.getTime() - Math.round(years * 365) * 86_400_000)
  for (let t = start; t <= today.getTime(); t += 86_400_000) {
    const daysSinceEpoch = Math.round((t - CZK_SAVINGS_EPOCH) / 86_400_000)
    out.push({
      price_date: new Date(t).toISOString().slice(0, 10),
      close: 100 * Math.pow(daily, daysSinceEpoch),
    })
  }
  return out
}

/** Per-symbol cooldown: this route is unauthenticated and each call scrapes Yahoo. */
const SYNC_COOLDOWN_MS = 10 * 60 * 1000
const lastSyncAt = new Map<string, number>()

/**
 * Daily closes from Yahoo's chart endpoint.
 *
 * This is a scrape of an undocumented endpoint, so it is expected to fail from
 * time to time. Callers degrade to whatever history is already stored rather
 * than showing an empty comparison.
 */
async function fetchHistory(
  yahooSymbol: string,
  range = '5y'
): Promise<{ closes: Close[]; currency: string | null }> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
    `?range=${range}&interval=1d`

  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`)

  const data = await res.json()
  const result = data?.chart?.result?.[0]
  const timestamps: number[] = result?.timestamp ?? []
  // Dividend-adjusted closes, so a distributing fund (SPY) is compared on total
  // return like your own side, which includes dividends. Falls back to the raw
  // close when Yahoo does not supply the adjusted series.
  const closes: (number | null)[] =
    result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close ?? []
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
  // Yahoo reports the listing's own currency. Trusting it beats the hardcoded
  // guess when a fund is cross-listed, but only for the currencies the CZK
  // conversion actually knows how to price a history in.
  const reported = String(result?.meta?.currency ?? '').toUpperCase()
  const currency = ['USD', 'EUR', 'CZK'].indexOf(reported) >= 0 ? reported : null

  return { closes: out, currency }
}

// POST /api/benchmark/sync  { symbol?: string }
export async function POST(req: NextRequest) {
  if (configError) return NextResponse.json({ error: configError }, { status: 500 })

  try {
    const body = await req.json().catch(() => ({}))
    const requested: string[] = body?.symbol
      ? [String(body.symbol).toUpperCase()]
      : [...Object.keys(BENCHMARK_YAHOO), 'CZK_SAVINGS']

    const results: Record<string, { rows: number; error?: string }> = {}

    for (const symbol of requested) {
      const entry = BENCHMARK_YAHOO[symbol]
      if (!entry && symbol !== 'CZK_SAVINGS') {
        results[symbol] = { rows: 0, error: 'unsupported benchmark' }
        continue
      }

      const last = lastSyncAt.get(symbol) ?? 0
      if (Date.now() - last < SYNC_COOLDOWN_MS) {
        results[symbol] = { rows: 0, error: 'synced in the last 10 minutes — skipped' }
        continue
      }
      lastSyncAt.set(symbol, Date.now())

      try {
        // The savings benchmark is generated, not fetched — there is no market
        // series for "money in the bank".
        const fetched = entry
          ? await fetchHistory(entry.symbol)
          : { closes: czkSavingsHistory(), currency: 'CZK' }
        const history = fetched.closes
        const currency = fetched.currency ?? entry?.currency ?? 'USD'
        if (history.length === 0) { results[symbol] = { rows: 0, error: 'no data' }; continue }

        // Upsert in chunks — a single 1200-row insert is rejected by some
        // PostgREST configurations.
        let written = 0
        for (let i = 0; i < history.length; i += 400) {
          const chunk = history.slice(i, i + 400).map(h => ({
            symbol, price_date: h.price_date, close: h.close, currency,
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
