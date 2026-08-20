import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * Set when the environment is not configured. Constructing the client with
 * `undefined` (as this file used to, via `!`) makes every query fail with an
 * opaque fetch error that reads like a network blip; the UI surfaces this
 * message instead. Not thrown at import time — that would break `next build`,
 * which evaluates this module without the runtime environment.
 */
export const supabaseConfigError: string | null =
  supabaseUrl && supabaseAnonKey
    ? null
    : 'Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see README).'

if (supabaseConfigError && typeof window !== 'undefined') {
  console.error(`[supabase] ${supabaseConfigError}`)
}

export const supabase = createClient(
  supabaseUrl ?? 'http://localhost:54321',
  supabaseAnonKey ?? 'missing-anon-key'
)

export interface Holding {
  id: string
  symbol: string
  name: string
  shares: number
  avg_price: number
  currency: string
  exchange: string | null
  purchase_date: string | null
  is_dividend_payer: boolean
  created_at: string
  updated_at: string
}

export interface HoldingLot {
  id: string
  holding_id: string
  symbol: string
  shares: number
  purchase_price: number
  purchase_date: string | null
  notes: string | null
  created_at: string
}

export interface DividendReceived {
  id: string
  symbol: string
  payment_date: string
  ex_date: string | null
  amount_per_share: number
  shares_held: number
  gross_amount: number
  withholding_tax: number
  net_amount: number
  currency: string
  drip_shares_added: number | null
  drip_price: number | null
  notes: string | null
  created_at: string
}

export interface DividendProjection {
  id: string
  symbol: string
  year: number
  projected_div_per_share: number | null
  projected_yield: number | null
  growth_rate: number
  projected_total: number | null
  currency: string
  notes: string | null
  updated_at: string
}

export interface BankAccount {
  id: string
  name: string
  institution: string
  account_type: 'savings' | 'checking' | 'money_market' | 'fixed_deposit'
  balance: number
  currency: string
  interest_rate: number
  interest_type: string
  maturity_date: string | null
  notes: string | null
  is_active: boolean
  liquidity_tier: string | null
  created_at: string
  updated_at: string
}

export interface BankInterestReceived {
  id: string
  account_id: string
  payment_date: string
  gross_amount: number
  tax_withheld: number
  net_amount: number
  currency: string
  notes: string | null
  created_at: string
}

export interface CryptoHolding {
  id: string
  coin_id: string
  symbol: string
  name: string
  amount: number
  avg_cost_usd: number
  wallet_label: string | null
  purchase_date: string | null
  staking_apy: number
  notes: string | null
  liquidity_tier: string | null
  created_at: string
  updated_at: string
}

// ─── v2 tables ────────────────────────────────────────────────────────────────

export type TransactionType =
  | 'buy' | 'sell' | 'deposit' | 'withdrawal'
  | 'dividend' | 'interest' | 'rent' | 'fee' | 'tax' | 'transfer' | 'adjustment'

export type TxnAssetClass = 'stock' | 'cash' | 'crypto' | 'realestate' | 'none'

export interface Transaction {
  id: string
  profile_id: string
  txn_date: string
  type: TransactionType
  asset_class: TxnAssetClass
  symbol: string | null
  asset_id: string | null
  quantity: number | null
  price: number | null
  /** Signed gross in `currency`: positive = in, negative = out. */
  amount: number
  fee: number
  tax: number
  currency: string
  /** CZK per 1 unit of `currency`, frozen at transaction time. */
  fx_rate_czk: number
  /** Generated column: amount * fx_rate_czk. */
  amount_czk: number
  /** True when money crosses the boundary of your wealth (deposits, withdrawals). */
  is_external: boolean
  counterparty_account_id: string | null
  notes: string | null
  created_at: string
}

export interface AssetMetadata {
  id: string
  profile_id: string
  symbol: string
  sector: string | null
  industry: string | null
  region: string | null
  country: string | null
  liquidity_tier: string | null
  is_hedged: boolean
  notes: string | null
}

export type TargetScope = 'asset_class' | 'sector' | 'region' | 'symbol'

export interface AllocationTarget {
  id: string
  profile_id: string
  scope: TargetScope
  bucket: string
  /** Decimal fraction, 0–1. */
  target_pct: number
  band_pct: number
  min_pct: number | null
  max_pct: number | null
  notes: string | null
  updated_at: string
}

export interface BenchmarkPrice {
  id: string
  symbol: string
  price_date: string
  close: number
  currency: string
}

export interface BenchmarkConfig {
  profile_id: string
  primary_benchmark: string
  secondary_benchmark: string
  updated_at: string
}

export interface FinancialPlan {
  profile_id: string
  annual_expenses_czk: number
  annual_income_czk: number | null
  monthly_contribution_czk: number
  /** Decimal fractions: 4% is 0.04. */
  swr_pct: number
  expected_real_return: number
  inflation_pct: number
  birth_year: number | null
  target_retirement_age: number | null
  include_property_in_fi: boolean
  include_primary_residence: boolean
  updated_at: string
}

export interface ExpenseLogRow {
  id: string
  profile_id: string
  month: string
  amount_czk: number
  category: string | null
  notes: string | null
}

export interface ScenarioRow {
  id: string
  profile_id: string
  name: string
  description: string | null
  shocks: Record<string, unknown>
  is_preset: boolean
  created_at: string
}

export interface MarketAssumption {
  id: string
  profile_id: string
  asset_class: string
  expected_real_return: number
  volatility: number
}

export type BondType =
  | 'government' | 'corporate' | 'municipal' | 'supranational' | 'inflation_linked'

export type DayCount = 'ACT/ACT' | 'ACT/365' | '30/360'

export interface Bond {
  id: string
  profile_id: string
  name: string
  issuer: string
  isin: string | null
  bond_type: BondType
  country: string | null
  currency: string
  /** Nominal of a single unit. An OAT is quoted per 1 EUR of nominal. */
  face_value: number
  quantity: number
  /** Clean prices, as a percentage of par: 92.35 means 92.35%, not 92.35 EUR. */
  purchase_price_pct: number
  /** Latest clean market price. Null means "not marked" — valued at cost. */
  current_price_pct: number | null
  /** Decimal fraction: 3% is 0.03. */
  coupon_rate: number
  coupons_per_year: number
  day_count: DayCount
  issue_date: string | null
  maturity_date: string
  purchase_date: string | null
  /** Coupon couru paid to the seller at purchase, in `currency`. */
  accrued_at_purchase: number
  /** Decimal fraction. */
  withholding_tax_pct: number
  is_inflation_linked: boolean
  /** OAT€i / OATi indexation coefficient; scales nominal and coupons alike. */
  index_ratio: number
  liquidity_tier: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface BondCouponReceived {
  id: string
  profile_id: string
  bond_id: string
  payment_date: string
  gross_amount: number
  tax_withheld: number
  net_amount: number
  currency: string
  notes: string | null
  created_at: string
}

export interface RealEstate {
  id: string
  name: string
  property_type: 'residential' | 'commercial' | 'land' | 'reit'
  address: string | null
  purchase_price: number
  current_value: number
  currency: string
  purchase_date: string | null
  monthly_rent: number
  mortgage_balance: number
  mortgage_rate: number
  monthly_mortgage: number
  ownership_pct: number
  notes: string | null
  is_primary_residence: boolean
  liquidity_tier: string | null
  created_at: string
  updated_at: string
}
