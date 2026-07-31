/**
 * date.ts — calendar-date helpers.
 *
 * Dividend dates, snapshot dates and purchase dates are calendar dates, not
 * instants. Mixing `new Date(iso)` (parsed as UTC midnight) with `getDate()` /
 * `toISOString()` (local vs UTC) shifts them by a day for anyone east of
 * Greenwich — which is every user of this app. Everything below stays in the
 * "YYYY-MM-DD" string domain, or converts explicitly.
 */

/** "YYYY-MM-DD" for a Date, using its local calendar day. */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Today's local calendar date as "YYYY-MM-DD". */
export const todayISO = (): string => toISODate(new Date())

/** Parse "YYYY-MM-DD" into a Date at local midnight (no timezone shift). */
export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return isNaN(d.getTime()) ? null : d
}

/** Unix seconds → "YYYY-MM-DD", read in UTC (providers stamp dates at UTC midnight). */
export function unixToISODate(ts: number | null | undefined): string | null {
  if (ts == null || !isFinite(ts)) return null
  const d = new Date(ts * 1000)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** Shift a "YYYY-MM-DD" by whole days, staying on calendar days. */
export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  if (!d) return iso
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"); positive = in the future. */
export function daysBetween(from: string, to: string): number {
  const a = parseISODate(from)
  const b = parseISODate(to)
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** The calendar year of a "YYYY-MM-DD" string (no Date parsing involved). */
export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4))
}

/** Format "YYYY-MM-DD" for display without any timezone shifting. */
export function fmtISODate(iso: string): string {
  const d = parseISODate(iso)
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : iso
}

/** Short display form ("3 Jun") for "YYYY-MM-DD". */
export function fmtISODateShort(iso: string): string {
  const d = parseISODate(iso)
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : iso
}
