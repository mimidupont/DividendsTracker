'use client'
import { useState, useCallback, useEffect } from 'react'
import { DEFAULT_FX, fetchFxRates } from '@/lib/fx'

// Module-level cache — shared across all useFx() instances
let cachedRates: Record<string, number> | null = null
let cachedAt: number | null = null
let inFlight: Promise<Record<string, number>> | null = null
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

async function getOrFetchRates(): Promise<Record<string, number>> {
  const now = Date.now()
  if (cachedRates && cachedAt && now - cachedAt < CACHE_TTL) {
    return cachedRates
  }
  if (inFlight) return inFlight
  inFlight = fetchFxRates().then(rates => {
    cachedRates = rates
    cachedAt = Date.now()
    inFlight = null
    return rates
  })
  return inFlight
}

export function useFx() {
  const [fx, setFx] = useState(cachedRates ?? DEFAULT_FX)
  const [fxLoading, setFxLoading] = useState(false)
  const [fxTs, setFxTs] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setFxLoading(true)
    const rates = await getOrFetchRates()
    setFx(rates)
    setFxTs(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    setFxLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { fx, fxLoading, fxTs, refresh }
}