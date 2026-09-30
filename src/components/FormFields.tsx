'use client'
import React, { useId } from 'react'
import { parseDecimal } from '@/lib/parse'

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
  transition: 'border-color 0.15s',
}

export const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  display: 'block',
  marginBottom: 5,
  fontWeight: 500,
}

/**
 * A labelled form field. The control is wrapped in the <label>, which
 * associates them for screen readers and makes the label clickable — the old
 * sibling <label> announced every input as just "edit text".
 */
export function Field({
  label,
  children,
  span,
  hint,
}: {
  label: string
  children: React.ReactNode
  span?: '2'
  hint?: React.ReactNode
}) {
  const hintId = useId()
  const style = { gridColumn: span === '2' ? '1/-1' : undefined, display: 'block' } as const
  const body = (
    <>
      {label && <span style={labelStyle}>{label}</span>}
      {hint
        ? React.Children.map(children, c =>
            React.isValidElement(c) ? React.cloneElement(c as React.ReactElement<Record<string, unknown>>, { 'aria-describedby': hintId }) : c)
        : children}
      {hint && <span id={hintId} style={{ display: 'block', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>{hint}</span>}
    </>
  )
  // A field without a label (e.g. a checkbox row that brings its own) must not
  // nest one label inside another.
  return label ? <label style={style}>{body}</label> : <div style={style}>{body}</div>
}

/**
 * Number entry that accepts Czech formatting ("1 234,56"). Keeps the raw text
 * so typing is never fought; parse with parseDecimal() on submit.
 */
export function NumberInput({
  value, onChange, placeholder, suffix, style, invalid, ...rest
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  suffix?: string
  style?: React.CSSProperties
  invalid?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'style'>) {
  const bad = invalid ?? (value.trim() !== '' && parseDecimal(value) == null)
  const input = (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      aria-invalid={bad || undefined}
      onChange={e => onChange(e.target.value)}
      style={{
        ...inputStyle,
        fontFamily: "'DM Mono', monospace",
        ...(suffix ? { paddingRight: 52 } : {}),
        ...(bad ? { borderColor: 'var(--red)' } : {}),
        ...style,
      }}
    />
  )
  if (!suffix) return input
  return (
    <span style={{ position: 'relative', display: 'block' }}>
      {input}
      <span aria-hidden="true" style={{
        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
        fontSize: 11, color: 'var(--text3)', pointerEvents: 'none',
        fontFamily: "'DM Mono', monospace",
      }}>{suffix}</span>
    </span>
  )
}

export function FormGrid({ children, columns = 2 }: { children: React.ReactNode; columns?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 14 }}>
      {children}
    </div>
  )
}

export function FormActions({
  onCancel,
  onSubmit,
  label,
  saving,
  disabled,
}: {
  onCancel: () => void
  onSubmit: () => void
  label: string
  saving?: boolean
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
      <button type="button" onClick={onCancel} style={{
        padding: '8px 16px', borderRadius: 6,
        border: '1px solid var(--border2)',
        background: 'var(--bg)',
        color: 'var(--text2)',
        fontFamily: "'Inter', sans-serif",
        fontSize: 12, cursor: 'pointer',
      }}>
        Cancel
      </button>
      <button type="button" onClick={onSubmit} disabled={saving || disabled} style={{
        padding: '8px 18px', borderRadius: 6,
        border: '1px solid var(--green-bd)',
        background: 'var(--green-bg)',
        color: 'var(--green)',
        fontFamily: "'Inter', sans-serif",
        fontWeight: 500,
        fontSize: 12, cursor: saving || disabled ? 'not-allowed' : 'pointer',
        opacity: saving || disabled ? 0.6 : 1,
      }}>
        {saving ? 'Saving…' : label}
      </button>
    </div>
  )
}

export function ErrorBox({ msg }: { msg: string | null | undefined }) {
  if (!msg) return null
  return (
    <div role="alert" style={{
      background: 'var(--red-bg)',
      color: 'var(--red)',
      border: '1px solid var(--red-bd)',
      borderRadius: 6,
      padding: '8px 12px',
      marginBottom: 16,
      fontSize: 12,
    }}>
      {msg}
    </div>
  )
}

export function Notice({ children, tone = 'amber' }: { children: React.ReactNode; tone?: 'amber' | 'blue' | 'gray' }) {
  const c = tone === 'amber'
    ? { bg: 'var(--amber-bg)', bd: 'var(--amber-bd)', fg: 'var(--amber)' }
    : tone === 'blue'
      ? { bg: 'var(--blue-bg)', bd: 'var(--blue-bd)', fg: 'var(--blue)' }
      : { bg: 'var(--bg3)', bd: 'var(--border2)', fg: 'var(--text2)' }
  return (
    <div role="status" style={{
      background: c.bg, border: `1px solid ${c.bd}`, color: c.fg,
      borderRadius: 8, padding: '9px 12px', fontSize: 11, lineHeight: 1.6, marginBottom: 14,
    }}>{children}</div>
  )
}

/** Checkbox with its own label. */
export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: 'var(--green)', cursor: 'pointer' }}
      />
      <span style={{ fontSize: 12, color: 'var(--text2)' }}>{label}</span>
    </label>
  )
}
