'use client'
import { useState, useCallback } from 'react'
import { DEFAULT_FX, fetchFxRates } from '@/lib/fx'

export function useFx() {
  const [fx, setFx] = useState(DEFAULT_FX)
  const [fxLoading, setFxLoading] = useState(false)
  const [fxTs, setFxTs] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setFxLoading(true)
    const rates = await fetchFxRates()
    setFx(rates)
    setFxTs(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    setFxLoading(false)
  }, [])

  return { fx, fxLoading, fxTs, refresh }
}
