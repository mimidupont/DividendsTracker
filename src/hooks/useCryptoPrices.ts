'use client'
import { useState, useCallback, useEffect } from 'react'

export type CryptoState = 'idle' | 'loading' | 'done' | 'error'

interface CoinPrice {
  usd: number
  usd_24h_change: number | null
}

// ─── Module-level cache ───────────────────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000

interface CryptoCache {
  prices: Record<string, CoinPrice>
  cachedAt: number
}

let cache: CryptoCache | null = null
let inFlight: Promise<Record<string, CoinPrice>> | null = null
let inFlightIds: Set<string> | null = null
const subscribers = new Set<() => void>()

function notify() { subscribers.forEach(fn => fn()) }

function isCacheValid(coinIds: string[]): boolean {
  if (!cache) return false
  if (Date.now() - cache.cachedAt > CACHE_TTL) return false
  return coinIds.every(id => id in cache!.prices)
}

async function fetchPrices(coinIds: string[]): Promise<void> {
  // Reuse an in-flight request only when it covers every coin we need;
  // otherwise the caller would be told "done" for coins nobody fetched.
  if (inFlight && inFlightIds && coinIds.every(id => inFlightIds!.has(id))) {
    await inFlight
    return
  }
  const previous = inFlight?.catch(() => undefined) ?? Promise.resolve()

  const ids = coinIds.map(encodeURIComponent).join(',')
  inFlightIds = new Set(coinIds)
  inFlight = previous.then(() =>
    fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
    ).then(async res => {
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
      const data = await res.json()
      const mapped: Record<string, CoinPrice> = {}
      for (const [id, val] of Object.entries(data as Record<string, any>)) {
        const usd = Number(val?.usd)
        // A coin id CoinGecko doesn't recognise comes back missing or zero.
        // Caching a 0 price would silently value the holding at nothing.
        if (!Number.isFinite(usd) || usd <= 0) continue
        const change = Number(val?.usd_24h_change)
        mapped[id] = { usd, usd_24h_change: Number.isFinite(change) ? change : null }
      }
      return mapped
    })
  )

  try {
    const mapped = await inFlight
    cache = {
      prices: { ...(cache?.prices ?? {}), ...mapped },
      cachedAt: Date.now(),
    }
    notify()
  } finally {
    inFlight = null
    inFlightIds = null
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCryptoPrices() {
  const [prices, setPrices] = useState<Record<string, CoinPrice>>(cache?.prices ?? {})
  const [state, setState]   = useState<CryptoState>(cache ? 'done' : 'idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    const sync = () => {
      if (cache) { setPrices({ ...cache.prices }); setState('done') }
    }
    subscribers.add(sync)
    return () => { subscribers.delete(sync) }
  }, [])

  const refresh = useCallback(async (coinIds: string[], force = false) => {
    const ids = Array.from(new Set(coinIds.filter(Boolean)))
    if (!ids.length) return
    if (!force && isCacheValid(ids)) {
      if (cache) { setPrices({ ...cache.prices }); setState('done') }
      return
    }
    setState('loading')
    setErrorMsg(null)
    try {
      await fetchPrices(ids)
      if (cache) setPrices({ ...cache.prices })
      setState('done')
    } catch (err) {
      setErrorMsg(String(err))
      setState('error')
    }
  }, [])

  const getPrice = useCallback(
    (coinId: string, fallback: number) => prices[coinId]?.usd ?? fallback,
    [prices]
  )

  /** False when we are showing the caller's fallback instead of a live price. */
  const hasPrice = useCallback(
    (coinId: string) => (prices[coinId]?.usd ?? 0) > 0,
    [prices]
  )

  const getChange = useCallback(
    (coinId: string) => prices[coinId]?.usd_24h_change ?? null,
    [prices]
  )

  return { prices, state, errorMsg, refresh, getPrice, getChange, hasPrice }
}
