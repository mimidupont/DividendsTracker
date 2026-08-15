import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getYahooSession, toYahoo, fetchYahooQuoteSummary, batchedMap } from '@/lib/yahoo'
import { batchFetchSAQuotes } from '@/lib/stockanalysis'
import { toCZK, normalizeMoney, DEFAULT_FX } from '@/lib/fx'

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
    const res = await fetch('https://api.frankfurter.app/latest?from=CZK')
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
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`)
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

  // Vercel Cron sends the secret as a bearer token. When CRON_SECRET is unset
  // the route stays open, which is fine for a private deployment but should be
  // set before exposing the app.
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
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

  const today = new Date().toISOString().slice(0, 10)
  const results: Record<string, unknown> = {}

  for (const profile of profiles ?? []) {
    try {
      const [h, b, c, r] = await Promise.all([
        supabase.from('holdings').select('*').eq('profile_id', profile.id),
        supabase.from('bank_accounts').select('*').eq('profile_id', profile.id).eq('is_active', true),
        supabase.from('crypto_holdings').select('*').eq('profile_id', profile.id),
        supabase.from('real_estate').select('*').eq('profile_id', profile.id),
      ])

      const holdings = h.data ?? []
      const accounts = b.data ?? []
      const crypto = c.data ?? []
      const property = r.data ?? []

      if (holdings.length + accounts.length + crypto.length + property.length === 0) {
        results[profile.id] = { skipped: 'no positions' }
        continue
      }

      const quotes = await fetchQuotes(holdings.map(x => x.symbol))
      const coinPrices = await fetchCryptoPrices(crypto.map(x => x.coin_id))

      // ── Value each class, mirroring lib/portfolio exactly ──
      let stocksCZK = 0
      let usdLocal = 0
      let eurLocal = 0
      let czkLocal = 0
      let otherCZK = 0

      // Exposure is tracked in the quote's own units, with minor units (GBp, ZAc,
      // ILA) folded into their major currency first. normalizeMoney does that
      // fold and hands back the major-unit code, so toCZK below is given an
      // already-normalized pair and never divides by 100 a second time.
      const addExposure = (rawAmount: number, rawCurrency: string) => {
        const { amount, ccy } = normalizeMoney(rawAmount, rawCurrency)
        switch (ccy) {
          case 'USD': usdLocal += amount; break
          case 'EUR': eurLocal += amount; break
          case 'CZK': czkLocal += amount; break
          default: otherCZK += toCZK(amount, ccy, fx); break
        }
      }

      for (const holding of holdings) {
        const quote = quotes[holding.symbol]
        const price = quote?.price ?? holding.avg_price
        const currency = quote?.currency || holding.currency
        const local = price * holding.shares
        stocksCZK += toCZK(local, currency, fx)
        addExposure(local, currency)
      }

      let cashCZK = 0
      for (const account of accounts) {
        cashCZK += toCZK(account.balance, account.currency, fx)
        addExposure(account.balance, account.currency)
      }

      let cryptoCZK = 0
      for (const coin of crypto) {
        const priceUSD = coinPrices[coin.coin_id] ?? coin.avg_cost_usd
        const local = priceUSD * coin.amount
        cryptoCZK += toCZK(local, 'USD', fx)
        addExposure(local, 'USD')
      }

      let realestateCZK = 0
      for (const p of property) {
        const share = (isFinite(p.ownership_pct) ? Math.min(Math.max(p.ownership_pct, 0), 100) : 100) / 100
        const equityLocal = p.current_value * share - p.mortgage_balance * share
        realestateCZK += toCZK(equityLocal, p.currency, fx)
        addExposure(equityLocal, p.currency)
      }

      const total = stocksCZK + cashCZK + cryptoCZK + realestateCZK
      if (!isFinite(total) || total <= 0) {
        results[profile.id] = { skipped: 'non-positive total' }
        continue
      }

      const { error } = await supabase.from('portfolio_snapshots').upsert({
        profile_id: profile.id,
        snapshot_date: today,
        total_value_czk: total,
        stocks_czk: stocksCZK,
        cash_czk: cashCZK,
        crypto_czk: cryptoCZK,
        realestate_czk: realestateCZK,
        fx_usd: fx.USD ?? null,
        fx_eur: fx.EUR ?? null,
        fx_gbp: fx.GBP ?? null,
        exposure_usd_local: usdLocal,
        exposure_eur_local: eurLocal,
        exposure_czk_local: czkLocal,
        exposure_other_czk: otherCZK,
      }, { onConflict: 'profile_id,snapshot_date' })

      results[profile.id] = error
        ? { error: error.message }
        : {
            ok: true, total: Math.round(total),
            priced: Object.keys(quotes).length, of: holdings.length,
          }
    } catch (e) {
      results[profile.id] = { error: String(e) }
    }
  }

  return NextResponse.json({ date: today, profiles: results })
}
