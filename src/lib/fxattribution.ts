/**
 * fxattribution.ts — was it the market, or was it the koruna?
 *
 * For a currency c over a period, with local value V and CZK rate R:
 *
 *   ΔCZK = V₁R₁ − V₀R₀
 *        = (V₁ − V₀)·R₀        asset effect     (what the asset did, at old FX)
 *        + V₀·(R₁ − R₀)        currency effect  (what the koruna did, on old holdings)
 *        + (V₁ − V₀)(R₁ − R₀)  interaction      (small, but reported not hidden)
 */

export interface ExposureSnapshot {
  snapshot_date: string
  exposure_usd_local?: number | null
  exposure_eur_local?: number | null
  exposure_czk_local?: number | null
  exposure_other_czk?: number | null
  fx_usd?: number | null
  fx_eur?: number | null
  fx_gbp?: number | null
}

export interface FxAttribution {
  currency: string
  assetEffectCZK: number
  currencyEffectCZK: number
  interactionCZK: number
  totalCZK: number
}

const CURRENCIES = [
  { code: 'USD', local: 'exposure_usd_local', rate: 'fx_usd' },
  { code: 'EUR', local: 'exposure_eur_local', rate: 'fx_eur' },
] as const

const num = (v: number | null | undefined): number | null =>
  v == null || !isFinite(v) ? null : v

/**
 * True when a snapshot carries usable exposure data (rows written before the
 * exposure columns existed are all zero or null).
 *
 * `exposure_other_czk` counts: a portfolio held entirely in, say, GBP has zero
 * in all three of the tracked buckets, and dropping those snapshots left the
 * whole page empty for anyone not holding USD, EUR or CZK.
 */
export function hasExposureData(s: ExposureSnapshot): boolean {
  return (
    (num(s.exposure_usd_local) ?? 0) !== 0 ||
    (num(s.exposure_eur_local) ?? 0) !== 0 ||
    (num(s.exposure_czk_local) ?? 0) !== 0 ||
    (num(s.exposure_other_czk) ?? 0) !== 0
  )
}

/** First date from which attribution can be computed at all. */
export function attributionAvailableFrom(snapshots: ExposureSnapshot[]): string | null {
  const usable = [...snapshots]
    .filter(hasExposureData)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  return usable[0]?.snapshot_date ?? null
}

/** Attribution between two snapshots. */
export function attributePeriod(
  from: ExposureSnapshot,
  to: ExposureSnapshot
): FxAttribution[] {
  const out: FxAttribution[] = []

  for (const c of CURRENCIES) {
    const v0 = num(from[c.local] as number | null | undefined)
    const v1 = num(to[c.local] as number | null | undefined)
    const r0 = num(from[c.rate] as number | null | undefined)
    const r1 = num(to[c.rate] as number | null | undefined)
    // A missing rate makes the split unknowable; skip rather than guess.
    if (v0 == null || v1 == null || r0 == null || r1 == null) continue

    const assetEffectCZK = (v1 - v0) * r0
    const currencyEffectCZK = v0 * (r1 - r0)
    const interactionCZK = (v1 - v0) * (r1 - r0)

    out.push({
      currency: c.code,
      assetEffectCZK,
      currencyEffectCZK,
      interactionCZK,
      totalCZK: assetEffectCZK + currencyEffectCZK + interactionCZK,
    })
  }

  // CZK holdings have no currency effect by construction
  const czk0 = num(from.exposure_czk_local)
  const czk1 = num(to.exposure_czk_local)
  if (czk0 != null && czk1 != null) {
    out.push({
      currency: 'CZK',
      assetEffectCZK: czk1 - czk0,
      currencyEffectCZK: 0,
      interactionCZK: 0,
      totalCZK: czk1 - czk0,
    })
  }

  return out
}

/**
 * Chained attribution across the whole series.
 *
 * Summing day-over-day sub-periods rather than comparing the endpoints keeps
 * contributions made mid-period from polluting the currency effect.
 */
export function attributeSeries(snapshots: ExposureSnapshot[]): FxAttribution[] {
  const usable = [...snapshots]
    .filter(hasExposureData)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  if (usable.length < 2) return []

  const totals: Record<string, FxAttribution> = {}

  for (let i = 1; i < usable.length; i++) {
    for (const row of attributePeriod(usable[i - 1], usable[i])) {
      const acc = totals[row.currency] ?? {
        currency: row.currency,
        assetEffectCZK: 0, currencyEffectCZK: 0, interactionCZK: 0, totalCZK: 0,
      }
      acc.assetEffectCZK += row.assetEffectCZK
      acc.currencyEffectCZK += row.currencyEffectCZK
      acc.interactionCZK += row.interactionCZK
      acc.totalCZK += row.totalCZK
      totals[row.currency] = acc
    }
  }

  return Object.values(totals).sort((a, b) => Math.abs(b.totalCZK) - Math.abs(a.totalCZK))
}

export interface MonthlyAttribution {
  month: string
  assetCZK: number
  currencyCZK: number
}

/** Month-by-month split, for the stacked bar chart. */
export function attributeByMonth(snapshots: ExposureSnapshot[]): MonthlyAttribution[] {
  const usable = [...snapshots]
    .filter(hasExposureData)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  if (usable.length < 2) return []

  const byMonth: Record<string, MonthlyAttribution> = {}

  for (let i = 1; i < usable.length; i++) {
    const month = usable[i].snapshot_date.slice(0, 7)
    const acc = byMonth[month] ?? { month, assetCZK: 0, currencyCZK: 0 }
    for (const row of attributePeriod(usable[i - 1], usable[i])) {
      // Interaction is folded into the asset effect for the chart only; the
      // per-currency table still reports it separately.
      acc.assetCZK += row.assetEffectCZK + row.interactionCZK
      acc.currencyCZK += row.currencyEffectCZK
    }
    byMonth[month] = acc
  }

  return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month))
}

export interface ConstantFxPoint {
  date: string
  actualCZK: number
  constantFxCZK: number
}

/**
 * Portfolio value as reported, against the same portfolio valued at the FX
 * rates that prevailed on day one. The gap between the lines *is* the currency
 * effect — the clearest way to show it.
 */
export function constantFxSeries(
  snapshots: (ExposureSnapshot & { total_value_czk: number })[]
): ConstantFxPoint[] {
  const usable = [...snapshots]
    .filter(hasExposureData)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  if (usable.length === 0) return []

  const base = usable[0]
  const baseUsd = num(base.fx_usd)
  const baseEur = num(base.fx_eur)

  return usable.map(s => {
    const usdLocal = num(s.exposure_usd_local) ?? 0
    const eurLocal = num(s.exposure_eur_local) ?? 0
    const czkLocal = num(s.exposure_czk_local) ?? 0
    const otherCZK = num(s.exposure_other_czk) ?? 0

    const constantFxCZK =
      usdLocal * (baseUsd ?? num(s.fx_usd) ?? 0) +
      eurLocal * (baseEur ?? num(s.fx_eur) ?? 0) +
      czkLocal + otherCZK

    return {
      date: s.snapshot_date,
      actualCZK: s.total_value_czk,
      constantFxCZK,
    }
  })
}

export interface AttributionTotals {
  totalCZK: number
  assetCZK: number
  currencyCZK: number
  interactionCZK: number
  /** Currency effect as a share of the total move; null when the total is ~0. */
  fxShareOfTotal: number | null
}

export function attributionTotals(rows: FxAttribution[]): AttributionTotals {
  const asset = rows.reduce((s, r) => s + r.assetEffectCZK, 0)
  const currency = rows.reduce((s, r) => s + r.currencyEffectCZK, 0)
  const interaction = rows.reduce((s, r) => s + r.interactionCZK, 0)
  const total = asset + currency + interaction
  return {
    totalCZK: total,
    assetCZK: asset,
    currencyCZK: currency,
    interactionCZK: interaction,
    fxShareOfTotal: Math.abs(total) > 1e-6 ? currency / total : null,
  }
}
