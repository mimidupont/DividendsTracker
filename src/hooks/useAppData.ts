'use client'
/**
 * useAppData — centralised, cached Supabase data store.
 *
 * All queries are filtered by the active profile_id.
 * When the profile changes (divvy:profile-change event), the cache is
 * invalidated and data is re-fetched automatically.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  supabase, supabaseConfigError,
  Holding, DividendProjection, DividendReceived, BankAccount, CryptoHolding, RealEstate,
  Transaction, AssetMetadata, AllocationTarget, FinancialPlan, ExpenseLogRow,
  ScenarioRow, MarketAssumption,
} from '@/lib/supabase'
import { getStoredProfileId } from '@/lib/profile'

const CACHE_TTL = 5 * 60 * 1000

interface AppData {
  holdings: Holding[]
  projections: DividendProjection[]
  dividendsReceived: DividendReceived[]
  bankAccounts: BankAccount[]
  cryptoHoldings: CryptoHolding[]
  realEstate: RealEstate[]
  // ── v2 ──
  transactions: Transaction[]
  assetMetadata: AssetMetadata[]
  allocationTargets: AllocationTarget[]
  financialPlan: FinancialPlan | null
  expenseLog: ExpenseLogRow[]
  scenarios: ScenarioRow[]
  marketAssumptions: MarketAssumption[]
  cachedAt: number
  profileId: string | null
  /** Non-null when one or more queries failed — totals would be understated. */
  error: string | null
}

// Cache is keyed by profile ID so switching profiles gets fresh data
const cacheByProfile: Record<string, AppData> = {}
// In-flight requests are keyed too: a shared promise handed to a second profile
// would have resolved with the first profile's rows.
const inFlightByProfile: Record<string, Promise<AppData>> = {}
const subscribers = new Set<(d: AppData) => void>()

function notify(d: AppData) {
  subscribers.forEach(fn => fn(d))
}

function isCacheValid(profileId: string | null): boolean {
  if (!profileId) return false
  const c = cacheByProfile[profileId]
  return !!c && !c.error && Date.now() - c.cachedAt < CACHE_TTL
}

async function fetchAll(profileId: string): Promise<AppData> {
  if (supabaseConfigError) {
    return { ...EMPTY, cachedAt: Date.now(), profileId, error: supabaseConfigError }
  }
  const [h, p, div, b, c, r, txn, meta, targets, plan, expenses, scen, assumptions] = await Promise.all([
    supabase.from('holdings').select('*').eq('profile_id', profileId).order('symbol'),
    // Every year is fetched — the projections page shows a multi-year table and
    // income estimates need whichever year is currently relevant, not a single
    // hardcoded one.
    supabase.from('dividend_projections').select('*').eq('profile_id', profileId).order('year').order('projected_total', { ascending: false }),
    supabase.from('dividends_received').select('*').eq('profile_id', profileId).order('payment_date', { ascending: false }),
    supabase.from('bank_accounts').select('*').eq('profile_id', profileId).eq('is_active', true).order('balance', { ascending: false }),
    supabase.from('crypto_holdings').select('*').eq('profile_id', profileId).order('avg_cost_usd', { ascending: false }),
    supabase.from('real_estate').select('*').eq('profile_id', profileId).order('current_value', { ascending: false }),
    supabase.from('transactions').select('*').eq('profile_id', profileId).order('txn_date', { ascending: false }),
    supabase.from('asset_metadata').select('*').eq('profile_id', profileId),
    supabase.from('allocation_targets').select('*').eq('profile_id', profileId),
    supabase.from('financial_plan').select('*').eq('profile_id', profileId).maybeSingle(),
    supabase.from('expense_log').select('*').eq('profile_id', profileId).order('month'),
    supabase.from('scenarios').select('*').eq('profile_id', profileId).order('created_at'),
    supabase.from('market_assumptions').select('*').eq('profile_id', profileId),
  ])

  // A failed query used to be indistinguishable from "you own nothing", which
  // quietly wiped an asset class out of net worth. Surface it instead.
  //
  // The v2 tables are excluded from this check on purpose: before their
  // migration has been run they legitimately 404, and treating that as data
  // loss would show a scary banner on every page of a working v1 install.
  const failures = [h, p, div, b, c, r]
    .map(res => res.error?.message)
    .filter((m): m is string => !!m)

  return {
    holdings:          h.data   ?? [],
    projections:       p.data   ?? [],
    dividendsReceived: div.data ?? [],
    bankAccounts:      b.data   ?? [],
    cryptoHoldings:    c.data   ?? [],
    realEstate:        r.data   ?? [],
    transactions:      txn.data  ?? [],
    assetMetadata:     meta.data ?? [],
    allocationTargets: targets.data ?? [],
    financialPlan:     (plan.data as FinancialPlan | null) ?? null,
    expenseLog:        expenses.data ?? [],
    scenarios:         scen.data ?? [],
    marketAssumptions: assumptions.data ?? [],
    cachedAt:          Date.now(),
    profileId,
    error:             failures.length ? failures.join(' · ') : null,
  }
}

async function getOrFetch(profileId: string, force = false): Promise<AppData> {
  if (!force && isCacheValid(profileId)) return cacheByProfile[profileId]
  const existing = inFlightByProfile[profileId]
  if (existing) return existing

  const request = fetchAll(profileId)
    .then(data => {
      cacheByProfile[profileId] = data
      notify(data)
      return data
    })
    .finally(() => { delete inFlightByProfile[profileId] })

  inFlightByProfile[profileId] = request
  return request
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseAppData extends AppData {
  loading: boolean
  reload: () => Promise<void>
}

const EMPTY: AppData = {
  holdings: [], projections: [], dividendsReceived: [],
  bankAccounts: [], cryptoHoldings: [], realEstate: [],
  transactions: [], assetMetadata: [], allocationTargets: [],
  financialPlan: null, expenseLog: [], scenarios: [], marketAssumptions: [],
  cachedAt: 0, profileId: null, error: null,
}

export function useAppData(): UseAppData {
  // Deliberately not seeded from localStorage: the server renders with no
  // profile, so reading one during the first client render desynchronises
  // hydration. The effect below fills it in immediately after mount.
  const [data, setData]       = useState<AppData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const activeProfileRef      = useRef<string | null>(null)

  const loadForProfile = useCallback(async (pid: string, force = false) => {
    setLoading(true)
    try {
      const d = await getOrFetch(pid, force)
      // A slow response for a profile the user has since switched away from
      // must not overwrite the current one.
      if (activeProfileRef.current === pid) setData({ ...d })
    } finally {
      if (activeProfileRef.current === pid) setLoading(false)
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
      if (!newPid) return
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
    const pid = activeProfileRef.current ?? getStoredProfileId()
    if (!pid) return
    activeProfileRef.current = pid
    await loadForProfile(pid, true)
  }, [loadForProfile])

  return { ...data, loading, reload }
}
