'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ProfileSwitcher from './ProfileSwitcher'
import RecordModal from './RecordModal'

interface NavItem {
  href: string
  label: string
  icon: string
  color: string
  /** Other routes that belong to this entry (shown as tabs on its page). */
  also?: string[]
}

/**
 * Navigation. Every asset class is one click away; pages that were separate
 * sidebar entries for the same subject (performance/fees for stocks, FX
 * attribution for returns) are now tabs on that subject's page.
 */
export const NAV: { section: string; accent?: string; items: NavItem[] }[] = [
  { section: 'Overview', items: [
    { href: '/',             label: 'Net worth', icon: '◈', color: 'var(--text)' },
    { href: '/transactions', label: 'Activity',  icon: '⇄', color: 'var(--text)' },
  ]},
  { section: 'Assets', items: [
    { href: '/holdings',   label: 'Stocks & ETFs',   icon: '▤', color: 'var(--c-stocks)', also: ['/performance', '/fees'] },
    { href: '/bonds',      label: 'Bonds',           icon: '▥', color: 'var(--c-bond)' },
    { href: '/cash',       label: 'Cash & savings',  icon: '▭', color: 'var(--c-cash)' },
    { href: '/crypto',     label: 'Crypto',          icon: '⬡', color: 'var(--c-crypto)' },
    { href: '/realestate', label: 'Real estate',     icon: '⌂', color: 'var(--c-realestate)' },
  ]},
  { section: 'Income', items: [
    { href: '/projected', label: 'Forecast', icon: '↗', color: 'var(--c-income)' },
  ]},
  { section: 'Analysis', items: [
    { href: '/allocation', label: 'Allocation', icon: '◔', color: 'var(--text)', also: ['/currency'] },
    { href: '/benchmark',  label: 'Returns',    icon: '⚖', color: 'var(--text)', also: ['/fx-attribution'] },
  ]},
]

export default function Sidebar({ open = false, onNavigate }: { open?: boolean; onNavigate?: () => void }) {
  const path = usePathname()
  const [recording, setRecording] = useState(false)

  const isActive = (item: NavItem) =>
    path === item.href || (item.also ?? []).some(a => path === a || path.startsWith(`${a}/`))

  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`} style={{
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
        <div style={{ padding: '20px 18px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)',
          }}>
            DIVVY
          </div>
          <div className="brand-sub" style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>
            Wealth tracker
          </div>
          <button
            type="button"
            onClick={() => setRecording(true)}
            aria-label="Record a transaction"
            title="Record a buy, sell, dividend, deposit, interest…"
            style={{
              marginTop: 12, width: '100%', padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
              background: 'var(--green-bg)', border: '1px solid var(--green-bd)', color: 'var(--green)',
              fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <span aria-hidden="true">+</span><span className="nav-label">Record</span>
          </button>
        </div>

        {/* Nav */}
        <nav aria-label="Main" style={{ flex: 1, padding: '8px 10px', overflowY: 'auto' }}>
          {NAV.map(group => (
            <div key={group.section} style={{ marginBottom: 4 }}>
              <div className="nav-section" style={{
                fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--text3)', padding: '10px 10px 4px', fontWeight: 600,
              }}>
                {group.section}
              </div>
              {group.items.map(item => {
                const active = isActive(item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="nav-link"
                    aria-current={active ? 'page' : undefined}
                    title={item.label}
                    onClick={onNavigate}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 6,
                      textDecoration: 'none', fontSize: 12,
                      background: active ? 'var(--bg4)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--text2)',
                      fontWeight: active ? 500 : 400,
                      border: active ? '1px solid var(--border2)' : '1px solid transparent',
                      marginBottom: 1, transition: 'background 0.1s',
                    }}
                  >
                    <span aria-hidden="true" style={{ width: 16, textAlign: 'center', fontSize: 11, color: item.color }}>
                      {item.icon}
                    </span>
                    <span className="nav-label">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Profile switcher footer */}
        <div className="profile-footer" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <ProfileSwitcher />
        </div>
      </aside>
      {recording && <RecordModal onClose={() => setRecording(false)} />}
    </>
  )
}

/**
 * Tabs across sibling routes (e.g. Positions · Performance · Fees). Rendered
 * at the top of each of those pages so the merged sections stay one click apart.
 */
export function RouteTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname()
  return (
    <nav aria-label="Section" style={{
      display: 'inline-flex', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden', marginBottom: 18,
    }}>
      {tabs.map((t, i) => {
        const active = path === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            style={{
              padding: '6px 14px', fontSize: 12, textDecoration: 'none',
              background: active ? 'var(--bg4)' : 'var(--bg2)',
              color: active ? 'var(--text)' : 'var(--text3)',
              fontWeight: active ? 500 : 400,
              borderRight: i < tabs.length - 1 ? '1px solid var(--border2)' : 'none',
            }}
          >{t.label}</Link>
        )
      })}
    </nav>
  )
}

export const STOCK_TABS = [
  { href: '/holdings', label: 'Positions' },
  { href: '/performance', label: 'Performance' },
  { href: '/fees', label: 'Fees' },
]

export const RETURNS_TABS = [
  { href: '/benchmark', label: 'vs benchmark' },
  { href: '/fx-attribution', label: 'FX attribution' },
]
