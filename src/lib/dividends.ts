import { toCZK } from './fx'

/**
 * dividends.ts — helpers for logging and reinvesting dividends.
 */

/**
 * Shares held at the close of `date` (the ex-date): current shares minus lots
 * bought *after* it, which did not earn the payment. Lots with no purchase
 * date are assumed to be older. Never negative.
 */
export function sharesAsOf(
  holding: { shares: number },
  lots: { shares: number; purchase_date: string | null }[],
  date: string
): { atDate: number; after: number } {
  const after = lots
    .filter(l => l.purchase_date != null && l.purchase_date > date)
    .reduce((s, l) => s + (Number(l.shares) || 0), 0)
  return { atDate: Math.max(0, holding.shares - after), after }
}


/**
 * CZK value of a logged payment, at the rate on its payment date when that
 * was recorded (migration 010), else today's rate — flagged, so the UI can say
 * the figure moves with the koruna.
 */
export function paymentCZK(
  row: { gross_amount: number; withholding_tax?: number | null; currency: string; fx_rate_czk?: number | null },
  fx: Record<string, number>,
  kind: 'gross' | 'net' = 'net'
): { czk: number; frozen: boolean } {
  const local = kind === 'gross' ? row.gross_amount : row.gross_amount - (row.withholding_tax ?? 0)
  if (row.fx_rate_czk != null && isFinite(row.fx_rate_czk) && row.fx_rate_czk > 0) {
    return { czk: local * row.fx_rate_czk, frozen: true }
  }
  return { czk: toCZK(local, row.currency, fx), frozen: false }
}
