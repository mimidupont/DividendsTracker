'use client'
import React from 'react'

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border2)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: "'Geist', sans-serif",
  fontSize: 13,
  outline: 'none',
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

export function Field({
  label,
  children,
  span,
  hint,
}: {
  label: string
  children: React.ReactNode
  span?: '2'
  hint?: string
}) {
  return (
    <div style={{ gridColumn: span === '2' ? '1/-1' : undefined }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {children}
    </div>
  )
}

export function FormActions({
  onCancel,
  onSubmit,
  label,
  saving,
}: {
  onCancel: () => void
  onSubmit: () => void
  label: string
  saving?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
      <button onClick={onCancel} style={{
        padding: '8px 16px', borderRadius: 6,
        border: '1px solid var(--border2)',
        background: 'var(--bg)',
        color: 'var(--text2)',
        fontFamily: "'Geist', sans-serif",
        fontSize: 12, cursor: 'pointer',
      }}>
        Cancel
      </button>
      <button onClick={onSubmit} disabled={saving} style={{
        padding: '8px 18px', borderRadius: 6,
        border: '1px solid var(--green-bd)',
        background: 'var(--green-bg)',
        color: 'var(--green)',
        fontFamily: "'Geist', sans-serif",
        fontWeight: 500,
        fontSize: 12, cursor: 'pointer',
        opacity: saving ? 0.6 : 1,
      }}>
        {saving ? 'Saving…' : label}
      </button>
    </div>
  )
}

export function ErrorBox({ msg }: { msg: string }) {
  if (!msg) return null
  return (
    <div style={{
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
