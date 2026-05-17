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
const subscribers = new Set<() => void>()

function notify() { subscribers.forEach(fn => fn()) }

function isCacheValid(coinIds: string[]): boolean {
  if (!cache) return false
  if (Date.now() - cache.cachedAt > CACHE_TTL) return false
  return coinIds.every(id => id in cache!.prices)
}

async function fetchPrices(coinIds: string[]): Promise<void> {
  if (inFlight) { await inFlight; return }

  const ids = coinIds.join(',')
  inFlight = fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
    { next: { revalidate: 300 } }
  ).then(async res => {
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
    const data = await res.json()
    const mapped: Record<string, CoinPrice> = {}
    for (const [id, val] of Object.entries(data as Record<string, any>)) {
      mapped[id] = { usd: val.usd ?? 0, usd_24h_change: val.usd_24h_change ?? null }
    }
    return mapped
  })

  try {
    const mapped = await inFlight
    cache = {
      prices: { ...(cache?.prices ?? {}), ...mapped },
      cachedAt: Date.now(),
    }
    notify()
  } finally {
    inFlight = null
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCryptoPrices() {
  const [prices, setPrices] = useState<Record<string, CoinPrice>>(cache?.prices ?? {})
  const [state, setState]   = useState<CryptoState>(cache ? 'done' : 'idle')

  useEffect(() => {
    const sync = () => {
      if (cache) { setPrices({ ...cache.prices }); setState('done') }
    }
    subscribers.add(sync)
    return () => { subscribers.delete(sync) }
  }, [])

  const refresh = useCallback(async (coinIds: string[], force = false) => {
    if (!coinIds.length) return
    if (!force && isCacheValid(coinIds)) {
      if (cache) { setPrices({ ...cache.prices }); setState('done') }
      return
    }
    setState('loading')
    try {
      await fetchPrices(coinIds)
      if (cache) setPrices({ ...cache.prices })
      setState('done')
    } catch {
      setState('error')
    }
  }, [])

  const getPrice = useCallback(
    (coinId: string, fallback: number) => prices[coinId]?.usd ?? fallback,
    [prices]
  )

  const getChange = useCallback(
    (coinId: string) => prices[coinId]?.usd_24h_change ?? null,
    [prices]
  )

  return { prices, state, refresh, getPrice, getChange }
}
