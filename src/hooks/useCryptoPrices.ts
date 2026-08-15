'use client'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { CoinPrice, CryptoResponse } from '@/app/api/crypto/route'

export type CryptoState = 'idle' | 'loading' | 'done' | 'error'
export type { CoinPrice }

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

/** True once every requested coin is present in the cache. */
const cacheCovers = (coinIds: string[]): boolean =>
  cache != null && coinIds.every(id => id in cache!.prices)

async function fetchPrices(coinIds: string[]): Promise<void> {
  // Reuse an in-flight request only when it covers every coin we need;
  // otherwise the caller would be told "done" for coins nobody fetched.
  if (inFlight && inFlightIds && coinIds.every(id => inFlightIds!.has(id))) {
    await inFlight
    return
  }
  const previous = inFlight?.catch(() => undefined) ?? Promise.resolve()

  const ids = coinIds.map(encodeURIComponent).join(',')
  // Own promise held locally — clearing `inFlight` unconditionally below could
  // wipe a newer call's promise and let a third request start instead of
  // joining it.
  const mine = previous.then(() =>
    // Proxied through our own route: called straight from the browser,
    // CoinGecko's free tier rate-limits per client and a 429 silently drops
    // crypto back to average cost.
    fetch(`/api/crypto?ids=${ids}`).then(async res => {
      const data = (await res.json().catch(() => ({}))) as Partial<CryptoResponse>
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      return data.prices ?? {}
    })
  )
  inFlight = mine
  inFlightIds = new Set(coinIds)

  try {
    const mapped = await mine
    cache = {
      prices: { ...(cache?.prices ?? {}), ...mapped },
      cachedAt: Date.now(),
    }
    notify()
  } finally {
    if (inFlight === mine) {
      inFlight = null
      inFlightIds = null
    }
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCryptoPrices() {
  const [prices, setPrices] = useState<Record<string, CoinPrice>>(cache?.prices ?? {})
  const [state, setState]   = useState<CryptoState>(cache ? 'done' : 'idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Coins *this* instance asked for, so another page's success cannot declare
  // this one done while its own coins are still missing.
  const wantedRef = useRef<string[]>([])

  useEffect(() => {
    const sync = () => {
      if (!cache) return
      setPrices({ ...cache.prices })
      const wanted = wantedRef.current
      if (wanted.length === 0) {
        setState(prev => (prev === 'idle' ? 'done' : prev))
        return
      }
      if (!cacheCovers(wanted)) return
      setErrorMsg(null)
      setState('done')
    }
    subscribers.add(sync)
    return () => { subscribers.delete(sync) }
  }, [])

  const refresh = useCallback(async (coinIds: string[], force = false) => {
    const ids = Array.from(new Set(coinIds.filter(Boolean)))
    if (!ids.length) return
    wantedRef.current = Array.from(new Set([...wantedRef.current, ...ids]))

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
    (coinId: string, fallback: number) => {
      const usd = prices[coinId]?.usd
      return usd != null && isFinite(usd) && usd > 0 ? usd : fallback
    },
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

  // Memoised so downstream useMemos keyed on this object actually hit.
  return useMemo(
    () => ({ prices, state, errorMsg, refresh, getPrice, getChange, hasPrice }),
    [prices, state, errorMsg, refresh, getPrice, getChange, hasPrice]
  )
}
