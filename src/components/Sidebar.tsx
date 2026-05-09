'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { section: 'Overview', items: [
    { href: '/',              label: 'Net worth',     icon: '◈', color: 'var(--text2)' },
    { href: '/performance',  label: 'Performance',   icon: '◉', color: 'var(--text2)' },
    { href: '/allocation',   label: 'Allocation',    icon: '◎', color: 'var(--text2)' },
  ]},
  { section: 'Stocks & ETFs', accent: 'var(--green)', items: [
    { href: '/holdings',     label: 'Holdings',      icon: '◻', color: 'var(--green)' },
    { href: '/dividends',    label: 'Dividends',     icon: '↓', color: 'var(--green)' },
    { href: '/projected',    label: 'Projected',     icon: '→', color: 'var(--green)' },
    { href: '/calendar',     label: 'Ex-div cal.',   icon: '▦', color: 'var(--green)' },
  ]},
  { section: 'Cash & Savings', accent: 'var(--blue)', items: [
    { href: '/cash',         label: 'Bank accounts', icon: '⊟', color: 'var(--blue)'  },
  ]},
  { section: 'Crypto', accent: 'var(--purple)', items: [
    { href: '/crypto',       label: 'Holdings',      icon: '⬡', color: 'var(--purple)' },
  ]},
  { section: 'Real Estate', accent: 'var(--teal)', items: [
    { href: '/realestate',   label: 'Properties',    icon: '⊞', color: 'var(--teal)'  },
  ]},
  { section: 'Planning', items: [
    { href: '/tax',          label: 'Tax summary',   icon: '⊕', color: 'var(--text2)' },
    { href: '/simulation',   label: 'Wealth sim.',   icon: '∿', color: 'var(--text2)' },
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
      display: 'flex',
      flexDirection: 'column',
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
      zIndex: 10,
    }}>
      {/* Logo */}
      <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, var(--text) 0%, var(--text2) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          DIVVY
        </div>
        <div style={{ fontSize: 10, color: 'var(--text4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>
          Wealth tracker
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 10px', overflowY: 'auto' }}>
        {nav.map(group => (
          <div key={group.section} style={{ marginBottom: 4 }}>
            <div style={{
              fontSize: 9,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: group.accent ?? 'var(--text4)',
              padding: '10px 10px 4px',
              fontWeight: 600,
              opacity: group.accent ? 0.9 : 1,
            }}>
              {group.section}
            </div>
            {group.items.map(item => {
              const active = path === item.href
              return (
                <Link key={item.href} href={item.href} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 6,
                  textDecoration: 'none',
                  fontSize: 12,
                  fontFamily: "'Inter', sans-serif",
                  background: active ? 'var(--bg4)' : 'transparent',
                  color: active ? item.color : 'var(--text3)',
                  border: active ? '1px solid var(--border2)' : '1px solid transparent',
                  marginBottom: 1,
                  transition: 'all 0.1s',
                }}>
                  <span style={{
                    width: 16, textAlign: 'center', fontSize: 10,
                    color: active ? item.color : 'var(--text4)',
                  }}>{item.icon}</span>
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--green-bg), var(--blue-bg))',
            border: '1px solid var(--border2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: 'var(--green)', fontWeight: 600,
            fontFamily: "'Syne', sans-serif",
          }}>ED</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500 }}>Eliot Deschamps</div>
            <div style={{ fontSize: 10, color: 'var(--text4)' }}>IBKR · CZK base</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
