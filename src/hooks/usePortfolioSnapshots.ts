'use client'
import { useState, useCallback, useEffect } from 'react'
import { getStoredProfileId } from '@/lib/profile'

export interface PortfolioSnapshot {
  snapshot_date: string
  total_value_czk: number
  stocks_czk: number
  cash_czk: number
  crypto_czk: number
  realestate_czk: number
}

interface PLSummary {
  pl: number
  plPct: number | null
  label: string
  fromDate: string | null
  fromValue: number | null
}

// Cache for this session
let cachedSnapshots: PortfolioSnapshot[] | null = null
let cachedProfileId: string | null = null

export function usePortfolioSnapshots() {
  const [snapshots, setSnapshots]   = useState<PortfolioSnapshot[]>(cachedSnapshots ?? [])
  const [loading, setLoading]       = useState(false)
  const [lastSaved, setLastSaved]   = useState<string | null>(null)

  const load = useCallback(async () => {
    const profileId = getStoredProfileId()
    if (!profileId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/snapshots?profileId=${profileId}&days=400`)
      if (!res.ok) return
      const { snapshots: data } = await res.json()
      cachedSnapshots = data
      cachedProfileId = profileId
      setSnapshots(data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const profileId = getStoredProfileId()
    if (cachedSnapshots && cachedProfileId === profileId) {
      setSnapshots(cachedSnapshots)
    } else {
      load()
    }
  }, [load])

  const saveSnapshot = useCallback(async (payload: {
    total_value_czk: number
    stocks_czk: number
    cash_czk: number
    crypto_czk: number
    realestate_czk: number
    fx_usd: number
    fx_eur: number
  }) => {
    const profileId = getStoredProfileId()
    if (!profileId) return

    const today = new Date().toISOString().slice(0, 10)
    // Don't re-save if already saved today
    if (lastSaved === today) return

    try {
      const res = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, ...payload }),
      })
      if (res.ok) {
        setLastSaved(today)
        // Reload to include today's snapshot
        await load()
      }
    } catch {
      // Silently fail — snapshots are best-effort
    }
  }, [lastSaved, load])

  // ── Derived P&L summaries ──────────────────────────────────────────────────

  const getPLSummary = useCallback((
    currentValue: number,
    daysAgo: number | 'ytd'
  ): PLSummary => {
    if (snapshots.length === 0) {
      return { pl: 0, plPct: null, label: '', fromDate: null, fromValue: null }
    }

    const today = new Date()
    let targetDate: string

    if (daysAgo === 'ytd') {
      targetDate = `${today.getFullYear()}-01-01`
    } else {
      const d = new Date(today)
      d.setDate(d.getDate() - daysAgo)
      targetDate = d.toISOString().slice(0, 10)
    }

    // Find the closest snapshot on or before targetDate
    const candidates = snapshots.filter(s => s.snapshot_date <= targetDate)
    if (candidates.length === 0) {
      // No data that far back — use oldest available
      const oldest = snapshots[0]
      const pl = currentValue - oldest.total_value_czk
      const plPct = oldest.total_value_czk > 0 ? (pl / oldest.total_value_czk) * 100 : null
      return { pl, plPct, label: `since ${oldest.snapshot_date}`, fromDate: oldest.snapshot_date, fromValue: oldest.total_value_czk }
    }

    const closest = candidates[candidates.length - 1]
    const pl = currentValue - closest.total_value_czk
    const plPct = closest.total_value_czk > 0 ? (pl / closest.total_value_czk) * 100 : null
    const label = daysAgo === 'ytd' ? 'YTD' : `${daysAgo}d`
    return { pl, plPct, label, fromDate: closest.snapshot_date, fromValue: closest.total_value_czk }
  }, [snapshots])

  return { snapshots, loading, saveSnapshot, getPLSummary }
}
