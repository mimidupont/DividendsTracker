import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { todayInZone, addDays } from '@/lib/date'

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

/** Added by migrations 010 / 011. */
const V3_COLUMNS = 'exposure_gbp_local, unpriced_count, bonds_czk'

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

  // Calendar arithmetic in the user's timezone, like every other date here.
  const sinceStr = addDays(todayInZone(), -days)

  const query = (columns: string) =>
    supabase
      .from('portfolio_snapshots')
      .select(columns)
      .eq('profile_id', profileId)
      .gte('snapshot_date', sinceStr)
      .order('snapshot_date', { ascending: true })

  let { data, error } = await query(`${CORE_COLUMNS}, ${EXPOSURE_COLUMNS}, ${V3_COLUMNS}`)

  // PostgREST rejects the whole request if any listed column is absent, so on a
  // database predating a migration the entire P&L chart came back empty. Fall
  // back step by step and say which extras are missing, so the FX-attribution
  // page can tell the user which migration to run.
  let exposureAvailable = true
  if (isMissingColumn(error)) {
    ;({ data, error } = await query(`${CORE_COLUMNS}, ${EXPOSURE_COLUMNS}`))
  }
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
    total_value_czk, stocks_czk, bonds_czk, cash_czk, crypto_czk, realestate_czk,
    fx_usd, fx_eur, fx_gbp,
    exposure_usd_local, exposure_eur_local, exposure_czk_local, exposure_gbp_local, exposure_other_czk,
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
  // day, not the server's UTC day. Only today or yesterday (Prague) is
  // accepted — this route is unauthenticated, and accepting any date let a
  // caller rewrite history.
  const today = todayInZone()
  const yesterday = addDays(today, -1)
  let date = today
  if (snapshotDate != null) {
    if (typeof snapshotDate !== 'string' || !ISO_DATE.test(snapshotDate) ||
        (snapshotDate !== today && snapshotDate !== yesterday)) {
      return NextResponse.json(
        { error: 'snapshotDate must be today or yesterday (YYYY-MM-DD, Europe/Prague)' },
        { status: 400 })
    }
    date = snapshotDate
  }

  const optionalRate = (v: unknown) => Number.isFinite(Number(v)) && v != null ? Number(v) : null
  const row = {
    profile_id: profileId,
    snapshot_date: date,
    total_value_czk: num(total_value_czk),
    stocks_czk:     num(stocks_czk),
    cash_czk:       num(cash_czk),
    crypto_czk:     num(crypto_czk),
    realestate_czk: num(realestate_czk),
    // Recorded for auditing what rates a historical value was struck at.
    // Null beats inventing a rate the snapshot was not actually computed with.
    fx_usd: optionalRate(fx_usd),
    fx_eur: optionalRate(fx_eur),
    fx_gbp: optionalRate(fx_gbp),
    // Exposure per currency, in that currency's own units — this is what
    // makes asset-vs-FX attribution possible after the fact.
    exposure_usd_local: num(exposure_usd_local),
    exposure_eur_local: num(exposure_eur_local),
    exposure_czk_local: num(exposure_czk_local),
    exposure_other_czk: num(exposure_other_czk),
  }
  const v3 = {
    bonds_czk: num(bonds_czk),
    exposure_gbp_local: num(exposure_gbp_local),
    unpriced_count: 0,
  }

  let { error } = await supabase
    .from('portfolio_snapshots')
    .upsert({ ...row, ...v3 }, { onConflict: 'profile_id,snapshot_date' })

  // Before migrations 010/011: write the columns that exist, folding bonds into
  // stocks and GBP into "other" so the total still reconciles.
  if (isMissingColumn(error)) {
    ;({ error } = await supabase
      .from('portfolio_snapshots')
      .upsert({
        ...row,
        stocks_czk: row.stocks_czk + v3.bonds_czk,
        exposure_other_czk: row.exposure_other_czk + v3.exposure_gbp_local * (row.fx_gbp ?? 0),
      }, { onConflict: 'profile_id,snapshot_date' }))
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, date })
}
