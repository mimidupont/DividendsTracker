import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
  created_at: string
  updated_at: string
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
  created_at: string
  updated_at: string
}
