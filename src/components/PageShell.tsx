'use client'
import { useState } from 'react'
import Sidebar from './Sidebar'

/**
 * Standard page frame: sidebar + main column. Every page uses this, so width,
 * padding and the responsive behaviour (icon rail below 1024 px, drawer below
 * 640 px — see globals.css) are the same everywhere.
 */
export function PageShell({
  children,
  maxWidth = 1200,
}: {
  children: React.ReactNode
  maxWidth?: number
}) {
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div style={{ display: 'flex' }}>
      <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
      <div
        className={`sidebar-backdrop${navOpen ? ' open' : ''}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mobile-bar">
          <button
            type="button"
            onClick={() => setNavOpen(o => !o)}
            aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={navOpen}
            style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 6, padding: '4px 10px', fontSize: 16, cursor: 'pointer' }}
          >☰</button>
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, letterSpacing: '-0.02em' }}>DIVVY</span>
          <span style={{ width: 38 }} />
        </div>
        <main className="app-main" style={{ maxWidth: maxWidth + 72 }}>
          {children}
        </main>
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  accent,
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  /** Small uppercase line above the title (asset class, date…). */
  eyebrow?: React.ReactNode
  /** Asset-class colour for the eyebrow. */
  accent?: string
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && (
          <div style={{
            fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: accent ?? 'var(--text3)', fontWeight: 600, marginBottom: 4,
          }}>{eyebrow}</div>
        )}
        <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5, lineHeight: 1.15 }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, lineHeight: 1.6 }}>{subtitle}</div>
        )}
      </div>
      {actions && <div className="page-actions" style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
    </div>
  )
}

export function LoadingShell({ label = 'Loading…' }: { label?: string }) {
  return (
    <PageShell>
      <div role="status" aria-live="polite" style={{ color: 'var(--text3)', padding: '12px 0' }}>{label}</div>
    </PageShell>
  )
}

/**
 * Empty state. Many features start with zero rows, so every page explains
 * what to add rather than rendering a blank panel or a row of zeros.
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
      padding: '40px 32px', textAlign: 'center', marginBottom: 14,
    }}>
      <div aria-hidden="true" style={{ fontSize: 22, opacity: 0.35, marginBottom: 10 }}>{icon}</div>
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

/** Metric tiles. Columns wrap on narrow screens instead of squashing the numbers. */
export function MetricCards({ cards, columns, minWidth = 170 }: { cards: MetricCard[]; columns?: number; minWidth?: number }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: columns
        ? `repeat(auto-fit, minmax(max(${minWidth}px, calc((100% - ${(columns - 1) * 12}px) / ${columns})), 1fr))`
        : `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
      gap: 12, marginBottom: 18,
    }}>
      {cards.map((m, i) => (
        <div key={i} style={{
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '14px 18px', position: 'relative', overflow: 'hidden',
        }}>
          <div aria-hidden="true" style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: m.accent ?? 'var(--border2)', opacity: 0.8,
          }} />
          <div style={{
            fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase',
            color: 'var(--text3)', marginBottom: 6, fontWeight: 500,
          }}>{m.label}</div>
          <div style={{
            fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400,
            marginBottom: 4, color: m.color ?? 'var(--text)', fontVariantNumeric: 'tabular-nums',
          }}>{m.value}</div>
          {m.note && <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>{m.note}</div>}
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
  id,
}: {
  title?: string
  right?: React.ReactNode
  children: React.ReactNode
  padded?: boolean
  id?: string
}) {
  return (
    <section id={id} style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden', marginBottom: 14,
    }}>
      {title && (
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg3)', display: 'flex', gap: 12, flexWrap: 'wrap',
          justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h2 style={{
            fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--text2)', fontWeight: 500,
          }}>{title}</h2>
          {right}
        </div>
      )}
      <div style={padded ? { padding: '16px 20px' } : undefined}>{children}</div>
    </section>
  )
}

/** Segmented tab control used for in-page tabs. */
export function Tabs<T extends string>({
  tabs, value, onChange, label,
}: {
  tabs: { key: T; label: string }[]
  value: T
  onChange: (k: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} style={{
      display: 'inline-flex', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden', marginBottom: 16,
    }}>
      {tabs.map((t, i) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12,
            background: value === t.key ? 'var(--bg4)' : 'var(--bg2)',
            color: value === t.key ? 'var(--text)' : 'var(--text3)',
            fontWeight: value === t.key ? 500 : 400,
            borderRight: i < tabs.length - 1 ? '1px solid var(--border2)' : 'none',
          }}
        >{t.label}</button>
      ))}
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
