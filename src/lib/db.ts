/**
 * db.ts — profile-scoped writes.
 *
 * Every update and delete must carry the profile it belongs to. Filtering on
 * `id` alone let a modal left open across a profile switch write into the other
 * profile's row; with RLS off, nothing in the database would have stopped it.
 * These helpers make the scoping impossible to forget and turn "0 rows
 * affected" (wrong profile, or the row was already gone) into an error instead
 * of a silent success.
 */
import { supabase } from './supabase'

export type DbResult = { error: string | null }

const NOT_FOUND = 'That record no longer exists for this profile — reload and try again.'

export async function updateScoped(
  table: string,
  id: string,
  profileId: string | null | undefined,
  patch: Record<string, unknown>
): Promise<DbResult> {
  if (!profileId) return { error: 'No active profile selected.' }
  const { error, count } = await supabase
    .from(table)
    .update(patch, { count: 'exact' })
    .eq('id', id)
    .eq('profile_id', profileId)
  if (error) return { error: error.message }
  if (count === 0) return { error: NOT_FOUND }
  return { error: null }
}

export async function deleteScoped(
  table: string,
  id: string,
  profileId: string | null | undefined
): Promise<DbResult> {
  if (!profileId) return { error: 'No active profile selected.' }
  const { error, count } = await supabase
    .from(table)
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('profile_id', profileId)
  if (error) return { error: error.message }
  if (count === 0) return { error: NOT_FOUND }
  return { error: null }
}

export async function insertScoped(
  table: string,
  profileId: string | null | undefined,
  rows: Record<string, unknown>[]
): Promise<DbResult> {
  if (!profileId) return { error: 'No active profile selected.' }
  if (rows.length === 0) return { error: null }
  const { error } = await supabase
    .from(table)
    .insert(rows.map(r => ({ ...r, profile_id: profileId })))
  return { error: error?.message ?? null }
}

/** PostgREST's code for "no such function", i.e. a migration that has not been run. */
export function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  const msg = (error.message ?? '').toLowerCase()
  return msg.includes('could not find the function') || /function .* does not exist/.test(msg)
}

export type RecordKind =
  | 'buy' | 'sell' | 'dividend' | 'coupon' | 'interest' | 'deposit' | 'withdrawal' | 'fee' | 'split'

/** Payload for the record_event() database function (migration 012). */
export interface RecordEvent {
  kind: RecordKind
  asset_class: 'stock' | 'crypto' | 'bond' | 'cash'
  date: string
  currency: string
  fx_rate_czk: number
  fee?: number
  tax?: number
  notes?: string | null
  cash_account_id?: string | null
  symbol?: string
  name?: string
  exchange?: string | null
  is_dividend_payer?: boolean
  coin_id?: string
  bond_id?: string
  account_id?: string
  quantity?: number
  price?: number
  price_pct?: number
  accrued?: number
  gross?: number
  amount?: number
  ex_date?: string | null
  amount_per_share?: number
  shares_held?: number
  drip_shares?: number
  drip_price?: number
  drip_fx_rate_czk?: number | null
}

/**
 * Record a money movement atomically: the ledger row and its effect on the
 * position / dividend log / bank balance land together or not at all.
 */
export async function recordEvent(profileId: string | null | undefined, event: RecordEvent): Promise<DbResult> {
  if (!profileId) return { error: 'No active profile selected.' }
  const { error } = await supabase.rpc('record_event', { p_profile_id: profileId, p_event: event })
  if (!error) return { error: null }
  if (isMissingFunction(error)) {
    return { error: 'The database is missing record_event() — run supabase/migrations/010, 011 and 012 (see README).' }
  }
  return { error: error.message }
}
