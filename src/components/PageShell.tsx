'use client'
import Sidebar from './Sidebar'

/** Standard page frame: sidebar + main column, matching every existing page. */
export function PageShell({
  children,
  maxWidth = 1200,
}: {
  children: React.ReactNode
  maxWidth?: number
}) {
  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth }}>
        {children}
      </main>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
      <div>
        <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, lineHeight: 1.6 }}>{subtitle}</div>
        )}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
    </div>
  )
}

export function LoadingShell({ label = 'Loading…' }: { label?: string }) {
  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>
        {label}
      </main>
    </div>
  )
}

/**
 * Empty state. Half of the v2 features start with zero rows, so every page
 * needs to explain what to add rather than rendering a blank panel.
 */
export function EmptyState({
  icon = '◎',
  title,
  body,
  action,
}: {
  icon?: string
  title: string
  body: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '40px 32px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, opacity: 0.35, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.7, maxWidth: 520, margin: '0 auto' }}>
        {body}
      </div>
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  )
}

export interface MetricCard {
  label: string
  value: string
  note?: React.ReactNode
  accent?: string
  color?: string
}

export function MetricCards({ cards, columns }: { cards: MetricCard[]; columns?: number }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${columns ?? cards.length}, 1fr)`,
      gap: 12, marginBottom: 18,
    }}>
      {cards.map((m, i) => (
        <div key={i} style={{
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '14px 18px', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: m.accent ?? 'var(--border2)', opacity: 0.8,
          }} />
          <div style={{
            fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase',
            color: 'var(--text3)', marginBottom: 6, fontWeight: 500,
          }}>{m.label}</div>
          <div style={{
            fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400,
            marginBottom: 4, color: m.color ?? 'var(--text)',
          }}>{m.value}</div>
          {m.note && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{m.note}</div>}
        </div>
      ))}
    </div>
  )
}

export function Panel({
  title,
  right,
  children,
  padded = true,
}: {
  title?: string
  right?: React.ReactNode
  children: React.ReactNode
  padded?: boolean
}) {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden', marginBottom: 14,
    }}>
      {title && (
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg3)', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{
            fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--text2)', fontWeight: 500,
          }}>{title}</span>
          {right}
        </div>
      )}
      <div style={padded ? { padding: '16px 20px' } : undefined}>{children}</div>
    </div>
  )
}

/** Em dash for values that genuinely cannot be computed yet. */
export const DASH = '—'

/** Render a number, or an em dash when it is null/NaN — never "NaN" or a fake 0. */
export function orDash(
  value: number | null | undefined,
  format: (n: number) => string
): string {
  return value == null || !isFinite(value) ? DASH : format(value)
}
