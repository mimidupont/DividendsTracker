'use client'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { getStoredProfileId } from '@/lib/profile'
import { todayISO, addDays, fmtISODate } from '@/lib/date'
import { periodPL } from '@/lib/returns'

export interface PortfolioSnapshot {
  snapshot_date: string
  total_value_czk: number
  stocks_czk: number
  cash_czk: number
  crypto_czk: number
  realestate_czk: number
  bonds_czk?: number | null
  unpriced_count?: number | null
  // Per-currency exposure, in each currency's own units, plus the rates the
  // snapshot was struck at. Needed to separate asset moves from FX moves.
  exposure_usd_local?: number | null
  exposure_eur_local?: number | null
  exposure_czk_local?: number | null
  exposure_gbp_local?: number | null
  exposure_other_czk?: number | null
  fx_usd?: number | null
  fx_eur?: number | null
  fx_gbp?: number | null
}

export interface SnapshotPayload {
  total_value_czk: number
  stocks_czk: number
  bonds_czk?: number
  cash_czk: number
  crypto_czk: number
  realestate_czk: number
  fx_usd: number | null
  fx_eur: number | null
  fx_gbp?: number | null
  exposure_usd_local?: number
  exposure_eur_local?: number
  exposure_czk_local?: number
  exposure_gbp_local?: number
  exposure_other_czk?: number
}

export interface PLSummary {
  /** Earned over the window: change in value minus net deposits. Null = no history yet. */
  pl: number | null
  /** Time-weighted %, null when not computable. */
  plPct: number | null
  /** Net deposits/withdrawals inside the window. */
  flowsCZK: number
  /** Raw change in value (flows included). */
  changeCZK: number | null
  /** False when no ledger exists, so "pl" is really just the change in net worth. */
  flowAware: boolean
  label: string
  fromDate: string | null
  fromValue: number | null
}

const EMPTY_SUMMARY: PLSummary = {
  pl: null, plPct: null, flowsCZK: 0, changeCZK: null, flowAware: false,
  label: '', fromDate: null, fromValue: null,
}

// Cache for this session, keyed by profile
const cacheByProfile: Record<string, PortfolioSnapshot[]> = {}

export function usePortfolioSnapshots() {
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  /** False when the database predates migration 005 and has no exposure columns. */
  const [exposureAvailable, setExposureAvailable] = useState(true)
  // Which profile+date pairs this session has already written, so repeated
  // renders can't fire the same upsert several times over.
  const savedRef = useRef<Set<string>>(new Set())
  const savingRef = useRef(false)

  const load = useCallback(async () => {
    const profileId = getStoredProfileId()
    if (!profileId) return
    setLoading(true)
    setError(null)
    // The active profile can change while this request is in flight; a late
    // response for the old profile must not paint its curve under the new one.
    const stillCurrent = () => getStoredProfileId() === profileId
    try {
      const res = await fetch(`/api/snapshots?profileId=${encodeURIComponent(profileId)}&days=400`)
      const body = await res.json().catch(() => ({}))
      if (!stillCurrent()) return
      if (!res.ok) {
        // Returning silently here left the P&L chart and every derived window
        // empty with nothing to explain why.
        setError(body?.error ?? `Snapshots unavailable (HTTP ${res.status})`)
        return
      }
      setExposureAvailable(body?.exposureAvailable !== false)
      const data = body?.snapshots
      const list: PortfolioSnapshot[] = Array.isArray(data) ? data : []
      // Sort defensively — every consumer below assumes ascending dates.
      list.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      cacheByProfile[profileId] = list
      setSnapshots(list)
    } catch (err) {
      if (stillCurrent()) setError(`Snapshots unavailable: ${String(err)}`)
    } finally {
      if (stillCurrent()) setLoading(false)
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

  /**
   * `forProfileId` is the profile the payload was computed for; the write is
   * dropped if the active profile has changed since, so one profile's totals
   * can never be stored under another.
   */
  const saveSnapshot = useCallback(async (payload: SnapshotPayload, forProfileId?: string | null) => {
    const profileId = getStoredProfileId()
    if (!profileId) return
    if (forProfileId && forProfileId !== profileId) return
    // Negative net worth (early in a mortgage) is a real value and is recorded;
    // only a non-number is refused.
    if (!Number.isFinite(payload.total_value_czk)) return

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
    daysAgo: number | 'ytd',
    flows?: { date: string; amountCZK: number }[]
  ): PLSummary => {
    if (snapshots.length === 0 || !isFinite(currentValue)) return EMPTY_SUMMARY

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

    const points = [
      ...snapshots
        .filter(s => s.snapshot_date >= baseline.snapshot_date && s.snapshot_date < today)
        .map(s => ({ date: s.snapshot_date, value: s.total_value_czk })),
      { date: today, value: currentValue },
    ]
    const result = periodPL(
      points,
      { date: baseline.snapshot_date, value: baseline.total_value_czk },
      flows ?? []
    )
    if (!result) return EMPTY_SUMMARY

    const label = candidates.length === 0
      ? `since ${fmtISODate(baseline.snapshot_date)}`
      : daysAgo === 'ytd' ? 'YTD' : `${daysAgo}d`

    return {
      pl: result.pl,
      // TWR needs a positive starting value; a negative-equity baseline has no
      // meaningful percentage.
      plPct: baseline.total_value_czk > 0 ? result.plPct : null,
      flowsCZK: result.flowsCZK,
      changeCZK: result.changeCZK,
      flowAware: flows != null && flows.length > 0,
      label,
      fromDate: baseline.snapshot_date,
      fromValue: baseline.total_value_czk,
    }
  }, [snapshots])

  return useMemo(
    () => ({ snapshots, loading, error, exposureAvailable, saveSnapshot, getPLSummary }),
    [snapshots, loading, error, exposureAvailable, saveSnapshot, getPLSummary]
  )
}
