'use client'
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
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
let inFlightSymbols: Set<string> | null = null
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
  // Deduplicate with an in-flight request, but only when it already covers
  // every symbol we need — otherwise a page asking for extra tickers would
  // silently get the other page's narrower result.
  if (inFlight && inFlightSymbols && symbols.every(s => inFlightSymbols!.has(s))) {
    await inFlight
    return
  }
  // Serialise behind any request already running so the two responses cannot
  // interleave and clobber each other's cache write.
  const previous = inFlight?.catch(() => undefined) ?? Promise.resolve()

  // Hold our own promise locally. Clearing `inFlight` unconditionally in the
  // finally block could wipe a *newer* call's promise: A and B overlap, B sets
  // inFlight = PB, then A finishes and nulls it, so a later C sees null and
  // starts a third request instead of joining B.
  const mine = previous.then(() =>
    fetch('/api/market', {
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
  )
  inFlight = mine
  inFlightSymbols = new Set(symbols)

  try {
    const data = await mine
    // Merge into existing cache rather than replacing — preserves previously
    // fetched symbols that aren't in this batch
    cache = {
      quotes: { ...(cache?.quotes ?? {}), ...data.quotes },
      fetchedAt: data.fetchedAt,
      cachedAt: Date.now(),
      symbols: Array.from(new Set([...(cache?.symbols ?? []), ...symbols])),
    }
    notify()
  } finally {
    if (inFlight === mine) {
      inFlight = null
      inFlightSymbols = null
    }
  }
}

/** True once every symbol in `symbols` is present in the cache. */
const cacheCovers = (symbols: string[]): boolean =>
  cache != null && symbols.every(s => s in cache!.quotes)

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
  /** Currency the live quote is priced in, or `fallback` when unknown. */
  getQuoteCurrency: (symbol: string, fallback: string) => string
  /** True when this symbol has a live price (not the caller's fallback). */
  hasPrice: (symbol: string) => boolean
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
  // The symbols *this* instance asked for, so a cache update from another page
  // cannot declare this one finished when its own tickers are still missing.
  const wantedRef = useRef<string[]>([])

  // Subscribe to cache updates (e.g. another page's refresh)
  useEffect(() => {
    const sync = () => {
      if (!cache) return
      setQuotes({ ...cache.quotes })
      setFetchedAt(cache.fetchedAt)
      // Only claim success when the symbols this instance requested are
      // actually present. Forcing 'done' on every cache write flipped a page
      // from 'error' to "✓ Live" while its own quotes were still missing.
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

  const refresh = useCallback(async (symbols: string[], force = false) => {
    if (!symbols.length) return
    wantedRef.current = Array.from(new Set([...wantedRef.current, ...symbols]))

    if (!force && isCacheValid(symbols)) {
      // Already cached — just make sure local state reflects it
      if (cache) {
        setQuotes({ ...cache.quotes })
        setFetchedAt(cache.fetchedAt)
        setState('done')
      }
      return
    }

    setState('loading')
    setErrorMsg(null)
    try {
      // No in-flight guard here: fetchMarketData already serialises requests on
      // a module-level chain. Dropping a second call with a *different* symbol
      // list meant those tickers went unfetched until the TTL expired, while
      // the caller's await resolved as though it had succeeded.
      await fetchMarketData(symbols)
      if (cache) {
        setQuotes({ ...cache.quotes })
        setFetchedAt(cache.fetchedAt)
      }
      setState('done')
    } catch (err) {
      setErrorMsg(String(err))
      setState('error')
    }
  }, [])

  // `??` not `||`: a genuine 0 is not a missing price. hasPrice's `> 0` test
  // still treats 0 as "no live quote", and the two must not drift apart.
  const getPrice = useCallback(
    (symbol: string, fallback: number) => {
      const price = quotes[symbol]?.price
      return price != null && isFinite(price) && price > 0 ? price : fallback
    },
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
      // Prefer the declared annual rate. Deriving it from yield × price is a
      // second-order estimate: the yield is usually trailing while the price is
      // live, so the product drifts from what the company actually pays.
      const rate = q.forwardAnnualDividendRate ?? q.trailingAnnualDividendRate
      if (rate != null && isFinite(rate) && rate > 0) return rate
      if (q.dividendYield != null && q.price > 0) return q.dividendYield * q.price
      return null
    },
    [quotes]
  )

  const getQuoteCurrency = useCallback(
    (symbol: string, fallback: string) => quotes[symbol]?.currency || fallback,
    [quotes]
  )

  const hasPrice = useCallback(
    (symbol: string) => (quotes[symbol]?.price ?? 0) > 0,
    [quotes]
  )

  // Memoised: a fresh object literal every render broke every downstream
  // useMemo keyed on `market`, which on the dashboard cascaded all the way to
  // the snapshot-saving effect firing on every single render.
  return useMemo(
    () => ({
      quotes, state, fetchedAt, errorMsg, refresh,
      getPrice, getYield, getAnnualDiv, getQuoteCurrency, hasPrice,
    }),
    [quotes, state, fetchedAt, errorMsg, refresh,
      getPrice, getYield, getAnnualDiv, getQuoteCurrency, hasPrice]
  )
}
