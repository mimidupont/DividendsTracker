/**
 * portfolio.ts — the single place where a holding turns into money.
 *
 * Market value, cost basis, P&L and income used to be recomputed inline on six
 * different pages, which is how they drifted apart (some converted the live
 * price with the holding's currency even when the quote came back in another
 * one). Everything now goes through `positionMetrics` so every page shows the
 * same number for the same position.
 */
import type {
  DividendProjection, Holding, BankAccount, CryptoHolding, RealEstate, AssetMetadata,
} from './supabase'
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

// ─────────────────────────────────────────────────────────────────────────────
// Unified multi-asset position model (F0)
//
// Everything you own, normalised into one shape, so risk / rebalancing /
// scenarios / runway / FIRE all read from a single source rather than each
// re-deriving "what do I hold" from the raw tables.
// ─────────────────────────────────────────────────────────────────────────────

export type AssetClass = 'stock' | 'etf' | 'cash' | 'crypto' | 'realestate'
export type LiquidityTier = 'instant' | 'week' | 'month' | 'year' | 'illiquid'

export const LIQUIDITY_TIERS: LiquidityTier[] = ['instant', 'week', 'month', 'year', 'illiquid']

export interface Position {
  id: string
  assetClass: AssetClass
  /** Short label: "AAPL" / "Fio spořicí" / "BTC" / "Byt Brno" */
  label: string
  name: string
  /** Native currency of valueLocal / costLocal. */
  currency: string
  quantity: number
  valueLocal: number
  valueCZK: number
  costLocal: number
  costCZK: number
  sector: string | null
  region: string | null
  liquidityTier: LiquidityTier
  /** Forward annual income in CZK: dividend / interest / rent / staking. */
  annualIncomeCZK: number
  /** Mortgages are negative-value positions. */
  isLiability: boolean
  /** Primary residence is excluded from investable net worth by default. */
  isPrimaryResidence?: boolean
}

/** Minimal shape of the crypto price hook this module needs. */
export interface CryptoPriceSource {
  getPrice: (coinId: string, fallback: number) => number
}

export interface BuildPositionsInput {
  holdings: Holding[]
  bankAccounts: BankAccount[]
  cryptoHoldings: CryptoHolding[]
  realEstate: RealEstate[]
  projections?: DividendProjection[]
  assetMetadata?: AssetMetadata[]
}

function coerceTier(raw: string | null | undefined, fallback: LiquidityTier): LiquidityTier {
  return LIQUIDITY_TIERS.includes(raw as LiquidityTier) ? (raw as LiquidityTier) : fallback
}

/**
 * Default liquidity for a cash account. A term deposit whose maturity is still
 * far out is not instant money, however the row is labelled.
 */
function cashTier(a: BankAccount): LiquidityTier {
  const explicit = coerceTier(a.liquidity_tier, 'instant')
  if (a.liquidity_tier) return explicit
  if (a.account_type !== 'fixed_deposit') return 'instant'
  if (!a.maturity_date) return 'month'
  const daysOut = (Date.parse(a.maturity_date) - Date.now()) / 86_400_000
  if (!isFinite(daysOut)) return 'month'
  return daysOut > 365 ? 'year' : daysOut > 31 ? 'month' : 'week'
}

const ownershipShare = (p: RealEstate) =>
  (isFinite(p.ownership_pct) ? Math.min(Math.max(p.ownership_pct, 0), 100) : 100) / 100

/**
 * Every asset (and liability) you own, normalised and valued in CZK.
 *
 * Real estate produces two rows per property: the asset at your ownership
 * share, and the mortgage as a separate negative position. Keeping them apart
 * is what lets a scenario drop property values without shrinking the debt.
 */
export function buildPositions(
  data: BuildPositionsInput,
  fx: Record<string, number>,
  market: QuoteSource,
  crypto: CryptoPriceSource
): Position[] {
  const metaBySymbol = new Map(
    (data.assetMetadata ?? []).map(m => [m.symbol.toUpperCase(), m])
  )
  const positions: Position[] = []

  // ── Stocks & ETFs ──────────────────────────────────────────────────────────
  for (const m of positionsMetrics(data.holdings, market, fx, data.projections ?? [])) {
    const h = m.holding
    const meta = metaBySymbol.get(h.symbol.toUpperCase())
    positions.push({
      id: h.id,
      assetClass: meta?.industry === 'ETF' || meta?.sector === 'ETF' ? 'etf' : 'stock',
      label: h.symbol,
      name: h.name,
      currency: normalizeCurrencyCode(m.priceCurrency),
      quantity: h.shares,
      valueLocal: m.price * h.shares,
      valueCZK: m.marketCZK,
      costLocal: h.avg_price * h.shares,
      costCZK: m.costCZK,
      sector: meta?.sector ?? null,
      region: meta?.region ?? null,
      liquidityTier: coerceTier(meta?.liquidity_tier, 'week'),
      annualIncomeCZK: m.annualDivCZK ?? 0,
      isLiability: false,
    })
  }

  // ── Cash ───────────────────────────────────────────────────────────────────
  for (const a of data.bankAccounts) {
    positions.push({
      id: a.id,
      assetClass: 'cash',
      label: a.name,
      name: `${a.name} · ${a.institution}`,
      currency: normalizeCurrencyCode(a.currency),
      quantity: 1,
      valueLocal: a.balance,
      valueCZK: toCZK(a.balance, a.currency, fx),
      costLocal: a.balance,
      costCZK: toCZK(a.balance, a.currency, fx),
      sector: null,
      region: null,
      liquidityTier: cashTier(a),
      annualIncomeCZK: toCZK(a.balance * a.interest_rate, a.currency, fx),
      isLiability: false,
    })
  }

  // ── Crypto (priced in USD) ─────────────────────────────────────────────────
  for (const c of data.cryptoHoldings) {
    const priceUSD = crypto.getPrice(c.coin_id, c.avg_cost_usd)
    positions.push({
      id: c.id,
      assetClass: 'crypto',
      label: c.symbol,
      name: c.name,
      currency: 'USD',
      quantity: c.amount,
      valueLocal: priceUSD * c.amount,
      valueCZK: toCZK(priceUSD * c.amount, 'USD', fx),
      costLocal: c.avg_cost_usd * c.amount,
      costCZK: toCZK(c.avg_cost_usd * c.amount, 'USD', fx),
      sector: null,
      region: 'Global',
      liquidityTier: coerceTier(c.liquidity_tier, 'week'),
      annualIncomeCZK: toCZK(priceUSD * c.amount * c.staking_apy, 'USD', fx),
      isLiability: false,
    })
  }

  // ── Real estate: asset row + mortgage row ──────────────────────────────────
  for (const p of data.realEstate) {
    const share = ownershipShare(p)
    positions.push({
      id: p.id,
      assetClass: 'realestate',
      label: p.name,
      name: p.address ? `${p.name} · ${p.address}` : p.name,
      currency: normalizeCurrencyCode(p.currency),
      quantity: share,
      valueLocal: p.current_value * share,
      valueCZK: toCZK(p.current_value * share, p.currency, fx),
      costLocal: p.purchase_price * share,
      costCZK: toCZK(p.purchase_price * share, p.currency, fx),
      sector: null,
      region: 'CZ',
      liquidityTier: coerceTier(
        p.liquidity_tier,
        p.is_primary_residence ? 'illiquid' : 'year'
      ),
      annualIncomeCZK: toCZK(p.monthly_rent * 12 * share, p.currency, fx),
      isLiability: false,
      isPrimaryResidence: p.is_primary_residence,
    })

    if (p.mortgage_balance > 0) {
      const debtLocal = p.mortgage_balance * share
      positions.push({
        id: `${p.id}:mortgage`,
        assetClass: 'realestate',
        label: `${p.name} — mortgage`,
        name: `Mortgage on ${p.name}`,
        currency: normalizeCurrencyCode(p.currency),
        quantity: share,
        valueLocal: -debtLocal,
        valueCZK: -toCZK(debtLocal, p.currency, fx),
        costLocal: -debtLocal,
        costCZK: -toCZK(debtLocal, p.currency, fx),
        sector: null,
        region: 'CZ',
        liquidityTier: 'illiquid',
        // Mortgage interest is a cost, not income; kept out of income totals.
        annualIncomeCZK: 0,
        isLiability: true,
        isPrimaryResidence: p.is_primary_residence,
      })
    }
  }

  return positions
}

export function totalsByClass(positions: Position[]): Record<AssetClass, number> {
  const totals: Record<AssetClass, number> = {
    stock: 0, etf: 0, cash: 0, crypto: 0, realestate: 0,
  }
  for (const p of positions) totals[p.assetClass] += p.valueCZK
  return totals
}

export const netWorthCZK = (positions: Position[]): number =>
  positions.reduce((s, p) => s + p.valueCZK, 0)

/**
 * Net worth you could actually deploy. Excludes the primary residence by
 * default — you cannot spend the house you live in — while still subtracting
 * its mortgage, since the debt is real either way.
 */
export function investableNetWorthCZK(
  positions: Position[],
  opts: { includePrimaryResidence?: boolean; includeProperty?: boolean } = {}
): number {
  return positions.reduce((sum, p) => {
    if (p.isLiability) return sum + p.valueCZK
    if (p.assetClass === 'realestate') {
      if (!opts.includeProperty) return sum
      if (p.isPrimaryResidence && !opts.includePrimaryResidence) return sum
    }
    return sum + p.valueCZK
  }, 0)
}

/** Total forward annual income across every asset class, in CZK. */
export const annualIncomeCZK = (positions: Position[]): number =>
  positions.reduce((s, p) => s + p.annualIncomeCZK, 0)

/** Assets only — liabilities excluded. Used for weights, where debt would distort shares. */
export const assetPositions = (positions: Position[]): Position[] =>
  positions.filter(p => !p.isLiability && p.valueCZK > 0)
