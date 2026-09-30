import type React from 'react'

// ─── Table cells ──────────────────────────────────────────────────────────────

export const tdR: React.CSSProperties = {
  padding: '9px 14px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'right',
  color: 'var(--text2)',
  fontSize: 12,
}

export const tdRMono: React.CSSProperties = {
  ...tdR,
  fontFamily: "'DM Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
}

export const tdL: React.CSSProperties = {
  padding: '9px 14px',
  borderBottom: '1px solid var(--border)',
}

// ─── Table header row ─────────────────────────────────────────────────────────

export const tableHeader: React.CSSProperties = {
  padding: '12px 18px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg3)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

export const tableHeaderLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 600,
}

export const th: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  padding: '8px 14px',
  borderBottom: '1px solid var(--border)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

// ─── Cards ────────────────────────────────────────────────────────────────────

export const cardStyle: React.CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '18px 20px',
}

export const cardLabelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  marginBottom: 8,
  fontWeight: 500,
}

// ─── Form inputs ──────────────────────────────────────────────────────────────

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border2)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: "'Inter', sans-serif",
  fontSize: 13,
  boxSizing: 'border-box',
}

export const inputLabel: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  display: 'block',
  marginBottom: 5,
  fontWeight: 500,
}

// ─── Buttons ──────────────────────────────────────────────────────────────────

export function btnStyle(variant: 'primary' | 'secondary'): React.CSSProperties {
  if (variant === 'primary') return {
    padding: '7px 15px', borderRadius: 6, cursor: 'pointer',
    background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
    color: 'var(--green)', fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 500,
  }
  return {
    padding: '7px 15px', borderRadius: 6, cursor: 'pointer',
    background: 'var(--bg2)', border: '1px solid var(--border2)',
    color: 'var(--text2)', fontFamily: "'Inter', sans-serif", fontSize: 12,
  }
}

export const btnSecondary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg3)', border: '1px solid var(--border2)',
  color: 'var(--text2)', fontFamily: "'Inter', sans-serif", fontSize: 12,
}

export function btnPrimary(color: string, bd: string, bg: string): React.CSSProperties {
  return {
    padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
    background: bg, border: `1px solid ${bd}`,
    color, fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 500,
  }
}

// ─── Action icon button (edit/delete in table rows) ───────────────────────────

export const actionBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border2)',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--text3)',
  fontSize: 12,
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
}

// ─── Signed values ────────────────────────────────────────────────────────────

/** Colour for a signed value; neutral when zero or unknown. Always pair with a sign. */
export const signColor = (n: number | null | undefined): string =>
  n == null || !isFinite(n) || n === 0 ? 'var(--text3)' : n > 0 ? 'var(--green)' : 'var(--red)'

/** Heading style shared by every page title. */
export const pageTitle: React.CSSProperties = {
  fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5,
}
