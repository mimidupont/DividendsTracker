import { NextRequest, NextResponse } from 'next/server'

/**
 * Crypto spot prices, proxied.
 *
 * Called from the browser directly, CoinGecko's free tier is rate-limited per
 * client IP and returns 429 often enough that crypto silently fell back to
 * average cost — which in turn blocks the daily snapshot from being written.
 * Going through the server gets us a shared cache and a retry, and keeps this
 * consistent with every other market-data path in the app.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** Cache window shared by every visitor of the deployment. */
const REVALIDATE_SECONDS = 300

export interface CoinPrice {
  usd: number
  usd_24h_change: number | null
}

export interface CryptoResponse {
  prices: Record<string, CoinPrice>
  fetchedAt: string
  error?: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchCoinGecko(ids: string[]): Promise<Record<string, CoinPrice>> {
  const url =
    'https://api.coingecko.com/api/v3/simple/price' +
    `?ids=${ids.map(encodeURIComponent).join(',')}` +
    '&vs_currencies=usd&include_24hr_change=true'

  let lastError = ''
  // Two quick retries on the rate limit; beyond that the caller degrades to
  // average cost rather than blocking the page.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * attempt)
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      next: { revalidate: REVALIDATE_SECONDS },
    })
    if (res.status === 429) { lastError = 'CoinGecko 429 (rate limited)'; continue }
    if (!res.ok) { lastError = `CoinGecko ${res.status}`; continue }

    const data = await res.json()
    const out: Record<string, CoinPrice> = {}
    for (const [id, val] of Object.entries(data as Record<string, any>)) {
      const usd = Number(val?.usd)
      // An id CoinGecko does not recognise comes back missing or zero. Caching
      // a 0 would value the holding at nothing, which is worse than no price.
      if (!Number.isFinite(usd) || usd <= 0) continue
      const change = Number(val?.usd_24h_change)
      out[id] = { usd, usd_24h_change: Number.isFinite(change) ? change : null }
    }
    return out
  }
  throw new Error(lastError || 'CoinGecko unavailable')
}

// GET /api/crypto?ids=bitcoin,ethereum
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('ids') ?? ''
  const ids = Array.from(new Set(raw.split(',').map(s => s.trim()).filter(Boolean)))

  if (ids.length === 0) {
    return NextResponse.json<CryptoResponse>({ prices: {}, fetchedAt: new Date().toISOString() })
  }

  try {
    const prices = await fetchCoinGecko(ids)
    return NextResponse.json<CryptoResponse>({
      prices,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[api/crypto]', err)
    return NextResponse.json<CryptoResponse>(
      { prices: {}, fetchedAt: new Date().toISOString(), error: String(err) },
      { status: 502 }
    )
  }
}
