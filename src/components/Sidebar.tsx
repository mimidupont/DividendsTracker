'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { section: 'Overview', items: [
    { href: '/',           label: 'Dashboard',     icon: '◈' },
    { href: '/holdings',   label: 'Holdings',      icon: '◻' },
  ]},
  { section: 'Income', items: [
    { href: '/received',   label: 'Received',      icon: '↓' },
    { href: '/projected',  label: 'Projected',     icon: '→' },
  ]},
  { section: 'Analysis', items: [
    { href: '/currency',   label: 'Currency mix',  icon: '◎' },
    { href: '/tax',        label: 'Tax summary',   icon: '◷' },
  ]},
]

export default function Sidebar() {
  const path = usePathname()
  return (
    <aside style={{
      width: 220, flexShrink: 0, background: 'var(--bg2)',
      borderRight: '1px solid var(--border)', padding: '28px 0',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 10,
    }}>
      {/* Logo */}
      <div style={{ padding: '0 24px 24px', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, color: 'var(--green)', letterSpacing: -0.5 }}>
          Divvy
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Portfolio tracker
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0 12px', overflowY: 'auto' }}>
        {nav.map(group => (
          <div key={group.section}>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', padding: '14px 12px 5px', fontFamily: 'DM Mono, monospace' }}>
              {group.section}
            </div>
            {group.items.map(item => {
              const active = path === item.href
              return (
                <Link key={item.href} href={item.href} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', borderRadius: 6, textDecoration: 'none',
                  fontSize: 12, fontFamily: 'DM Mono, monospace',
                  background: active ? 'var(--green-bg)' : 'transparent',
                  color: active ? 'var(--green)' : 'var(--text2)',
                  border: active ? '1px solid var(--green-bd)' : '1px solid transparent',
                  marginBottom: 2, transition: 'all 0.15s',
                }}>
                  <span style={{ width: 14, textAlign: 'center' }}>{item.icon}</span>
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: 'var(--green)', fontWeight: 500,
          }}>ED</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text2)' }}>Eliot Deschamps</div>
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>IBKR · CZK base</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
