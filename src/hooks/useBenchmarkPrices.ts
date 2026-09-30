'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase, type BenchmarkPrice } from '@/lib/supabase'
import { isMissingTable } from './useAppData'

const PAGE = 1000

/**
 * Every stored price for one benchmark, oldest first.
 *
 * PostgREST returns at most 1 000 rows per request; a five-year daily history
 * is 1 260–1 830 rows, and a single select silently dropped the newest one or
 * two years. Pages until a short page comes back.
 *
 * `benchmark_prices` is shared market data (not profile-scoped), which is why
 * there is no profile filter here.
 */
export async function fetchBenchmarkPrices(symbol: string, fromDate?: string): Promise<BenchmarkPrice[]> {
  const out: BenchmarkPrice[] = []
  for (let from = 0; from < 50_000; from += PAGE) {
    let q = supabase.from('benchmark_prices').select('*').eq('symbol', symbol)
    if (fromDate) q = q.gte('price_date', fromDate)
    const { data, error } = await q.order('price_date').range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...((data ?? []) as BenchmarkPrice[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

export function useBenchmarkPrices(symbol: string | null) {
  const [prices, setPrices] = useState<BenchmarkPrice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    if (!symbol) { setPrices([]); return }
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchBenchmarkPrices(symbol)
      setPrices(rows)
      setMissing(false)
    } catch (e) {
      const err = e as { code?: string; message?: string }
      if (isMissingTable(err)) setMissing(true)
      else setError(err.message ?? String(e))
      setPrices([])
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => { load() }, [load])

  return { prices, loading, error, missingTable: missing, reload: load }
}
