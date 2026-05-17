'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import type { MarketQuote, MarketDataResponse } from '@/app/api/market/route'

export type { MarketQuote }
export type MarketState = 'idle' | 'loading' | 'done' | 'error'

// ─── Module-level cache (survives page navigation) ────────────────────────────
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

interface MarketCache {
  quotes: Record<string, MarketQuote>
  fetchedAt: string
  cachedAt: number
  symbols: string[]
}

let cache: MarketCache | null = null
let inFlight: Promise<MarketDataResponse> | null = null
// Subscribers so all mounted hook instances re-render when cache updates
const subscribers = new Set<() => void>()

function notify() {
  subscribers.forEach(fn => fn())
}

function isCacheValid(symbols: string[]): boolean {
  if (!cache) return false
  if (Date.now() - cache.cachedAt > CACHE_TTL) return false
  // Valid if all requested symbols are already cached
  return symbols.every(s => s in cache!.quotes)
}

async function fetchMarketData(symbols: string[]): Promise<void> {
  // Deduplicate with any in-flight request
  if (inFlight) {
    await inFlight
    return
  }

  inFlight = fetch('/api/market', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols }),
  }).then(async res => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error ?? `HTTP ${res.status}`)
    }
    return res.json() as Promise<MarketDataResponse>
  })

  try {
    const data = await inFlight
    // Merge into existing cache rather than replacing — preserves previously
    // fetched symbols that aren't in this batch
    cache = {
      quotes: { ...(cache?.quotes ?? {}), ...data.quotes },
      fetchedAt: data.fetchedAt,
      cachedAt: Date.now(),
      symbols: [...new Set([...(cache?.symbols ?? []), ...symbols])],
    }
    notify()
  } finally {
    inFlight = null
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseMarketData {
  quotes: Record<string, MarketQuote>
  state: MarketState
  fetchedAt: string | null
  errorMsg: string | null
  refresh: (symbols: string[], force?: boolean) => Promise<void>
  getPrice: (symbol: string, fallback: number) => number
  getYield: (symbol: string) => number | null
  getAnnualDiv: (symbol: string) => number | null
}

export function useMarketData(): UseMarketData {
  // Initialise from cache so pages that mount after the first fetch are instant
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>(
    cache?.quotes ?? {}
  )
  const [state, setState] = useState<MarketState>(
    cache ? 'done' : 'idle'
  )
  const [fetchedAt, setFetchedAt] = useState<string | null>(
    cache?.fetchedAt ?? null
  )
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const loadingRef = useRef(false)

  // Subscribe to cache updates (e.g. another page's refresh)
  useEffect(() => {
    const sync = () => {
      if (cache) {
        setQuotes({ ...cache.quotes })
        setFetchedAt(cache.fetchedAt)
        setState('done')
      }
    }
    subscribers.add(sync)
    return () => { subscribers.delete(sync) }
  }, [])

  const refresh = useCallback(async (symbols: string[], force = false) => {
    if (!symbols.length) return
    if (!force && isCacheValid(symbols)) {
      // Already cached — just make sure local state reflects it
      if (cache) {
        setQuotes({ ...cache.quotes })
        setFetchedAt(cache.fetchedAt)
        setState('done')
      }
      return
    }
    if (loadingRef.current) return
    loadingRef.current = true
    setState('loading')
    setErrorMsg(null)
    try {
      await fetchMarketData(symbols)
      if (cache) {
        setQuotes({ ...cache.quotes })
        setFetchedAt(cache.fetchedAt)
      }
      setState('done')
    } catch (err) {
      setErrorMsg(String(err))
      setState('error')
    } finally {
      loadingRef.current = false
    }
  }, [])

  const getPrice = useCallback(
    (symbol: string, fallback: number) => quotes[symbol]?.price || fallback,
    [quotes]
  )

  const getYield = useCallback(
    (symbol: string) => quotes[symbol]?.dividendYield ?? null,
    [quotes]
  )

  const getAnnualDiv = useCallback(
    (symbol: string) => {
      const q = quotes[symbol]
      if (!q) return null
      if (q.dividendYield != null && q.price > 0) return q.dividendYield * q.price
      return q.forwardAnnualDividendRate ?? q.trailingAnnualDividendRate ?? null
    },
    [quotes]
  )

  return { quotes, state, fetchedAt, errorMsg, refresh, getPrice, getYield, getAnnualDiv }
}
