'use client'
import { useState } from 'react'
import { useProfile } from '@/lib/profile'

export default function ProfileSwitcher() {
  const { profiles, activeProfile, setActiveProfile } = useProfile()
  const [open, setOpen] = useState(false)

  if (!activeProfile) return null

  return (
    <div style={{ position: 'relative' }}>
      {/* Active profile button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--green-bg), var(--blue-bg))',
          border: '1px solid var(--border2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, color: 'var(--green)', fontWeight: 600,
          fontFamily: "'Syne', sans-serif",
          flexShrink: 0,
        }}>
          {activeProfile.initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activeProfile.display_name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text4)' }}>
            IBKR · {activeProfile.base_currency} base
          </div>
        </div>
        <span style={{ fontSize: 9, color: 'var(--text4)', flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          right: 0,
          marginBottom: 6,
          background: 'var(--bg2)',
          border: '1px solid var(--border2)',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          overflow: 'hidden',
          zIndex: 100,
        }}>
          <div style={{
            fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--text4)', padding: '8px 12px 4px', fontWeight: 600,
          }}>
            Switch profile
          </div>
          {profiles.map(p => {
            const isActive = p.id === activeProfile.id
            return (
              <button
                key={p.id}
                onClick={() => { setActiveProfile(p); setOpen(false) }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: isActive ? 'var(--green-bg)' : 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: isActive
                    ? 'linear-gradient(135deg, var(--green-bg), var(--blue-bg))'
                    : 'var(--bg3)',
                  border: `1px solid ${isActive ? 'var(--green-bd)' : 'var(--border2)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 8, color: isActive ? 'var(--green)' : 'var(--text3)',
                  fontWeight: 600, fontFamily: "'Syne', sans-serif", flexShrink: 0,
                }}>
                  {p.initials}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: isActive ? 'var(--green)' : 'var(--text)', fontWeight: isActive ? 600 : 400 }}>
                    {p.display_name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text4)' }}>{p.base_currency} base</div>
                </div>
                {isActive && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--green)' }}>✓</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
