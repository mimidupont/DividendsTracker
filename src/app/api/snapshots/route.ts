import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export interface PortfolioSnapshot {
  snapshot_date: string
  total_value_czk: number
  stocks_czk: number
  cash_czk: number
  crypto_czk: number
  realestate_czk: number
}

// GET /api/snapshots?profileId=xxx&days=365
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const profileId = searchParams.get('profileId')
  const days      = parseInt(searchParams.get('days') ?? '365', 10)

  if (!profileId) {
    return NextResponse.json({ error: 'profileId required' }, { status: 400 })
  }

  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('snapshot_date, total_value_czk, stocks_czk, cash_czk, crypto_czk, realestate_czk')
    .eq('profile_id', profileId)
    .gte('snapshot_date', sinceStr)
    .order('snapshot_date', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ snapshots: data ?? [] })
}

// POST /api/snapshots
// Body: { profileId, total_value_czk, stocks_czk, cash_czk, crypto_czk, realestate_czk, fx_usd, fx_eur }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { profileId, total_value_czk, stocks_czk, cash_czk, crypto_czk, realestate_czk, fx_usd, fx_eur } = body

  if (!profileId || total_value_czk == null) {
    return NextResponse.json({ error: 'profileId and total_value_czk required' }, { status: 400 })
  }

  const today = new Date().toISOString().slice(0, 10)

  const { error } = await supabase
    .from('portfolio_snapshots')
    .upsert({
      profile_id: profileId,
      snapshot_date: today,
      total_value_czk,
      stocks_czk:    stocks_czk    ?? 0,
      cash_czk:      cash_czk      ?? 0,
      crypto_czk:    crypto_czk    ?? 0,
      realestate_czk: realestate_czk ?? 0,
      fx_usd:        fx_usd        ?? 23.50,
      fx_eur:        fx_eur        ?? 25.60,
    }, { onConflict: 'profile_id,snapshot_date' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, date: today })
}
