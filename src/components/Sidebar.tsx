'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { section: 'Overview', items: [
    { href: '/',           label: 'Dashboard',       icon: '◈' },
    { href: '/holdings',   label: 'Holdings',        icon: '◻' },
  ]},
  { section: 'Income', items: [
    { href: '/received',   label: 'Received',        icon: '↓' },
    { href: '/projected',  label: 'Projected',       icon: '→' },
    { href: '/calendar',   label: 'Ex-div calendar', icon: '▦' },
  ]},
  { section: 'Analysis', items: [
    { href: '/currency',   label: 'Currency mix',    icon: '◎' },
    { href: '/tax',        label: 'Tax summary',     icon: '◷' },
  ]},
]

export default function Sidebar() {
  const path = usePathname()
  return (
    <aside style={{
      width: 'var(--sidebar-w)',
      flexShrink: 0,
      background: 'var(--bg2)',
      borderRight: '1px solid var(--border)',
      padding: '24px 0',
      display: 'flex',
      flexDirection: 'column',
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
      zIndex: 10,
    }}>
      {/* Logo */}
      <div style={{ padding: '0 20px 20px', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
        <div style={{
          fontFamily: "'Instrument Serif', serif",
          fontSize: 22,
          fontWeight: 400,
          color: 'var(--green)',
          letterSpacing: -0.3,
          fontStyle: 'italic',
        }}>
          Divvy
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 1 }}>
          Portfolio tracker
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0 10px', overflowY: 'auto' }}>
        {nav.map(group => (
          <div key={group.section}>
            <div style={{
              fontSize: 9,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text4)',
              padding: '12px 10px 4px',
              fontFamily: "'Geist', sans-serif",
              fontWeight: 500,
            }}>
              {group.section}
            </div>
            {group.items.map(item => {
              const active = path === item.href
              return (
                <Link key={item.href} href={item.href} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '7px 10px',
                  borderRadius: 6,
                  textDecoration: 'none',
                  fontSize: 12,
                  fontFamily: "'Geist', sans-serif",
                  background: active ? 'var(--green-bg)' : 'transparent',
                  color: active ? 'var(--green)' : 'var(--text2)',
                  border: active ? '1px solid var(--green-bd)' : '1px solid transparent',
                  marginBottom: 1,
                  transition: 'all 0.12s',
                }}>
                  <span style={{ width: 14, textAlign: 'center', fontSize: 11 }}>{item.icon}</span>
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--green-bg)',
            border: '1px solid var(--green-bd)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: 'var(--green)', fontWeight: 600,
          }}>ED</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text)' }}>Eliot Deschamps</div>
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>IBKR · CZK base</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
