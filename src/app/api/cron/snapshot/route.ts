import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getYahooSession, toYahoo, fetchYahooQuoteSummary, batchedMap } from '@/lib/yahoo'
import { batchFetchSAQuotes } from '@/lib/stockanalysis'
import { DEFAULT_FX } from '@/lib/fx'
import { todayInZone } from '@/lib/date'
import { buildPositions, type QuoteSource, type CryptoPriceSource } from '@/lib/portfolio'
import { snapshotValues, snapshotBlockers } from '@/lib/snapshot'

/**
 * Daily portfolio snapshot, written server-side.
 *
 * Snapshots used to be written only by the browser when the dashboard was open,
 * so a week without visiting left a week-shaped hole in the P&L history — and
 * FX attribution, which needs consecutive days, never accumulated at all.
 * This route does the same work without anyone logged in.
 *
 * Schedule it with Vercel Cron (see vercel.json) or any external scheduler.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const cronSecret = process.env.CRON_SECRET

const configError = supabaseUrl && supabaseAnonKey
  ? null
  : 'Supabase is not configured on the server.'

const supabase = createClient(
  supabaseUrl ?? 'http://localhost:54321',
  supabaseAnonKey ?? 'missing-anon-key'
)

/** Per-profile time budget; one slow provider must not eat the whole 60 s run. */
const PROFILE_BUDGET_MS = 20_000
/** Stop starting new profiles once this much of maxDuration has gone. */
const RUN_DEADLINE_MS = 50_000

// ─── Market data, server-side ─────────────────────────────────────────────────

interface Quote { price: number; currency: string }

async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {}
  if (symbols.length === 0) return out

  const sa = await batchFetchSAQuotes(symbols, 6)
  for (const s of symbols) {
    const q = sa[s]
    if (q && !q.error && q.price) out[s] = { price: q.price, currency: q.currency }
  }

  const needsYahoo = symbols.filter(s => !out[s])
  if (needsYahoo.length > 0) {
    const session = await getYahooSession()
    if (session) {
      const results = await batchedMap(needsYahoo, 8, async (symbol) => {
        try {
          const r = await fetchYahooQuoteSummary(
            toYahoo(symbol), 'price', session.crumb, session.cookie)
          const price = r.price?.regularMarketPrice?.raw ?? 0
          return { symbol, price, currency: r.price?.currency ?? '' }
        } catch {
          return { symbol, price: 0, currency: '' }
        }
      })
      for (const r of results) {
        if (r.price > 0) out[r.symbol] = { price: r.price, currency: r.currency }
      }
    }
  }

  return out
}

async function fetchFx(): Promise<Record<string, number>> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=CZK', {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
    const data = await res.json()
    const rates: Record<string, number> = { CZK: 1 }
    for (const [ccy, rate] of Object.entries(data.rates as Record<string, number>)) {
      const r = Number(rate)
      if (isFinite(r) && r > 0) rates[ccy.toUpperCase()] = 1 / r
    }
    return { ...DEFAULT_FX, ...rates }
  } catch {
    // A snapshot struck at fallback rates would sit in the history as a step
    // change that never happened. Signal failure instead.
    return {}
  }
}

async function fetchCryptoPrices(coinIds: string[]): Promise<Record<string, number>> {
  if (coinIds.length === 0) return {}
  try {
    const ids = coinIds.map(encodeURIComponent).join(',')
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
    const data = await res.json()
    const out: Record<string, number> = {}
    for (const [id, val] of Object.entries(data as Record<string, { usd?: number }>)) {
      const usd = Number(val?.usd)
      if (isFinite(usd) && usd > 0) out[id] = usd
    }
    return out
  } catch {
    return {}
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (configError) return NextResponse.json({ error: configError }, { status: 500 })

  // Fail closed. This route writes to the database for every profile, so an
  // unset secret used to leave it open to anyone who knew the deployment URL —
  // "open unless configured" is the wrong default for a write endpoint.
  if (!cronSecret) {
    return NextResponse.json(
      {
        error: 'CRON_SECRET is not set. Set it in the environment (Vercel sends it ' +
          'as a bearer token automatically) — this endpoint writes data and will ' +
          'not run unauthenticated.',
      },
      { status: 503 }
    )
  }

  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const fx = await fetchFx()
  if (!fx.USD) {
    return NextResponse.json(
      { error: 'FX unavailable — skipping rather than recording a snapshot at stale rates' },
      { status: 503 }
    )
  }

  const { data: profiles, error: profileErr } = await supabase.from('profiles').select('id, name')
  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })

  const today = todayInZone()
  const results: Record<string, unknown> = {}
  const started = Date.now()

  for (const profile of profiles ?? []) {
    if (Date.now() - started > RUN_DEADLINE_MS) {
      results[profile.id] = { skipped: 'run deadline reached — will be picked up next run' }
      continue
    }
    try {
      results[profile.id] = await withTimeout(
        snapshotProfile(profile.id, fx, today), PROFILE_BUDGET_MS)
    } catch (e) {
      results[profile.id] = { error: String(e) }
    }
  }

  return NextResponse.json({ date: today, profiles: results })
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)),
  ])
}

/** Missing-table errors (a migration not run yet) are treated as "no rows". */
const rowsOrEmpty = <T,>(res: { data: T[] | null; error: { code?: string; message?: string } | null }): T[] => {
  if (!res.error) return res.data ?? []
  const code = res.error.code
  if (code === '42P01' || code === 'PGRST205') return []
  throw new Error(res.error.message)
}

async function snapshotProfile(
  profileId: string, fx: Record<string, number>, today: string
): Promise<Record<string, unknown>> {
  const [h, b, c, r, bonds, meta] = await Promise.all([
    supabase.from('holdings').select('*').eq('profile_id', profileId),
    supabase.from('bank_accounts').select('*').eq('profile_id', profileId).eq('is_active', true),
    supabase.from('crypto_holdings').select('*').eq('profile_id', profileId),
    supabase.from('real_estate').select('*').eq('profile_id', profileId),
    supabase.from('bond_holdings').select('*').eq('profile_id', profileId).eq('is_active', true),
    supabase.from('asset_metadata').select('*').eq('profile_id', profileId),
  ])

  const holdings = rowsOrEmpty(h)
  const accounts = rowsOrEmpty(b)
  const crypto = rowsOrEmpty(c)
  const property = rowsOrEmpty(r)
  const bondRows = rowsOrEmpty(bonds)
  const metadata = rowsOrEmpty(meta)

  if (holdings.length + accounts.length + crypto.length + property.length + bondRows.length === 0) {
    return { skipped: 'no positions' }
  }

  const quotes = await fetchQuotes(holdings.map(x => x.symbol))
  const coinPrices = await fetchCryptoPrices(crypto.map(x => x.coin_id))

  // The same position model the dashboard uses — the two writers used to have
  // their own valuation loops and could disagree about the same day.
  const market: QuoteSource = {
    getPrice: (s, fallback) => quotes[s]?.price ?? fallback,
    getQuoteCurrency: (s, fallback) => quotes[s]?.currency || fallback,
    getAnnualDiv: () => null,
    hasPrice: s => (quotes[s]?.price ?? 0) > 0,
    quotes: {},
  }
  const cryptoSource: CryptoPriceSource = {
    getPrice: (id, fallback) => coinPrices[id] ?? fallback,
    hasPrice: id => (coinPrices[id] ?? 0) > 0,
  }
  const positions = buildPositions({
    holdings, bankAccounts: accounts, cryptoHoldings: crypto, realEstate: property,
    bondHoldings: bondRows, assetMetadata: metadata,
  }, fx, market, cryptoSource, today)

  // A provider outage must not overwrite today's good browser snapshot with
  // positions valued at cost.
  const missing = snapshotBlockers(positions)
  if (missing.length > 0) {
    return { skipped: 'incomplete prices', missing }
  }

  const values = snapshotValues(positions, fx)
  if (!isFinite(values.total_value_czk)) return { skipped: 'non-finite total' }

  const row = { profile_id: profileId, snapshot_date: today, ...values, unpriced_count: 0 }
  let { error } = await supabase.from('portfolio_snapshots').upsert(row, { onConflict: 'profile_id,snapshot_date' })
  // Before migrations 010/011 the newer columns do not exist; write what fits.
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    const { bonds_czk, exposure_gbp_local, unpriced_count, ...legacy } = row
    void bonds_czk; void exposure_gbp_local; void unpriced_count
    ;({ error } = await supabase.from('portfolio_snapshots').upsert(
      { ...legacy, stocks_czk: legacy.stocks_czk + values.bonds_czk },
      { onConflict: 'profile_id,snapshot_date' }))
  }

  return error
    ? { error: error.message }
    : { ok: true, total: Math.round(values.total_value_czk), priced: Object.keys(quotes).length, of: holdings.length }
}
