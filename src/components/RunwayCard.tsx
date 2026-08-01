'use client'
import type { Position } from '@/lib/portfolio'
import type { BankAccount } from '@/lib/supabase'
import {
  runwaySummary, lockedCashWarning, RUNWAY_COLORS, RUNWAY_LABELS,
  RUNWAY_TARGET_MONTHS, EMERGENCY_HAIRCUTS,
} from '@/lib/runway'
import { fmtCZK } from '@/lib/fx'
import { fmtISODate } from '@/lib/date'
import { DASH } from './PageShell'

const TIER_COLORS: Record<string, string> = {
  instant: 'var(--green)', week: 'var(--blue)', month: 'var(--amber)',
}

/**
 * Emergency runway. Shown on /fire, /cash and the dashboard, so it lives in one
 * component rather than being reimplemented three times.
 */
export default function RunwayCard({
  positions,
  monthlyExpenses,
  accounts = [],
  compact = false,
}: {
  positions: Position[]
  monthlyExpenses: number | null
  accounts?: BankAccount[]
  compact?: boolean
}) {
  const summary = runwaySummary(positions, monthlyExpenses)
  const locked = lockedCashWarning(accounts)
  const color = summary.status ? RUNWAY_COLORS[summary.status] : 'var(--text3)'

  const segments = summary.ladder.filter(r => ['instant', 'week', 'month'].includes(r.tier))
  const segmentTotal = segments.reduce((s, r) => s + r.availableCZK, 0)

  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 10, padding: compact ? '14px 18px' : '16px 20px',
    }}>
      <div style={{
        fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--text2)', fontWeight: 500, marginBottom: 12,
      }}>
        Emergency runway
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: compact ? 24 : 30, color }}>
          {summary.emergencyMonths != null ? `${summary.emergencyMonths.toFixed(1)} months` : DASH}
        </span>
        {summary.status && (
          <span style={{ fontSize: 11, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {RUNWAY_LABELS[summary.status]}
          </span>
        )}
      </div>

      {summary.emergencyMonths == null ? (
        <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.7 }}>
          Set your annual expenses on the FIRE page and this becomes a number of months rather
          than a pile of cash.
        </div>
      ) : (
        <>
          {/* Segmented bar: instant | week | month */}
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 8, background: 'var(--bg4)' }}>
            {segments.map(r => r.availableCZK > 0 && (
              <div key={r.tier} title={`${r.tier}: ${fmtCZK(r.availableCZK)} · ${r.months.toFixed(1)} mo`}
                style={{ flex: r.availableCZK, background: TIER_COLORS[r.tier], opacity: 0.85 }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
            {segments.map(r => (
              <div key={r.tier} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: TIER_COLORS[r.tier] }} />
                <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'capitalize' }}>{r.tier}</span>
                <span style={{ fontSize: 10, color: 'var(--text4)', fontFamily: "'DM Mono', monospace" }}>
                  {r.months.toFixed(1)}mo
                </span>
              </div>
            ))}
          </div>

          {/* Target line */}
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.7 }}>
            Target {RUNWAY_TARGET_MONTHS} months.{' '}
            {summary.gapCZK > 0
              ? <span style={{ color: 'var(--amber)' }}>{fmtCZK(summary.gapCZK)} short.</span>
              : <span style={{ color: 'var(--green)' }}>Covered.</span>}
          </div>

          {!compact && (
            <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text4)', lineHeight: 1.6 }}>
              Crypto counted at {(EMERGENCY_HAIRCUTS.crypto * 100).toFixed(0)}% of market value;
              property excluded entirely. Stocks count in full but may have to be sold at a loss —
              reaching them is not free.
            </div>
          )}

          {locked.length > 0 && (
            <div style={{
              marginTop: 10, padding: '8px 12px', background: 'var(--amber-bg)',
              border: '1px solid var(--amber-bd)', borderRadius: 6,
              fontSize: 10, color: 'var(--amber)', lineHeight: 1.6,
            }}>
              ⚠ {locked.map(l => `${l.name} matures ${fmtISODate(l.maturityDate)}`).join('; ')} —
              that money is not instantly available.
            </div>
          )}
        </>
      )}
    </div>
  )
}
