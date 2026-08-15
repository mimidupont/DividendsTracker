import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Checked per request rather than thrown at import time, which would fail the
// build (module scope is evaluated without the runtime environment).
const configError = supabaseUrl && supabaseAnonKey
  ? null
  : 'Supabase is not configured on the server — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'

const supabase = createClient(
  supabaseUrl ?? 'http://localhost:54321',
  supabaseAnonKey ?? 'missing-anon-key'
)

export interface PortfolioSnapshot {
  snapshot_date: string
  total_value_czk: number
  stocks_czk: number
  cash_czk: number
  crypto_czk: number
  realestate_czk: number
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Columns every install has, since the first schema. */
const CORE_COLUMNS =
  'snapshot_date, total_value_czk, stocks_czk, cash_czk, crypto_czk, realestate_czk'

/** Added by migration 005 — absent on a database created from an older schema. */
const EXPOSURE_COLUMNS =
  'exposure_usd_local, exposure_eur_local, exposure_czk_local, exposure_other_czk, fx_usd, fx_eur, fx_gbp'

/** PostgREST's code for "no such column". */
const isMissingColumn = (error: { code?: string; message?: string } | null): boolean => {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  const msg = (error.message ?? '').toLowerCase()
  return msg.includes('column') && msg.includes('does not exist')
}

// GET /api/snapshots?profileId=xxx&days=365
export async function GET(req: NextRequest) {
  if (configError) return NextResponse.json({ error: configError }, { status: 500 })
  const { searchParams } = new URL(req.url)
  const profileId = searchParams.get('profileId')

  // A non-numeric ?days= used to produce NaN and then an "Invalid Date",
  // which Postgres rejected — the chart just silently stayed empty.
  const parsedDays = Number.parseInt(searchParams.get('days') ?? '365', 10)
  const days = Number.isFinite(parsedDays)
    ? Math.min(Math.max(parsedDays, 1), 3650)
    : 365

  if (!profileId || !UUID.test(profileId)) {
    return NextResponse.json({ error: 'a valid profileId is required' }, { status: 400 })
  }

  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  const query = (columns: string) =>
    supabase
      .from('portfolio_snapshots')
      .select(columns)
      .eq('profile_id', profileId)
      .gte('snapshot_date', sinceStr)
      .order('snapshot_date', { ascending: true })

  let { data, error } = await query(`${CORE_COLUMNS}, ${EXPOSURE_COLUMNS}`)

  // PostgREST rejects the whole request if any listed column is absent, so on a
  // database predating migration 005 the entire P&L chart came back empty. Fall
  // back to the columns every install has and say the extras are missing, so
  // the FX-attribution page can tell the user which migration to run.
  let exposureAvailable = true
  if (isMissingColumn(error)) {
    exposureAvailable = false
    ;({ data, error } = await query(CORE_COLUMNS))
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ snapshots: data ?? [], exposureAvailable })
}

// POST /api/snapshots
// Body: { profileId, snapshotDate?, total_value_czk, stocks_czk, cash_czk,
//         crypto_czk, realestate_czk, fx_usd, fx_eur }
export async function POST(req: NextRequest) {
  if (configError) return NextResponse.json({ error: configError }, { status: 500 })
  const body = await req.json()
  const {
    profileId, snapshotDate,
    total_value_czk, stocks_czk, cash_czk, crypto_czk, realestate_czk,
    fx_usd, fx_eur, fx_gbp,
    exposure_usd_local, exposure_eur_local, exposure_czk_local, exposure_other_czk,
  } = body

  if (!profileId || !UUID.test(String(profileId)) || total_value_czk == null) {
    return NextResponse.json(
      { error: 'a valid profileId and total_value_czk are required' },
      { status: 400 }
    )
  }

  const num = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  if (!Number.isFinite(Number(total_value_czk))) {
    return NextResponse.json({ error: 'total_value_czk must be a number' }, { status: 400 })
  }

  // The client sends its own calendar date: the snapshot belongs to the user's
  // day, not the server's UTC day (they differ for several hours every night).
  const date = typeof snapshotDate === 'string' && ISO_DATE.test(snapshotDate)
    ? snapshotDate
    : new Date().toISOString().slice(0, 10)

  const { error } = await supabase
    .from('portfolio_snapshots')
    .upsert({
      profile_id: profileId,
      snapshot_date: date,
      total_value_czk: num(total_value_czk),
      stocks_czk:     num(stocks_czk),
      cash_czk:       num(cash_czk),
      crypto_czk:     num(crypto_czk),
      realestate_czk: num(realestate_czk),
      // Recorded for auditing what rates a historical value was struck at.
      // Null beats inventing a rate the snapshot was not actually computed with.
      fx_usd: Number.isFinite(Number(fx_usd)) ? Number(fx_usd) : null,
      fx_eur: Number.isFinite(Number(fx_eur)) ? Number(fx_eur) : null,
      fx_gbp: Number.isFinite(Number(fx_gbp)) ? Number(fx_gbp) : null,
      // Exposure per currency, in that currency's own units — this is what
      // makes asset-vs-FX attribution possible after the fact.
      exposure_usd_local: num(exposure_usd_local),
      exposure_eur_local: num(exposure_eur_local),
      exposure_czk_local: num(exposure_czk_local),
      exposure_other_czk: num(exposure_other_czk),
    }, { onConflict: 'profile_id,snapshot_date' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, date })
}
