/**
 * scenarios.ts — stress tests.
 *
 * The asymmetry that matters: when property falls, the mortgage does not. That
 * is the whole point of the property scenario, and the UI should show equity
 * going negative when it does.
 */
import type { Position, AssetClass } from './portfolio'
import { netWorthCZK, investableNetWorthCZK, annualIncomeCZK } from './portfolio'
import { toCZK } from './fx'
import { runwaySummary } from './runway'
import { fiNumber, fiProgress, yearsToFI } from './fire'
import type { FinancialPlan } from './supabase'

export interface Shocks {
  /** Decimal fractions: -0.30 = a 30% fall. */
  equity_pct?: number
  crypto_pct?: number
  property_pct?: number
  /** Per-currency move against CZK: -0.15 = the currency loses 15% vs CZK. */
  fx?: Record<string, number>
  /** Change in deposit rates, as a fraction of current rates. */
  rates_pct?: number
  /**
   * Parallel shift in bond yields, in basis points: 200 = yields rise 2pp.
   *
   * Distinct from `rates_pct` on purpose. A deposit rate move changes the
   * interest a cash balance earns and leaves the balance itself alone; a yield
   * move changes what a bond is *worth*, by roughly its duration, while the
   * coupon it pays does not move at all.
   */
  rates_bps?: number
  rent_vacancy_pct?: number
  expense_shock_pct?: number
  income_loss_months?: number
}

export interface ClassImpact {
  before: number
  after: number
  delta: number
}

export interface ScenarioResult {
  netWorthBefore: number
  netWorthAfter: number
  deltaCZK: number
  deltaPct: number
  byClass: Record<AssetClass, ClassImpact>
  annualIncomeBefore: number
  annualIncomeAfter: number
  runwayMonthsBefore: number | null
  runwayMonthsAfter: number | null
  fiProgressBefore: number | null
  fiProgressAfter: number | null
  yearsToFIDelta: number | null
  /** Property equity after the shock; negative means underwater. */
  propertyEquityAfter: number
  shockedPositions: Position[]
}

const EMPTY_CLASS: Record<AssetClass, ClassImpact> = {
  stock: { before: 0, after: 0, delta: 0 },
  etf: { before: 0, after: 0, delta: 0 },
  bond: { before: 0, after: 0, delta: 0 },
  cash: { before: 0, after: 0, delta: 0 },
  crypto: { before: 0, after: 0, delta: 0 },
  realestate: { before: 0, after: 0, delta: 0 },
}

/**
 * Apply a scenario to the position set.
 *
 * FX shocks hit `valueLocal` before conversion, so a currency move correctly
 * touches only foreign-denominated assets and leaves CZK ones alone.
 */
export function applyScenario(
  positions: Position[],
  plan: Pick<FinancialPlan, 'annual_expenses_czk' | 'swr_pct' | 'expected_real_return' | 'monthly_contribution_czk' | 'include_primary_residence' | 'include_property_in_fi'>,
  shocks: Shocks,
  fx: Record<string, number>
): ScenarioResult {
  const shocked: Position[] = positions.map(p => {
    let valueLocal = p.valueLocal
    let annualIncomeCZKAfter = p.annualIncomeCZK

    // Asset price shocks — liabilities are deliberately untouched
    if (!p.isLiability) {
      if (p.assetClass === 'stock' || p.assetClass === 'etf') {
        valueLocal *= 1 + (shocks.equity_pct ?? 0)
      } else if (p.assetClass === 'crypto') {
        valueLocal *= 1 + (shocks.crypto_pct ?? 0)
      } else if (p.assetClass === 'bond') {
        // Price response is duration x the yield shift. A position with no
        // solvable duration (a matured line) is left alone rather than shocked
        // by some stand-in number.
        const shiftBp = shocks.rates_bps ?? 0
        if (shiftBp !== 0 && p.modifiedDuration != null) {
          valueLocal = Math.max(0, valueLocal * (1 - p.modifiedDuration * (shiftBp / 10_000)))
        }
      } else if (p.assetClass === 'realestate') {
        valueLocal *= 1 + (shocks.property_pct ?? 0)
        annualIncomeCZKAfter *= 1 + (shocks.rent_vacancy_pct ?? 0)
      }
    }

    // A bond's coupon is contractual: the issuer pays the same amount whatever
    // yields do. Income is deliberately untouched above.

    // Income shocks that follow the asset price
    if (p.assetClass === 'cash') {
      annualIncomeCZKAfter *= 1 + (shocks.rates_pct ?? 0)
    } else if ((p.assetClass === 'stock' || p.assetClass === 'etf') && shocks.equity_pct) {
      // Dividends are stickier than prices; a 30% price fall does not halve
      // the payout. Applied at a third of the equity shock as a rough rule.
      annualIncomeCZKAfter *= 1 + (shocks.equity_pct ?? 0) / 3
    }

    // FX shock applies to the currency the asset is actually denominated in.
    // The base currency cannot move against itself, so a stray CZK entry in the
    // shock set is ignored on value as well as on income.
    const fxShock = p.currency === 'CZK' ? 0 : (shocks.fx?.[p.currency] ?? 0)
    const shockedRate = 1 + fxShock

    return {
      ...p,
      valueLocal,
      valueCZK: toCZK(valueLocal, p.currency, fx) * shockedRate,
      annualIncomeCZK: annualIncomeCZKAfter * shockedRate,
    }
  })

  // ── Aggregate ──
  const byClass: Record<AssetClass, ClassImpact> = JSON.parse(JSON.stringify(EMPTY_CLASS))
  for (const p of positions) byClass[p.assetClass].before += p.valueCZK
  for (const p of shocked) byClass[p.assetClass].after += p.valueCZK
  for (const k of Object.keys(byClass) as AssetClass[]) {
    byClass[k].delta = byClass[k].after - byClass[k].before
  }

  const netWorthBefore = netWorthCZK(positions)
  const netWorthAfter = netWorthCZK(shocked)

  const expensesBefore = plan.annual_expenses_czk
  const expensesAfter = expensesBefore * (1 + (shocks.expense_shock_pct ?? 0))
  const monthlyBefore = expensesBefore / 12
  const monthlyAfter = expensesAfter / 12

  const investableBefore = investableNetWorthCZK(positions, {
    includePrimaryResidence: plan.include_primary_residence,
    includeProperty: plan.include_property_in_fi,
  })
  const investableAfter = investableNetWorthCZK(shocked, {
    includePrimaryResidence: plan.include_primary_residence,
    includeProperty: plan.include_property_in_fi,
  })

  const targetBefore = fiNumber(expensesBefore, plan.swr_pct)
  const targetAfter = fiNumber(expensesAfter, plan.swr_pct)

  const yearsBefore = yearsToFI(
    investableBefore, plan.monthly_contribution_czk, plan.expected_real_return, targetBefore)
  // A job loss stops contributions for the affected months; modelled simply as
  // no contributions at all during the shock.
  const contributionAfter = (shocks.income_loss_months ?? 0) > 0
    ? 0
    : plan.monthly_contribution_czk
  const yearsAfter = yearsToFI(
    investableAfter, contributionAfter, plan.expected_real_return, targetAfter)

  const runwayBefore = runwaySummary(positions, monthlyBefore)
  const runwayAfter = runwaySummary(shocked, monthlyAfter)

  return {
    netWorthBefore,
    netWorthAfter,
    deltaCZK: netWorthAfter - netWorthBefore,
    deltaPct: netWorthBefore !== 0 ? (netWorthAfter - netWorthBefore) / Math.abs(netWorthBefore) : 0,
    byClass,
    annualIncomeBefore: annualIncomeCZK(positions),
    annualIncomeAfter: annualIncomeCZK(shocked),
    runwayMonthsBefore: runwayBefore.emergencyMonths,
    runwayMonthsAfter: runwayAfter.emergencyMonths,
    fiProgressBefore: fiProgress(investableBefore, targetBefore),
    fiProgressAfter: fiProgress(investableAfter, targetAfter),
    yearsToFIDelta:
      yearsBefore != null && yearsAfter != null ? yearsAfter - yearsBefore : null,
    propertyEquityAfter: shocked
      .filter(p => p.assetClass === 'realestate')
      .reduce((s, p) => s + p.valueCZK, 0),
    shockedPositions: shocked,
  }
}

export interface ScenarioPreset {
  name: string
  description: string
  shocks: Shocks
}

/** Historical and hypothetical presets, shipped so the page is useful on day one. */
export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    name: '2008 replay',
    description: 'Global financial crisis: equities halve, property slides, rates collapse — government bonds rally as money runs to safety.',
    shocks: { equity_pct: -0.50, property_pct: -0.20, crypto_pct: -0.60, rates_pct: -0.80, rates_bps: -150 },
  },
  {
    name: 'COVID crash',
    description: 'Fast 34% equity drawdown with a sharp recovery — tests nerve more than solvency.',
    shocks: { equity_pct: -0.34, crypto_pct: -0.50, rates_pct: -0.60 },
  },
  {
    name: 'Dot-com',
    description: 'Tech-led rout: concentrated growth names fall hardest.',
    shocks: { equity_pct: -0.45, crypto_pct: -0.70 },
  },
  {
    name: 'CZK strengthens 15%',
    description: 'The koruna gains against USD and EUR — a pure FX hit for a foreign-heavy book.',
    shocks: { fx: { USD: -0.15, EUR: -0.15, GBP: -0.15 } },
  },
  {
    name: 'Crypto winter',
    description: 'Digital assets fall 70% and stay there.',
    shocks: { crypto_pct: -0.70 },
  },
  {
    name: 'Job loss',
    description: 'Six months without income; spending continues and contributions stop.',
    shocks: { income_loss_months: 6 },
  },
  {
    name: 'Stagflation',
    description: 'Equities fall, living costs rise, deposit rates climb — and long bonds are repriced hard.',
    shocks: { equity_pct: -0.20, expense_shock_pct: 0.15, rates_pct: 0.50, rates_bps: 250 },
  },
  {
    name: 'Rates +200bp',
    description: 'A parallel 2pp rise in yields. Coupons keep paying; long-dated bonds lose the most, by duration.',
    shocks: { rates_bps: 200, rates_pct: 0.5 },
  },
  {
    name: '2022 replay',
    description: 'Bonds and equities fall together — the year the classic hedge stopped working.',
    shocks: { equity_pct: -0.19, rates_bps: 250, crypto_pct: -0.64, expense_shock_pct: 0.08 },
  },
]

/** Waterfall steps from starting net worth to the shocked figure. */
export function waterfall(result: ScenarioResult): { label: string; delta: number }[] {
  const steps: { label: string; delta: number }[] = []
  const classLabels: Record<AssetClass, string> = {
    stock: 'Stocks', etf: 'ETFs', bond: 'Bonds', cash: 'Cash', crypto: 'Crypto', realestate: 'Real estate',
  }
  for (const k of Object.keys(result.byClass) as AssetClass[]) {
    const delta = result.byClass[k].delta
    if (Math.abs(delta) > 0.5) steps.push({ label: classLabels[k], delta })
  }
  return steps.sort((a, b) => a.delta - b.delta)
}
