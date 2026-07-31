/**
 * portfolio.ts — the single place where a holding turns into money.
 *
 * Market value, cost basis, P&L and income used to be recomputed inline on six
 * different pages, which is how they drifted apart (some converted the live
 * price with the holding's currency even when the quote came back in another
 * one). Everything now goes through `positionMetrics` so every page shows the
 * same number for the same position.
 */
import type { DividendProjection, Holding } from './supabase'
import { toCZK, normalizeCurrencyCode, hasFxRate } from './fx'
import { computeProjectedTotal, findProjection } from './projections'

/** The slice of useMarketData() this module needs (kept structural to avoid a cycle). */
export interface QuoteSource {
  getPrice: (symbol: string, fallback: number) => number
  getQuoteCurrency: (symbol: string, fallback: string) => string
  getAnnualDiv: (symbol: string) => number | null
  hasPrice: (symbol: string) => boolean
  quotes: Record<string, { changePercent: number | null }>
}

export interface PositionMetrics {
  holding: Holding
  /** Live price when available, else the holding's average cost. */
  price: number
  /** Currency the price above is expressed in. */
  priceCurrency: string
  isLivePrice: boolean
  changePercent: number | null
  marketCZK: number
  costCZK: number
  plCZK: number
  /** P&L as a percentage of cost. */
  plPct: number
  /** Estimated forward annual dividend, in CZK. Null when unknown. */
  annualDivCZK: number | null
  /** Forward yield on current market value, as a fraction. Null when unknown. */
  divYield: number | null
  isLiveIncome: boolean
  /** True when a currency involved has no FX rate, so the CZK figures are suspect. */
  fxUnavailable: boolean
}

export function positionMetrics(
  holding: Holding,
  market: QuoteSource,
  fx: Record<string, number>,
  projections: DividendProjection[] = [],
  allHoldings: Holding[] = []
): PositionMetrics {
  const isLivePrice = market.hasPrice(holding.symbol)
  const price = market.getPrice(holding.symbol, holding.avg_price)

  // A quote can come back in a different currency than the position is booked
  // in (an ADR, a dual listing, or a London line quoted in pence). Convert the
  // live price with the currency it was actually quoted in; the cost basis
  // stays in the currency the user recorded.
  const priceCurrency = isLivePrice
    ? market.getQuoteCurrency(holding.symbol, holding.currency)
    : holding.currency

  const marketCZK = toCZK(price * holding.shares, priceCurrency, fx)
  const costCZK   = toCZK(holding.avg_price * holding.shares, holding.currency, fx)
  const plCZK     = marketCZK - costCZK

  // Live annual dividend is quoted per share in the quote's currency.
  const liveAnnual = market.getAnnualDiv(holding.symbol)
  let annualDivCZK: number | null = null
  let isLiveIncome = false

  if (liveAnnual != null && liveAnnual > 0) {
    annualDivCZK = toCZK(liveAnnual * holding.shares, priceCurrency, fx)
    isLiveIncome = true
  } else {
    const proj = findProjection(projections, holding.symbol)
    if (proj) {
      annualDivCZK = toCZK(
        computeProjectedTotal(proj, allHoldings.length ? allHoldings : [holding]),
        proj.currency,
        fx
      )
    }
  }

  return {
    holding,
    price,
    priceCurrency,
    isLivePrice,
    changePercent: market.quotes[holding.symbol]?.changePercent ?? null,
    marketCZK,
    costCZK,
    plCZK,
    plPct: costCZK > 0 ? (plCZK / costCZK) * 100 : 0,
    annualDivCZK,
    divYield: annualDivCZK != null && marketCZK > 0 ? annualDivCZK / marketCZK : null,
    isLiveIncome,
    fxUnavailable:
      !hasFxRate(priceCurrency, fx) || !hasFxRate(holding.currency, fx),
  }
}

/** Metrics for a whole list of holdings, in the order given. */
export const positionsMetrics = (
  holdings: Holding[],
  market: QuoteSource,
  fx: Record<string, number>,
  projections: DividendProjection[] = []
): PositionMetrics[] =>
  holdings.map(h => positionMetrics(h, market, fx, projections, holdings))

export interface PortfolioTotals {
  marketCZK: number
  costCZK: number
  plCZK: number
  plPct: number
  annualDivCZK: number
  /** Forward yield on market value, as a percentage. */
  yieldPct: number
  /** Forward yield on cost basis, as a percentage. */
  yieldOnCostPct: number
  /** Symbols whose CZK value could not be computed reliably. */
  fxProblems: string[]
}

export function portfolioTotals(rows: PositionMetrics[]): PortfolioTotals {
  const marketCZK   = rows.reduce((s, r) => s + r.marketCZK, 0)
  const costCZK     = rows.reduce((s, r) => s + r.costCZK, 0)
  const annualDivCZK = rows.reduce((s, r) => s + (r.annualDivCZK ?? 0), 0)
  const plCZK       = marketCZK - costCZK
  return {
    marketCZK,
    costCZK,
    plCZK,
    plPct: costCZK > 0 ? (plCZK / costCZK) * 100 : 0,
    annualDivCZK,
    yieldPct: marketCZK > 0 ? (annualDivCZK / marketCZK) * 100 : 0,
    yieldOnCostPct: costCZK > 0 ? (annualDivCZK / costCZK) * 100 : 0,
    fxProblems: rows.filter(r => r.fxUnavailable).map(r => r.holding.symbol),
  }
}

/** Currency a position's market value is exposed to (normalised, e.g. GBp → GBP). */
export const exposureCurrency = (r: PositionMetrics): string =>
  normalizeCurrencyCode(r.priceCurrency)
