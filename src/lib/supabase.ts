import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types matching the database schema
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
