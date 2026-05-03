'use client'
import { useEffect } from 'react'

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = 460,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  width?: number
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.22)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(1px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg2)',
        borderRadius: 12,
        border: '1px solid var(--border2)',
        width,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 64px)',
        overflowY: 'auto',
        padding: 28,
        boxShadow: '0 8px 40px rgba(0,0,0,0.10)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <div style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 20,
              fontWeight: 400,
              color: 'var(--text)',
            }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text3)', fontSize: 20, lineHeight: 1,
              padding: '0 2px',
            }}
          >×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
