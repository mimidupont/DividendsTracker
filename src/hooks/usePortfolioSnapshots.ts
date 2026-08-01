'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { getStoredProfileId } from '@/lib/profile'
import { todayISO, addDays, fmtISODate } from '@/lib/date'

export interface PortfolioSnapshot {
  snapshot_date: string
  total_value_czk: number
  stocks_czk: number
  cash_czk: number
  crypto_czk: number
  realestate_czk: number
  // Per-currency exposure, in each currency's own units, plus the rates the
  // snapshot was struck at. Needed to separate asset moves from FX moves.
  exposure_usd_local?: number | null
  exposure_eur_local?: number | null
  exposure_czk_local?: number | null
  exposure_other_czk?: number | null
  fx_usd?: number | null
  fx_eur?: number | null
  fx_gbp?: number | null
}

export interface SnapshotPayload {
  total_value_czk: number
  stocks_czk: number
  cash_czk: number
  crypto_czk: number
  realestate_czk: number
  fx_usd: number
  fx_eur: number
  fx_gbp?: number
  exposure_usd_local?: number
  exposure_eur_local?: number
  exposure_czk_local?: number
  exposure_other_czk?: number
}

interface PLSummary {
  pl: number
  plPct: number | null
  label: string
  fromDate: string | null
  fromValue: number | null
}

const EMPTY_SUMMARY: PLSummary = { pl: 0, plPct: null, label: '', fromDate: null, fromValue: null }

// Cache for this session, keyed by profile
const cacheByProfile: Record<string, PortfolioSnapshot[]> = {}

export function usePortfolioSnapshots() {
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([])
  const [loading, setLoading]     = useState(false)
  // Which profile+date pairs this session has already written, so repeated
  // renders can't fire the same upsert several times over.
  const savedRef = useRef<Set<string>>(new Set())
  const savingRef = useRef(false)

  const load = useCallback(async () => {
    const profileId = getStoredProfileId()
    if (!profileId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/snapshots?profileId=${encodeURIComponent(profileId)}&days=400`)
      if (!res.ok) return
      const { snapshots: data } = await res.json()
      const list: PortfolioSnapshot[] = Array.isArray(data) ? data : []
      // Sort defensively — every consumer below assumes ascending dates.
      list.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      cacheByProfile[profileId] = list
      setSnapshots(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const profileId = getStoredProfileId()
    if (profileId && cacheByProfile[profileId]) {
      setSnapshots(cacheByProfile[profileId])
    } else {
      load()
    }

    // Switching profile must swap the history too, not keep showing the
    // previous profile's curve.
    const onProfileChange = () => { setSnapshots([]); load() }
    window.addEventListener('divvy:profile-change', onProfileChange)
    return () => window.removeEventListener('divvy:profile-change', onProfileChange)
  }, [load])

  const saveSnapshot = useCallback(async (payload: SnapshotPayload) => {
    const profileId = getStoredProfileId()
    if (!profileId) return
    if (!Number.isFinite(payload.total_value_czk) || payload.total_value_czk <= 0) return

    const date = todayISO()
    const key = `${profileId}::${date}`
    if (savedRef.current.has(key) || savingRef.current) return
    savingRef.current = true

    try {
      const res = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, snapshotDate: date, ...payload }),
      })
      if (res.ok) {
        savedRef.current.add(key)
        await load()
      }
    } catch {
      // Silently fail — snapshots are best-effort
    } finally {
      savingRef.current = false
    }
  }, [load])

  // ── Derived P&L summaries ──────────────────────────────────────────────────

  const getPLSummary = useCallback((
    currentValue: number,
    daysAgo: number | 'ytd'
  ): PLSummary => {
    if (snapshots.length === 0) return EMPTY_SUMMARY

    const today = todayISO()
    const targetDate = daysAgo === 'ytd'
      ? `${today.slice(0, 4)}-01-01`
      : addDays(today, -daysAgo)

    // Baseline = the newest snapshot at or before the target date. Today's own
    // snapshot is never a valid baseline for a look-back window.
    const candidates = snapshots.filter(s => s.snapshot_date <= targetDate)
    const baseline = candidates.length > 0
      ? candidates[candidates.length - 1]
      : snapshots[0]

    // Only one data point, and it is today: there is no history to compare to
    // yet, so report "no data" rather than a fabricated 0%.
    if (candidates.length === 0 && baseline.snapshot_date >= today) return EMPTY_SUMMARY

    const pl = currentValue - baseline.total_value_czk
    const plPct = baseline.total_value_czk > 0 ? (pl / baseline.total_value_czk) * 100 : null
    const label = candidates.length === 0
      ? `since ${fmtISODate(baseline.snapshot_date)}`
      : daysAgo === 'ytd' ? 'YTD' : `${daysAgo}d`

    return {
      pl,
      plPct,
      label,
      fromDate: baseline.snapshot_date,
      fromValue: baseline.total_value_czk,
    }
  }, [snapshots])

  return { snapshots, loading, saveSnapshot, getPLSummary }
}
