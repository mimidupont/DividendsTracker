import type { Transaction } from './supabase'
import { realizedPL, czkOf } from './transactions'

/**
 * tax.ts — withholding and Czech tax rates used to turn gross income into net.
 *
 * These are defaults for display and DRIP estimates, not tax advice. The rate a
 * broker actually withheld is always the better number: every form that logs
 * income lets the user overwrite the estimate with it.
 */

/**
 * Dividend withholding tax by the issuer's country (ISO-2), as applied to a
 * Czech tax resident under the relevant double-tax treaty and broker relief.
 * Where treaty relief needs paperwork (W-8BEN for the US), the relieved rate
 * is assumed.
 */
export const DIVIDEND_WHT_BY_COUNTRY: Record<string, number> = {
  US: 0.15,     // with W-8BEN; 30 % without
  CZ: 0.15,
  DE: 0.26375,  // 25 % + solidarity surcharge; treaty reclaim possible down to 15 %
  CH: 0.35,     // reclaimable down to 15 %
  FR: 0.25,     // 12.8 % with the reduced-rate form
  NL: 0.15,
  AT: 0.275,
  ES: 0.19,
  IT: 0.26,
  PL: 0.19,
  GB: 0,
  UK: 0,
  IE: 0,        // Irish-domiciled UCITS funds pay gross
  LU: 0.15,
  DK: 0.27,
  SE: 0.30,
  NO: 0.25,
  FI: 0.35,
  CA: 0.15,
  JP: 0.15315,
  AU: 0.15,
}

/** Fallback when the issuer's country is unknown — the US treaty rate. */
export const DEFAULT_DIVIDEND_WHT = 0.15

/** Czech final withholding on bank interest and on Czech-source bond coupons. */
export const CZ_INTEREST_TAX = 0.15
export const CZ_COUPON_TAX = 0.15

/**
 * Best-guess withholding rate for a dividend.
 *
 * Uses the country recorded in asset_metadata; failing that, a region of 'CZ'
 * or 'US'; failing that, the US treaty rate. Returns the source too, so the UI
 * can say "estimated" when it is guessing.
 */
export function whtRateFor(meta: { country?: string | null; region?: string | null } | undefined):
  { rate: number; basis: 'country' | 'region' | 'default' } {
  const country = (meta?.country ?? '').trim().toUpperCase()
  if (country && DIVIDEND_WHT_BY_COUNTRY[country] != null) {
    return { rate: DIVIDEND_WHT_BY_COUNTRY[country], basis: 'country' }
  }
  const region = (meta?.region ?? '').trim().toUpperCase()
  if (region === 'CZ' || region === 'US' || region === 'UK') {
    return { rate: DIVIDEND_WHT_BY_COUNTRY[region], basis: 'region' }
  }
  return { rate: DEFAULT_DIVIDEND_WHT, basis: 'default' }
}


/** §4(1)(x) ZDP: gross proceeds from sales in a year up to this are exempt. */
export const CZ_PROCEEDS_EXEMPTION_CZK = 100_000
/** Cap on time-tested exempt income per year, from 2025 (§4(1)(w) as amended). */
export const CZ_TIME_TEST_CAP_CZK = 40_000_000

export interface CzechTaxView {
  assetClass: 'stock' | 'crypto' | 'bond'
  /** Gross sale proceeds in the year, CZK at each sale's rate. */
  proceedsCZK: number
  /** Proceeds are at or below the 100 000 CZK limit, so gains may be exempt regardless of holding period. */
  underProceedsLimit: boolean
  /** Gains on lots held more than three years. */
  timeTestedGainCZK: number
  timeTestedProceedsCZK: number
  /** Gains on lots held three years or less (taxable unless under the proceeds limit). */
  otherGainCZK: number
  /** Lots sold with no matching purchase — their gain is overstated. */
  incompleteLots: number
}

/**
 * The figures a Czech return asks about, per asset class, for one year.
 * Informational only: it applies the value test (≤ 100 000 CZK proceeds) and
 * the 3-year time test as the app understands them. Confirm with a tax adviser.
 */
export function czechTaxView(txns: Transaction[], year: number): CzechTaxView[] {
  const classOf = new Map<string, Transaction['asset_class']>()
  for (const t of txns) if (t.symbol) classOf.set(t.symbol, t.asset_class)
  const lots = realizedPL(txns).filter(l => Number(l.sellDate.slice(0, 4)) === year)
  const out: CzechTaxView[] = []
  for (const cls of ['stock', 'crypto', 'bond'] as const) {
    const sells = txns.filter(t => t.type === 'sell' && t.asset_class === cls && Number(t.txn_date.slice(0, 4)) === year)
    const clsLots = lots.filter(l => (classOf.get(l.symbol) ?? 'stock') === cls)
    if (sells.length === 0 && clsLots.length === 0) continue
    const proceedsCZK = sells.reduce((s, t) => s + Math.abs(czkOf(t)), 0)
    const tested = clsLots.filter(l => l.passesTimeTest)
    out.push({
      assetClass: cls,
      proceedsCZK,
      underProceedsLimit: proceedsCZK <= CZ_PROCEEDS_EXEMPTION_CZK,
      timeTestedGainCZK: tested.reduce((s, l) => s + l.gainCZK, 0),
      timeTestedProceedsCZK: tested.reduce((s, l) => s + l.proceedsCZK, 0),
      otherGainCZK: clsLots.filter(l => !l.passesTimeTest).reduce((s, l) => s + l.gainCZK, 0),
      incompleteLots: clsLots.filter(l => l.basisIncomplete).length,
    })
  }
  return out
}
