'use client'
import { useEffect, useState } from 'react'
import { fetchHistoricalFx, fxRate, normalizeCurrencyCode } from '@/lib/fx'
import { todayISO } from '@/lib/date'
import { useFx } from './useFx'

export interface RateOn {
  /** CZK per 1 unit of the currency, or null while unknown. */
  rate: number | null
  /** Where the rate came from, for the label next to the field. */
  source: string
  loading: boolean
}

const cache = new Map<string, { rates: Record<string, number>; rateDate: string } | null>()

/**
 * The CZK rate for a currency on a date — what a transaction row must freeze.
 * CZK is always 1. Today uses the live rate; a past date uses the ECB
 * reference rate for that day. Null (never a silent substitute) when neither
 * is available, so the form can ask the user to type it.
 */
export function useRateOn(currency: string, date: string): RateOn {
  const { fx, fxLive } = useFx()
  const ccy = normalizeCurrencyCode(currency)
  const [state, setState] = useState<RateOn>({ rate: null, source: '', loading: false })

  useEffect(() => {
    let cancelled = false
    if (!ccy) { setState({ rate: null, source: '', loading: false }); return }
    if (ccy === 'CZK') { setState({ rate: 1, source: 'CZK', loading: false }); return }
    if (!date || date >= todayISO()) {
      const r = fxRate(ccy, fx)
      setState({ rate: r, source: fxLive ? "today's live rate" : 'fallback rate — check it', loading: false })
      return
    }
    const key = date
    const apply = (h: { rates: Record<string, number>; rateDate: string } | null) => {
      if (cancelled) return
      const r = h ? fxRate(ccy, h.rates) : null
      setState({
        rate: r,
        source: r != null ? `ECB rate on ${h!.rateDate}` : 'no historical rate — enter it',
        loading: false,
      })
    }
    if (cache.has(key)) { apply(cache.get(key)!); return }
    setState(s => ({ ...s, loading: true }))
    fetchHistoricalFx(date).then(h => { cache.set(key, h); apply(h) })
    return () => { cancelled = true }
  }, [ccy, date, fx, fxLive])

  return state
}
