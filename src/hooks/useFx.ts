'use client'
import { useState, useCallback, useEffect } from 'react'
import { DEFAULT_FX, fetchFxRates, type FxResult } from '@/lib/fx'

// Module-level cache — shared across all useFx() instances
let cached: FxResult | null = null
let cachedAt: number | null = null
let inFlight: Promise<FxResult> | null = null
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

// All mounted hooks re-render when the shared cache changes
const subscribers = new Set<(r: FxResult) => void>()

async function getOrFetchRates(force = false): Promise<FxResult> {
  const now = Date.now()
  // Only a successful fetch is worth caching — a failed one must not pin the
  // fallback rates in place for an hour.
  if (!force && cached?.live && cachedAt && now - cachedAt < CACHE_TTL) {
    return cached
  }
  if (inFlight) return inFlight
  inFlight = fetchFxRates()
    .then(result => {
      cached = result
      cachedAt = Date.now()
      subscribers.forEach(fn => fn(result))
      return result
    })
    .finally(() => { inFlight = null })
  return inFlight
}

export function useFx() {
  const [fx, setFx]               = useState<Record<string, number>>(cached?.rates ?? DEFAULT_FX)
  const [fxLive, setFxLive]       = useState(cached?.live ?? false)
  const [fxLoading, setFxLoading] = useState(false)
  const [fxTs, setFxTs]           = useState<string | null>(null)

  useEffect(() => {
    const sync = (r: FxResult) => { setFx(r.rates); setFxLive(r.live) }
    subscribers.add(sync)
    return () => { subscribers.delete(sync) }
  }, [])

  const load = useCallback(async (force: boolean) => {
    setFxLoading(true)
    try {
      const result = await getOrFetchRates(force)
      setFx(result.rates)
      setFxLive(result.live)
      // Only stamp a time when the rates really are live — labelling fallback
      // rates with a fresh timestamp is how stale numbers pass for current ones.
      setFxTs(result.live
        ? new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : null)
    } finally {
      setFxLoading(false)
    }
  }, [])

  useEffect(() => { load(false) }, [load])

  // Bound as an onClick handler in several pages, so it must take no arguments.
  const refresh = useCallback(() => load(true), [load])

  return { fx, fxLive, fxLoading, fxTs, refresh }
}
