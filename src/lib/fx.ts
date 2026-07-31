/**
 * fx.ts — currency conversion into the CZK base currency.
 *
 * Every monetary figure in the app is normalised to CZK through `toCZK()`.
 * Getting this wrong silently corrupts every total on every page, so the
 * helpers below are deliberately strict:
 *   · minor units (GBp/pence, ZAc, ILA) are folded into their major unit
 *   · an unknown currency is never converted at some other currency's rate
 */

/**
 * Fallback rates (units of CZK per 1 unit of currency), used only until the
 * live rates from /api/fx arrive — or if that call fails.
 */
export const DEFAULT_FX: Record<string, number> = {
  CZK: 1,
  USD: 20.65,
  EUR: 23.40,
  GBP: 27.50,
  CHF: 25.90,
  PLN: 5.60,
  SEK: 2.15,
  DKK: 3.14,
  NOK: 2.05,
  CAD: 15.00,
  JPY: 0.14,
}

/**
 * Currencies that market data providers quote in minor units.
 * e.g. Yahoo returns `GBp` (pence) for London-listed instruments — a price of
 * 2450 means £24.50, so treating it as GBP overstates the position 100×.
 */
const MINOR_UNITS: Record<string, { major: string; divisor: number }> = {
  GBP_MINOR: { major: 'GBP', divisor: 100 }, // GBp / GBX
  ZAR_MINOR: { major: 'ZAR', divisor: 100 }, // ZAc / ZAX
  ILS_MINOR: { major: 'ILS', divisor: 100 }, // ILA (agorot)
}

function minorUnitOf(raw: string): { major: string; divisor: number } | null {
  if (raw === 'GBp' || raw === 'GBX') return MINOR_UNITS.GBP_MINOR
  if (raw === 'ZAc' || raw === 'ZAX') return MINOR_UNITS.ZAR_MINOR
  if (raw === 'ILA') return MINOR_UNITS.ILS_MINOR
  return null
}

/**
 * Fold an amount + currency code into (major-unit amount, ISO currency code).
 * Always use this before looking a rate up.
 */
export function normalizeMoney(amount: number, ccy: string | null | undefined): { amount: number; ccy: string } {
  const raw = (ccy ?? '').trim()
  if (!raw) return { amount, ccy: 'CZK' }
  const minor = minorUnitOf(raw)
  if (minor) return { amount: amount / minor.divisor, ccy: minor.major }
  return { amount, ccy: raw.toUpperCase() }
}

/** ISO code for a possibly minor-unit currency string (e.g. "GBp" → "GBP"). */
export const normalizeCurrencyCode = (ccy: string | null | undefined): string =>
  normalizeMoney(0, ccy).ccy

// Warn once per unknown currency instead of on every render.
const warnedCurrencies = new Set<string>()

/** CZK per 1 unit of `ccy`, or null when we have no rate for it. */
export function fxRate(ccy: string, fx: Record<string, number> = DEFAULT_FX): number | null {
  const code = normalizeCurrencyCode(ccy)
  const rate = fx[code] ?? DEFAULT_FX[code]
  return typeof rate === 'number' && isFinite(rate) && rate > 0 ? rate : null
}

/** True when we can convert this currency (used to flag unreliable totals). */
export const hasFxRate = (ccy: string, fx: Record<string, number> = DEFAULT_FX): boolean =>
  fxRate(ccy, fx) !== null

/**
 * Convert `amount` of `ccy` into CZK.
 *
 * If the currency is unknown the amount is returned unconverted (rate 1) and a
 * warning is logged — previously this fell back to the USD rate, which silently
 * multiplied unrelated currencies by ~20.
 */
export function toCZK(amount: number, ccy: string, fx: Record<string, number> = DEFAULT_FX): number {
  if (!isFinite(amount)) return 0
  const { amount: normalized, ccy: code } = normalizeMoney(amount, ccy)
  const rate = fxRate(code, fx)
  if (rate == null) {
    if (!warnedCurrencies.has(code)) {
      warnedCurrencies.add(code)
      console.warn(`[fx] no CZK rate for "${code}" — amount left unconverted`)
    }
    return normalized
  }
  return normalized * rate
}

export const fmtCZK = (n: number, decimals = 0) =>
  `Kč ${(isFinite(n) ? n : 0).toLocaleString('cs-CZ', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`

export const fmtNum = (n: number, d = 2) =>
  (isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export const fmtPct = (n: number, d = 2) =>
  `${isFinite(n) && n >= 0 ? '+' : ''}${(isFinite(n) ? n : 0).toFixed(d)}%`

export const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export const fmtDateShort = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export interface FxResult {
  rates: Record<string, number>
  /** false when the live fetch failed and DEFAULT_FX is being used */
  live: boolean
  error?: string
}

export async function fetchFxRates(): Promise<FxResult> {
  try {
    // Call our own API route — avoids any browser CORS issues with Frankfurter
    const res = await fetch('/api/fx')
    if (!res.ok) throw new Error(`/api/fx responded ${res.status}`)
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    const rates = data.rates as Record<string, number>
    if (!rates || typeof rates.USD !== 'number') throw new Error('malformed FX payload')
    // Keep the fallbacks for any currency the provider does not quote
    return { rates: { ...DEFAULT_FX, ...rates }, live: true }
  } catch (err) {
    console.error('[fx] fetch failed, using fallback rates:', err)
    return { rates: DEFAULT_FX, live: false, error: String(err) }
  }
}
