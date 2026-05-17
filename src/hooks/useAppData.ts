'use client'
/**
 * useAppData — centralised, cached Supabase data store.
 *
 * Why: every page currently fetches holdings/projections independently on mount.
 * This hook keeps a module-level cache so subsequent page visits are instant,
 * and exposes a single `reload()` to force a fresh fetch after mutations.
 *
 * TTL: 5 minutes (same as market data). A mutation (add/edit/delete) always
 * calls reload() so stale data is never shown after writes.
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase, Holding, DividendProjection, DividendReceived, BankAccount, CryptoHolding, RealEstate } from '@/lib/supabase'

const CACHE_TTL = 5 * 60 * 1000

interface AppData {
  holdings: Holding[]
  projections: DividendProjection[]            // next year
  dividendsReceived: DividendReceived[]
  bankAccounts: BankAccount[]
  cryptoHoldings: CryptoHolding[]
  realEstate: RealEstate[]
  cachedAt: number
}

let cache: AppData | null = null
let inFlight: Promise<AppData> | null = null
const subscribers = new Set<(d: AppData) => void>()

function notify(d: AppData) {
  subscribers.forEach(fn => fn(d))
}

function isCacheValid(): boolean {
  return !!cache && Date.now() - cache.cachedAt < CACHE_TTL
}

async function fetchAll(): Promise<AppData> {
  const CURRENT_YEAR = new Date().getFullYear()
  const [h, p, div, b, c, r] = await Promise.all([
    supabase.from('holdings').select('*').order('symbol'),
    supabase.from('dividend_projections').select('*').eq('year', CURRENT_YEAR + 1).order('projected_total', { ascending: false }),
    supabase.from('dividends_received').select('*').order('payment_date', { ascending: false }),
    supabase.from('bank_accounts').select('*').eq('is_active', true).order('balance', { ascending: false }),
    supabase.from('crypto_holdings').select('*').order('avg_cost_usd', { ascending: false }),
    supabase.from('real_estate').select('*').order('current_value', { ascending: false }),
  ])
  return {
    holdings:          h.data   ?? [],
    projections:       p.data   ?? [],
    dividendsReceived: div.data ?? [],
    bankAccounts:      b.data   ?? [],
    cryptoHoldings:    c.data   ?? [],
    realEstate:        r.data   ?? [],
    cachedAt:          Date.now(),
  }
}

async function getOrFetch(force = false): Promise<AppData> {
  if (!force && isCacheValid()) return cache!
  if (inFlight) return inFlight
  inFlight = fetchAll().then(data => {
    cache = data
    inFlight = null
    notify(data)
    return data
  }).catch(err => {
    inFlight = null
    throw err
  })
  return inFlight
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseAppData extends AppData {
  loading: boolean
  reload: () => Promise<void>
}

const EMPTY: AppData = {
  holdings: [], projections: [], dividendsReceived: [],
  bankAccounts: [], cryptoHoldings: [], realEstate: [],
  cachedAt: 0,
}

export function useAppData(): UseAppData {
  const [data, setData] = useState<AppData>(cache ?? EMPTY)
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    // Subscribe so other instances' reloads propagate here
    const sub = (d: AppData) => setData({ ...d })
    subscribers.add(sub)

    // Fetch if cache is missing or stale
    if (!isCacheValid()) {
      setLoading(true)
      getOrFetch().then(d => {
        setData({ ...d })
        setLoading(false)
      }).catch(() => setLoading(false))
    } else {
      setData({ ...cache! })
      setLoading(false)
    }

    return () => { subscribers.delete(sub) }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const d = await getOrFetch(true)
      setData({ ...d })
    } finally {
      setLoading(false)
    }
  }, [])

  return { ...data, loading, reload }
}
