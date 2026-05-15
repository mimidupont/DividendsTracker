'use client'
import { useState, useCallback, useRef } from 'react'
import type { MarketQuote, MarketDataResponse } from '@/app/api/market/route'

export type { MarketQuote }
export type MarketState = 'idle' | 'loading' | 'done' | 'error'

export interface UseMarketData {
  quotes: Record<string, MarketQuote>
  state: MarketState
  fetchedAt: string | null
  errorMsg: string | null
  refresh: (symbols: string[]) => Promise<void>
  getPrice: (symbol: string, fallback: number) => number
  getYield: (symbol: string) => number | null
  getAnnualDiv: (symbol: string) => number | null
}

export function useMarketData(): UseMarketData {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})
  const [state, setState] = useState<MarketState>('idle')
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const loadingRef = useRef(false)

  const refresh = useCallback(async (symbols: string[]) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setState('loading')
    setErrorMsg(null)
    try {
      const res = await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? `HTTP ${res.status}`)
      }
      const data: MarketDataResponse = await res.json()
      setQuotes(data.quotes)
      setFetchedAt(data.fetchedAt)
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
      // Prefer yield × price — most reliable across both US and European tickers.
      // Yahoo's forwardAnnualDividendRate is often wrong for non-US stocks
      // (e.g. BNP.PA returns 9.95 instead of ~3.35).
      if (q.dividendYield != null && q.price > 0) return q.dividendYield * q.price
      return q.forwardAnnualDividendRate ?? q.trailingAnnualDividendRate ?? null
    },
    [quotes]
  )

  return { quotes, state, fetchedAt, errorMsg, refresh, getPrice, getYield, getAnnualDiv }
}
