'use client'
/**
 * useAppData — centralised, cached Supabase data store.
 *
 * All queries are filtered by the active profile_id.
 * When the profile changes (divvy:profile-change event), the cache is
 * invalidated and data is re-fetched automatically.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, Holding, DividendProjection, DividendReceived, BankAccount, CryptoHolding, RealEstate } from '@/lib/supabase'
import { getStoredProfileId } from '@/lib/profile'

const CACHE_TTL = 5 * 60 * 1000

interface AppData {
  holdings: Holding[]
  projections: DividendProjection[]
  dividendsReceived: DividendReceived[]
  bankAccounts: BankAccount[]
  cryptoHoldings: CryptoHolding[]
  realEstate: RealEstate[]
  cachedAt: number
  profileId: string | null
}

// Cache is keyed by profile ID so switching profiles gets fresh data
const cacheByProfile: Record<string, AppData> = {}
let inFlight: Promise<AppData> | null = null
const subscribers = new Set<(d: AppData) => void>()

function notify(d: AppData) {
  subscribers.forEach(fn => fn(d))
}

function isCacheValid(profileId: string | null): boolean {
  if (!profileId) return false
  const c = cacheByProfile[profileId]
  return !!c && Date.now() - c.cachedAt < CACHE_TTL
}

async function fetchAll(profileId: string): Promise<AppData> {
  const CURRENT_YEAR = new Date().getFullYear()
  const [h, p, div, b, c, r] = await Promise.all([
    supabase.from('holdings').select('*').eq('profile_id', profileId).order('symbol'),
    supabase.from('dividend_projections').select('*').eq('profile_id', profileId).eq('year', CURRENT_YEAR + 1).order('projected_total', { ascending: false }),
    supabase.from('dividends_received').select('*').eq('profile_id', profileId).order('payment_date', { ascending: false }),
    supabase.from('bank_accounts').select('*').eq('profile_id', profileId).eq('is_active', true).order('balance', { ascending: false }),
    supabase.from('crypto_holdings').select('*').eq('profile_id', profileId).order('avg_cost_usd', { ascending: false }),
    supabase.from('real_estate').select('*').eq('profile_id', profileId).order('current_value', { ascending: false }),
  ])
  return {
    holdings:          h.data   ?? [],
    projections:       p.data   ?? [],
    dividendsReceived: div.data ?? [],
    bankAccounts:      b.data   ?? [],
    cryptoHoldings:    c.data   ?? [],
    realEstate:        r.data   ?? [],
    cachedAt:          Date.now(),
    profileId,
  }
}

async function getOrFetch(profileId: string, force = false): Promise<AppData> {
  if (!force && isCacheValid(profileId)) return cacheByProfile[profileId]
  if (inFlight) return inFlight
  inFlight = fetchAll(profileId).then(data => {
    cacheByProfile[profileId] = data
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
  cachedAt: 0, profileId: null,
}

export function useAppData(): UseAppData {
  const profileId = getStoredProfileId()
  const [data, setData]       = useState<AppData>(() => (profileId && cacheByProfile[profileId]) ? cacheByProfile[profileId] : EMPTY)
  const [loading, setLoading] = useState(!profileId || !isCacheValid(profileId))
  const activeProfileRef      = useRef(profileId)

  // Re-fetch when profile changes
  const loadForProfile = useCallback(async (pid: string, force = false) => {
    setLoading(true)
    try {
      const d = await getOrFetch(pid, force)
      setData({ ...d })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Subscribe to cache updates from other hook instances
    const sub = (d: AppData) => {
      if (d.profileId === activeProfileRef.current) {
        setData({ ...d })
      }
    }
    subscribers.add(sub)

    // Initial load
    const pid = getStoredProfileId()
    if (pid) {
      activeProfileRef.current = pid
      if (!isCacheValid(pid)) {
        loadForProfile(pid)
      } else {
        setData({ ...cacheByProfile[pid] })
        setLoading(false)
      }
    } else {
      setLoading(false)
    }

    // Listen for profile switches
    const onProfileChange = (e: Event) => {
      const newPid = (e as CustomEvent<string>).detail
      activeProfileRef.current = newPid
      loadForProfile(newPid, true)
    }
    window.addEventListener('divvy:profile-change', onProfileChange)

    return () => {
      subscribers.delete(sub)
      window.removeEventListener('divvy:profile-change', onProfileChange)
    }
  }, [loadForProfile])

  const reload = useCallback(async () => {
    const pid = activeProfileRef.current
    if (!pid) return
    await loadForProfile(pid, true)
  }, [loadForProfile])

  return { ...data, loading, reload }
}
