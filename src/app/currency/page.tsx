'use client'
import Sidebar from '@/components/Sidebar'

export default function CurrencyPage() {
  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 220, flex: 1, padding: '32px 36px' }}>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 300, letterSpacing: -0.5, marginBottom: 8 }}>Currency mix</div>
        <div style={{ color: 'var(--text3)', fontSize: 12 }}>Coming soon.</div>
      </main>
    </div>
  )
}