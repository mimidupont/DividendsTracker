/**
 * exposure.ts — per-currency exposure, in each currency's own units.
 *
 * Recorded on every daily snapshot. Storing CZK totals alone makes it
 * impossible to tell afterwards whether a change came from the assets or from
 * the exchange rate, because both are already baked into the one number.
 */
import type { Position } from './portfolio'
import { toCZK } from './fx'

export interface CurrencyExposure {
  /** Value held in USD-denominated assets, in USD. */
  usdLocal: number
  /** Value held in EUR-denominated assets, in EUR. */
  eurLocal: number
  /** Value held in CZK-denominated assets, in CZK. */
  czkLocal: number
  /** Everything else, already converted to CZK — too small to track per currency. */
  otherCZK: number
}

/**
 * Split positions by the currency they are actually denominated in.
 *
 * Liabilities are included with their negative sign: a CZK mortgage is genuine
 * negative CZK exposure, and dropping it would overstate foreign-currency share.
 */
export function currencyExposure(
  positions: Position[],
  fx: Record<string, number>
): CurrencyExposure {
  const out: CurrencyExposure = { usdLocal: 0, eurLocal: 0, czkLocal: 0, otherCZK: 0 }

  for (const p of positions) {
    switch (p.currency.toUpperCase()) {
      case 'USD': out.usdLocal += p.valueLocal; break
      case 'EUR': out.eurLocal += p.valueLocal; break
      case 'CZK': out.czkLocal += p.valueLocal; break
      default:    out.otherCZK += toCZK(p.valueLocal, p.currency, fx); break
    }
  }

  return out
}
