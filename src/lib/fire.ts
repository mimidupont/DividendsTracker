/**
 * fire.ts — financial independence maths.
 *
 * Everything here works in *real* (inflation-adjusted) terms, so today's
 * expense figure stays meaningful at the projected date without the user
 * having to inflate it themselves.
 */
import type { FinancialPlan, ExpenseLogRow } from './supabase'

export const DEFAULT_PLAN: Omit<FinancialPlan, 'profile_id' | 'updated_at'> = {
  annual_expenses_czk: 600000,
  annual_income_czk: null,
  monthly_contribution_czk: 0,
  swr_pct: 0.04,
  expected_real_return: 0.05,
  inflation_pct: 0.025,
  birth_year: null,
  target_retirement_age: null,
  include_property_in_fi: false,
  include_primary_residence: false,
}

/** The pot that sustains `annualExpenses` at a given safe withdrawal rate. */
export function fiNumber(annualExpenses: number, swr: number): number | null {
  if (!isFinite(annualExpenses) || annualExpenses <= 0) return null
  if (!isFinite(swr) || swr <= 0) return null
  return annualExpenses / swr
}

/** Progress toward FI as a fraction (0.42 = 42%). */
export function fiProgress(investableNetWorth: number, target: number | null): number | null {
  if (target == null || target <= 0 || !isFinite(investableNetWorth)) return null
  return investableNetWorth / target
}

/** Share of income kept rather than spent. Null when income is unknown. */
export function savingsRate(income: number | null, expenses: number): number | null {
  if (income == null || !isFinite(income) || income <= 0) return null
  if (!isFinite(expenses)) return null
  return (income - expenses) / income
}

/** What the portfolio would throw off today at the chosen withdrawal rate. */
export function currentSwrIncome(investableNetWorth: number, swr: number): number {
  if (!isFinite(investableNetWorth) || !isFinite(swr)) return 0
  return Math.max(0, investableNetWorth) * swr
}

/**
 * Years until the pot reaches the FI number.
 *
 * Solves FV = P(1+r)^n + PMT·((1+r)^n − 1)/r for n with monthly compounding.
 * Returns null when the target is unreachable — no contributions and already
 * short, or a zero/negative return with no contributions.
 */
export function yearsToFI(
  current: number,
  monthlyContribution: number,
  realReturn: number,
  target: number | null
): number | null {
  if (target == null || !isFinite(target) || target <= 0) return null
  if (!isFinite(current)) return null
  if (current >= target) return 0
  if (!isFinite(monthlyContribution) || monthlyContribution < 0) return null

  const r = Math.pow(1 + realReturn, 1 / 12) - 1

  // No growth: pure saving, or never
  if (Math.abs(r) < 1e-12) {
    if (monthlyContribution <= 0) return null
    return (target - current) / monthlyContribution / 12
  }

  if (monthlyContribution <= 0) {
    if (r <= 0 || current <= 0) return null
    const months = Math.log(target / current) / Math.log(1 + r)
    return isFinite(months) && months > 0 ? months / 12 : null
  }

  // FV = (P + PMT/r)(1+r)^n − PMT/r  →  solve for n
  const k = monthlyContribution / r
  const numerator = target + k
  const denominator = current + k
  if (denominator <= 0 || numerator <= 0) return null
  const months = Math.log(numerator / denominator) / Math.log(1 + r)
  return isFinite(months) && months > 0 ? months / 12 : null
}

/**
 * The pot that, left alone, compounds to the FI number by the target date.
 * Reaching it means you can stop contributing — "coast" — and still arrive.
 */
export function coastFireNumber(
  target: number | null,
  yearsToRetirement: number,
  realReturn: number
): number | null {
  if (target == null || !isFinite(yearsToRetirement) || yearsToRetirement < 0) return null
  const denom = Math.pow(1 + realReturn, yearsToRetirement)
  if (!isFinite(denom) || denom <= 0) return null
  return target / denom
}

/** The pot needed when part-time work covers some of the spending. */
export function baristaFireNumber(
  annualExpenses: number,
  partTimeIncome: number,
  swr: number
): number | null {
  const gap = annualExpenses - partTimeIncome
  if (gap <= 0) return 0
  return fiNumber(gap, swr)
}

/** Project the pot forward year by year, in real terms. */
export function projectPath(
  current: number,
  monthlyContribution: number,
  realReturn: number,
  years: number
): { year: number; value: number }[] {
  const out: { year: number; value: number }[] = []
  const r = Math.pow(1 + realReturn, 1 / 12) - 1
  let value = current
  out.push({ year: 0, value })
  for (let m = 1; m <= Math.round(years * 12); m++) {
    value = value * (1 + r) + monthlyContribution
    if (m % 12 === 0) out.push({ year: m / 12, value })
  }
  return out
}

export interface Milestone {
  label: string
  targetCZK: number
  reached: boolean
  yearsAway: number | null
}

/**
 * Absolute CZK milestones plus multiples of annual expenses — the second set
 * is the one that actually tracks independence.
 */
export function milestones(
  current: number,
  annualExpenses: number,
  monthlyContribution: number,
  realReturn: number
): Milestone[] {
  const absolute = [100_000, 250_000, 500_000, 1_000_000, 5_000_000, 10_000_000]
  const multiples = [1, 5, 10, 25]

  const rows: { label: string; targetCZK: number }[] = [
    ...absolute.map(v => ({ label: fmtShortCZK(v), targetCZK: v })),
    ...multiples.map(m => ({ label: `${m}× expenses`, targetCZK: annualExpenses * m })),
  ]

  return rows
    .filter(r => isFinite(r.targetCZK) && r.targetCZK > 0)
    .sort((a, b) => a.targetCZK - b.targetCZK)
    .map(r => ({
      label: r.label,
      targetCZK: r.targetCZK,
      reached: current >= r.targetCZK,
      yearsAway: current >= r.targetCZK
        ? 0
        : yearsToFI(current, monthlyContribution, realReturn, r.targetCZK),
    }))
}

function fmtShortCZK(v: number): string {
  if (v >= 1_000_000) return `${v / 1_000_000}M CZK`
  return `${v / 1000}k CZK`
}

/**
 * Annual expenses to plan against.
 *
 * Prefers observed spending once there is enough of it: three months of logged
 * expenses beats a number typed into a form once and never revisited.
 */
export function effectiveAnnualExpenses(
  plan: Pick<FinancialPlan, 'annual_expenses_czk'>,
  expenseLog: ExpenseLogRow[]
): { annualCZK: number; source: 'logged' | 'plan'; monthsOfData: number } {
  const byMonth: Record<string, number> = {}
  for (const row of expenseLog) {
    byMonth[row.month] = (byMonth[row.month] ?? 0) + row.amount_czk
  }
  const months = Object.keys(byMonth)
  if (months.length < 3) {
    return { annualCZK: plan.annual_expenses_czk, source: 'plan', monthsOfData: months.length }
  }

  const recent = months.sort().slice(-12)
  const total = recent.reduce((s, m) => s + byMonth[m], 0)
  return {
    annualCZK: (total / recent.length) * 12,
    source: 'logged',
    monthsOfData: months.length,
  }
}

/** Age at a future date, when the birth year is known. */
export function ageIn(birthYear: number | null, yearsFromNow: number): number | null {
  if (birthYear == null || !isFinite(birthYear)) return null
  return new Date().getFullYear() + yearsFromNow - birthYear
}
