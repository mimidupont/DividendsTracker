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
  DividendProjection, Holding, BankAccount, CryptoHolding, RealEstate, AssetMetadata, BondHolding,
} from './supabase'
import { toCZK, normalizeCurrencyCode, normalizeMoney, hasFxRate, fxRate } from './fx'
import { computeProjectedTotal, findProjection } from './projections'
import { valueBond, annualCouponLocal, bondLiquidity, yieldToMaturity, bondRisk } from './bonds'
import { todayISO } from './date'

/**
 * CZK value of a local cost, at the rate it was actually paid when known.
 * `frozenRate` is CZK per unit of the *major* currency (GBP, not GBp).
 */
export function costToCZK(
  amountLocal: number, currency: string, frozenRate: number | null | undefined,
  fx: Record<string, number>
): { czk: number; frozen: boolean } {
  if (frozenRate != null && isFinite(frozenRate) && frozenRate > 0) {
    return { czk: normalizeMoney(amountLocal, currency).amount * frozenRate, frozen: true }
  }
  return { czk: toCZK(amountLocal, currency, fx), frozen: false }
}

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
  /**
   * No live quote, but the user entered a price (delisted or unquoted ticker).
   * Valued at that price instead of cost; still not a live price.
   */
  isManualPrice: boolean
  changePercent: number | null
  marketCZK: number
  /** Cost at the FX rate it was paid (today's rate when that is unknown — see costFxFrozen). */
  costCZK: number
  plCZK: number
  /** P&L as a percentage of cost; null when there is no cost to measure against. */
  plPct: number | null
  /**
   * The part of plCZK that came from the exchange rate moving since purchase.
   * Null when the purchase rate is unknown (cost then uses today's rate and the
   * currency effect is invisible — the UI says so).
   */
  fxPLCZK: number | null
  /** True when cost is converted at the rate actually paid. */
  costFxFrozen: boolean
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
  const manual = holding.manual_price
  const isManualPrice = !isLivePrice && manual != null && isFinite(manual) && manual >= 0
  const price = isManualPrice ? manual! : market.getPrice(holding.symbol, holding.avg_price)

  // A quote can come back in a different currency than the position is booked
  // in (an ADR, a dual listing, or a London line quoted in pence). Convert the
  // live price with the currency it was actually quoted in; the cost basis
  // stays in the currency the user recorded.
  const priceCurrency = isLivePrice
    ? market.getQuoteCurrency(holding.symbol, holding.currency)
    : holding.currency

  const marketCZK = toCZK(price * holding.shares, priceCurrency, fx)
  const costLocal = holding.avg_price * holding.shares
  const cost      = costToCZK(costLocal, holding.currency, holding.avg_fx_czk, fx)
  const costCZK   = cost.czk
  const plCZK     = marketCZK - costCZK
  // Currency effect = cost re-valued at today's rate minus cost at the paid rate.
  const todayRate = fxRate(holding.currency, fx)
  const fxPLCZK = cost.frozen && todayRate != null
    ? normalizeMoney(costLocal, holding.currency).amount * todayRate - costCZK
    : null

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
    isManualPrice,
    changePercent: market.quotes[holding.symbol]?.changePercent ?? null,
    marketCZK,
    costCZK,
    plCZK,
    plPct: costCZK > 0 ? (plCZK / costCZK) * 100 : null,
    fxPLCZK,
    costFxFrozen: cost.frozen,
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
  /** Null when there is no cost basis to measure against. */
  plPct: number | null
  /** Sum of the known currency effects (positions with a frozen purchase rate). */
  fxPLCZK: number
  annualDivCZK: number
  /** Forward yield on market value, as a percentage; null with no market value. */
  yieldPct: number | null
  /** Forward yield on cost basis, as a percentage; null with no cost. */
  yieldOnCostPct: number | null
  /** Symbols whose CZK value could not be computed reliably. */
  fxProblems: string[]
  /** Dividend payers whose income is unknown (no live rate, no projection) — excluded from annualDivCZK. */
  incomeUnknown: string[]
  /** Symbols valued at cost because no live quote (and no manual price) arrived. */
  atCost: string[]
  /**
   * Foreign-currency symbols whose cost uses today's FX because the purchase
   * rate is unknown. A zero-cost position (RSUs, a gift) has no currency
   * effect to lose and is not listed.
   */
  costFxUnknown: string[]
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
    plPct: costCZK > 0 ? (plCZK / costCZK) * 100 : null,
    fxPLCZK: rows.reduce((s, r) => s + (r.fxPLCZK ?? 0), 0),
    annualDivCZK,
    yieldPct: marketCZK > 0 ? (annualDivCZK / marketCZK) * 100 : null,
    yieldOnCostPct: costCZK > 0 ? (annualDivCZK / costCZK) * 100 : null,
    fxProblems: rows.filter(r => r.fxUnavailable).map(r => r.holding.symbol),
    incomeUnknown: rows
      .filter(r => r.holding.is_dividend_payer && r.annualDivCZK == null)
      .map(r => r.holding.symbol),
    atCost: rows.filter(r => !r.isLivePrice && !r.isManualPrice).map(r => r.holding.symbol),
    costFxUnknown: Array.from(new Set(rows
      .filter(r => !r.costFxFrozen && normalizeCurrencyCode(r.holding.currency) !== 'CZK' &&
        r.holding.avg_price * r.holding.shares > 0)
      .map(r => r.holding.symbol))),
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

export type AssetClass = 'stock' | 'etf' | 'bond' | 'cash' | 'crypto' | 'realestate'

export const ASSET_CLASSES: AssetClass[] = ['stock', 'etf', 'bond', 'cash', 'crypto', 'realestate']
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
  /**
   * False when the value is not a live market price: a stock or coin with no
   * quote (valued at cost), a bond with no entered price. Cash and property
   * are true (their value *is* the entered figure).
   */
  isLivePrice: boolean
  /** Valued at a price the user entered because no quote exists (stocks only). */
  isManualPrice?: boolean
  /** Modified duration, for bonds with a known yield — drives rate-shock scenarios. */
  duration?: number | null
  /** A fund (ETF, bond ETF): one line here, many underlying holdings. */
  isFund?: boolean
}

/** Minimal shape of the crypto price hook this module needs. */
export interface CryptoPriceSource {
  getPrice: (coinId: string, fallback: number) => number
  hasPrice?: (coinId: string) => boolean
}

export interface BuildPositionsInput {
  holdings: Holding[]
  bankAccounts: BankAccount[]
  cryptoHoldings: CryptoHolding[]
  realEstate: RealEstate[]
  bondHoldings?: BondHolding[]
  projections?: DividendProjection[]
  assetMetadata?: AssetMetadata[]
}

/** How a stock-table holding is classified: bond ETFs count as fixed income. */
export function holdingAssetClass(meta: AssetMetadata | undefined): AssetClass {
  const type = (meta?.asset_type ?? '').toLowerCase()
  if (type === 'bond_etf' || type === 'bond') return 'bond'
  if (type === 'etf' || meta?.industry === 'ETF' || meta?.sector === 'ETF') return 'etf'
  return 'stock'
}

function coerceTier(raw: string | null | undefined, fallback: LiquidityTier): LiquidityTier {
  return LIQUIDITY_TIERS.includes(raw as LiquidityTier) ? (raw as LiquidityTier) : fallback
}

/**
 * Default liquidity for a cash account. A term deposit whose maturity is still
 * far out is not instant money, however the row is labelled.
 */
export function cashTier(a: BankAccount, today: string = todayISO()): LiquidityTier {
  // Migration 002 gave every existing row liquidity_tier = 'instant' by
  // default, so for a term deposit that value says nothing — it was never
  // chosen. Only a tier *other* than the default overrides the maturity date.
  const explicit = LIQUIDITY_TIERS.includes(a.liquidity_tier as LiquidityTier)
    ? (a.liquidity_tier as LiquidityTier) : null
  if (a.account_type !== 'fixed_deposit') return explicit ?? 'instant'
  if (explicit && explicit !== 'instant') return explicit
  if (!a.maturity_date) return 'month'
  const daysOut = (Date.parse(a.maturity_date) - Date.parse(today)) / 86_400_000
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
  crypto: CryptoPriceSource,
  today: string = todayISO()
): Position[] {
  const metaBySymbol = new Map(
    (data.assetMetadata ?? []).map(m => [m.symbol.toUpperCase(), m])
  )
  const positions: Position[] = []

  // ── Stocks & ETFs ──────────────────────────────────────────────────────────
  for (const m of positionsMetrics(data.holdings, market, fx, data.projections ?? [])) {
    const h = m.holding
    const meta = metaBySymbol.get(h.symbol.toUpperCase())
    // `currency` is the major-unit code, so the local amounts must be folded to
    // match it: a London quote comes back in pence, and leaving 1000 GBp on a
    // row labelled GBP overstated currency exposure a hundredfold.
    const value = normalizeMoney(m.price * h.shares, m.priceCurrency)
    const cost = normalizeMoney(h.avg_price * h.shares, h.currency)
    positions.push({
      id: h.id,
      assetClass: holdingAssetClass(meta),
      isFund: holdingAssetClass(meta) !== 'stock',
      label: h.symbol,
      name: h.name,
      currency: value.ccy,
      quantity: h.shares,
      valueLocal: value.amount,
      valueCZK: m.marketCZK,
      costLocal: cost.amount,
      costCZK: m.costCZK,
      sector: meta?.sector ?? null,
      region: meta?.region ?? null,
      liquidityTier: coerceTier(meta?.liquidity_tier, 'week'),
      annualIncomeCZK: m.annualDivCZK ?? 0,
      isLiability: false,
      isLivePrice: m.isLivePrice,
      isManualPrice: m.isManualPrice,
    })
  }

  // ── Cash ───────────────────────────────────────────────────────────────────
  for (const a of data.bankAccounts) {
    const bal = normalizeMoney(a.balance, a.currency)
    positions.push({
      id: a.id,
      assetClass: 'cash',
      label: a.name,
      name: `${a.name} · ${a.institution}`,
      currency: bal.ccy,
      quantity: 1,
      valueLocal: bal.amount,
      valueCZK: toCZK(a.balance, a.currency, fx),
      costLocal: bal.amount,
      costCZK: toCZK(a.balance, a.currency, fx),
      sector: null,
      region: null,
      liquidityTier: cashTier(a, today),
      annualIncomeCZK: toCZK(a.balance * a.interest_rate, a.currency, fx),
      isLiability: false,
      isLivePrice: true,
    })
  }

  // ── Bonds (held directly) ──────────────────────────────────────────────────
  for (const b of data.bondHoldings ?? []) {
    if (!b.is_active || b.quantity <= 0) continue
    const v = valueBond(b, today)
    const ytm = yieldToMaturity(b, v.cleanPct, today)
    const risk = ytm != null ? bondRisk(b, ytm, today) : null
    const value = normalizeMoney(v.valueLocal, b.currency)
    const cost = normalizeMoney(v.costLocal, b.currency)
    positions.push({
      id: b.id,
      assetClass: 'bond',
      label: b.isin,
      name: b.name,
      currency: value.ccy,
      quantity: b.quantity,
      valueLocal: value.amount,
      valueCZK: toCZK(v.valueLocal, b.currency, fx),
      costLocal: cost.amount,
      costCZK: costToCZK(v.costLocal, b.currency, b.purchase_fx_czk, fx).czk,
      sector: null,
      region: b.currency.toUpperCase() === 'CZK' ? 'CZ' : null,
      liquidityTier: coerceTier(b.liquidity_tier, bondLiquidity(b, today)),
      annualIncomeCZK: toCZK(annualCouponLocal(b, today), b.currency, fx),
      isLiability: false,
      isLivePrice: v.isMarketPrice || v.basis === 'redemption' || v.basis === 'par',
      // A redeemable savings bond can be cashed at par, so its price does not
      // move with yields.
      duration: b.redeemable_early ? 0 : risk?.modified ?? null,
    })
  }

  // ── Crypto (priced in USD) ─────────────────────────────────────────────────
  for (const c of data.cryptoHoldings) {
    const priceUSD = crypto.getPrice(c.coin_id, c.avg_cost_usd)
    const live = crypto.hasPrice ? crypto.hasPrice(c.coin_id) : true
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
      costCZK: costToCZK(c.avg_cost_usd * c.amount, 'USD', c.avg_fx_czk, fx).czk,
      sector: null,
      region: 'Global',
      liquidityTier: coerceTier(c.liquidity_tier, 'week'),
      annualIncomeCZK: toCZK(priceUSD * c.amount * c.staking_apy, 'USD', fx),
      isLiability: false,
      isLivePrice: live,
    })
  }

  // ── Real estate: asset row + mortgage row ──────────────────────────────────
  for (const p of data.realEstate) {
    const share = ownershipShare(p)
    const value = normalizeMoney(p.current_value * share, p.currency)
    const cost = normalizeMoney(p.purchase_price * share, p.currency)
    positions.push({
      id: p.id,
      assetClass: 'realestate',
      label: p.name,
      name: p.address ? `${p.name} · ${p.address}` : p.name,
      currency: value.ccy,
      quantity: share,
      valueLocal: value.amount,
      valueCZK: toCZK(p.current_value * share, p.currency, fx),
      costLocal: cost.amount,
      costCZK: toCZK(p.purchase_price * share, p.currency, fx),
      sector: null,
      region: 'CZ',
      liquidityTier: coerceTier(
        p.liquidity_tier,
        p.is_primary_residence ? 'illiquid' : 'year'
      ),
      // Rent after running costs (before mortgage interest and income tax).
      annualIncomeCZK: toCZK(Math.max(0, p.monthly_rent * 12 - (p.annual_costs ?? 0)) * share, p.currency, fx),
      isLiability: false,
      isPrimaryResidence: p.is_primary_residence,
      isLivePrice: true,
    })

    if (p.mortgage_balance > 0) {
      const debtLocal = p.mortgage_balance * share
      const debt = normalizeMoney(debtLocal, p.currency)
      positions.push({
        id: `${p.id}:mortgage`,
        assetClass: 'realestate',
        label: `${p.name} — mortgage`,
        name: `Mortgage on ${p.name}`,
        currency: debt.ccy,
        quantity: share,
        valueLocal: -debt.amount,
        valueCZK: -toCZK(debtLocal, p.currency, fx),
        costLocal: -debt.amount,
        costCZK: -toCZK(debtLocal, p.currency, fx),
        sector: null,
        region: 'CZ',
        liquidityTier: 'illiquid',
        // Mortgage interest is a cost, not income; kept out of income totals.
        annualIncomeCZK: 0,
        isLiability: true,
        isPrimaryResidence: p.is_primary_residence,
        isLivePrice: true,
      })
    }
  }

  return positions
}

export function totalsByClass(positions: Position[]): Record<AssetClass, number> {
  const totals: Record<AssetClass, number> = {
    stock: 0, etf: 0, bond: 0, cash: 0, crypto: 0, realestate: 0,
  }
  for (const p of positions) totals[p.assetClass] += p.valueCZK
  return totals
}

export const netWorthCZK = (positions: Position[]): number =>
  positions.reduce((s, p) => s + p.valueCZK, 0)

/**
 * Net worth you could actually deploy. The primary residence is excluded by
 * default — you cannot spend the house you live in — and investment property
 * is included unless `includeProperty` is explicitly false.
 *
 * A property and its mortgage are always counted or dropped **together**.
 * Subtracting the debt for an asset that isn't in the total would report an
 * investable net worth below zero for anyone with a mortgaged home.
 */
export interface InvestableOpts { includePrimaryResidence?: boolean; includeProperty?: boolean }

/** The positions that count towards investable net worth (property and its mortgage kept as a pair). */
export function investablePositions(positions: Position[], opts: InvestableOpts = {}): Position[] {
  const includeProperty = opts.includeProperty ?? true
  return positions.filter(p => {
    if (p.assetClass !== 'realestate') return true
    if (p.isPrimaryResidence) return !!opts.includePrimaryResidence
    return includeProperty
  })
}

export function investableNetWorthCZK(positions: Position[], opts: InvestableOpts = {}): number {
  return netWorthCZK(investablePositions(positions, opts))
}

/**
 * Investable net worth split by asset class — the starting point for Monte
 * Carlo, so the simulation starts from the same pot /fire measures.
 *
 * Property is returned **gross** under `realestate` with its mortgages under
 * `debtCZK` (a positive number): the asset is what moves with prices, the debt
 * does not, and netting them first would model levered equity as unlevered.
 */
export function investableByClass(
  positions: Position[], opts: InvestableOpts = {}
): { byClass: Record<AssetClass, number>; debtCZK: number } {
  const byClass = totalsByClass([])
  let debtCZK = 0
  for (const p of investablePositions(positions, opts)) {
    if (p.isLiability) debtCZK += -p.valueCZK
    else byClass[p.assetClass] += p.valueCZK
  }
  return { byClass, debtCZK }
}

/** Forward annual income by asset class, in CZK. */
export function incomeByClass(positions: Position[]): Record<AssetClass, number> {
  const out = totalsByClass([])
  for (const p of positions) out[p.assetClass] += p.annualIncomeCZK
  return out
}

/** Cost of everything with a cost basis (cash excluded — it has none), and its current value. */
export function investedCostAndValue(positions: Position[]): { costCZK: number; valueCZK: number } {
  let costCZK = 0, valueCZK = 0
  for (const p of positions) {
    if (p.isLiability || p.assetClass === 'cash') continue
    costCZK += p.costCZK
    valueCZK += p.valueCZK
  }
  return { costCZK, valueCZK }
}

/** Positions valued at cost or an entered figure instead of a live market price. */
export const unpricedPositions = (positions: Position[]): Position[] =>
  positions.filter(p => !p.isLivePrice && !p.isLiability)

/** Total forward annual income across every asset class, in CZK. */
export const annualIncomeCZK = (positions: Position[]): number =>
  positions.reduce((s, p) => s + p.annualIncomeCZK, 0)

/**
 * Currencies present in the portfolio that have no CZK rate, in any asset class.
 *
 * `toCZK` deliberately leaves an unknown currency unconverted rather than
 * converting it at some other currency's rate — but that means a bank account,
 * coin or property in such a currency is added to net worth at 1:1 with nothing
 * on screen to say so. Callers use this to render that warning.
 */
export const unconvertibleCurrencies = (
  positions: Position[],
  fx: Record<string, number>
): string[] => {
  const seen: string[] = []
  for (const p of positions) {
    if (hasFxRate(p.currency, fx)) continue
    if (seen.indexOf(p.currency) < 0) seen.push(p.currency)
  }
  return seen.sort()
}

/** Assets only — liabilities excluded. Used for weights, where debt would distort shares. */
export const assetPositions = (positions: Position[]): Position[] =>
  positions.filter(p => !p.isLiability && p.valueCZK > 0)
