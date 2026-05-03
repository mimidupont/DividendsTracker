/**
 * prices.ts — legacy shim
 *
 * All live price/yield data now comes from the /api/market route via the
 * useMarketData() hook (src/hooks/useMarketData.ts).
 *
 * This file intentionally exports no hardcoded prices.
 * Use getPrice(symbol, fallback) from the hook instead.
 */

export const PRICES: Record<string, number> = {}

export const getPrice = (symbol: string, fallback: number): number =>
  fallback
