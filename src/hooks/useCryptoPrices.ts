'use client'
import { useState, useCallback, useRef } from 'react'

export type CryptoState = 'idle' | 'loading' | 'done' | 'error'

interface CoinPrice {
  usd: number
  usd_24h_change: number | null
}

export function useCryptoPrices() {
  const [prices, setPrices] = useState<Record<string, CoinPrice>>({})
  const [state, setState] = useState<CryptoState>('idle')
  const loadingRef = useRef(false)

  const refresh = useCallback(async (coinIds: string[]) => {
    if (loadingRef.current || coinIds.length === 0) return
    loadingRef.current = true
    setState('loading')
    try {
      const ids = coinIds.join(',')
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
        { next: { revalidate: 300 } }
      )
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
      const data = await res.json()
      const mapped: Record<string, CoinPrice> = {}
      for (const [id, val] of Object.entries(data as Record<string, any>)) {
        mapped[id] = { usd: val.usd ?? 0, usd_24h_change: val.usd_24h_change ?? null }
      }
      setPrices(mapped)
      setState('done')
    } catch {
      setState('error')
    } finally {
      loadingRef.current = false
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
