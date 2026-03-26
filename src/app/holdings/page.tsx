'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, Holding } from '@/lib/supabase'

const PRICES: Record<string, number> = {
  AAPL: 251.40, AMZN: 206.99, BYND: 0.69, CSG1: 27.99,
  ERBAG: 2222, ICL: 5.17, JPM: 292.21, KO: 74.81,
  KPLT: 7.29, MCD: 308.54, MONET: 186.40, O: 60.58,
  OPEN: 5.17, PEP: 150.62, PG: 143.08, PSNY: 17.50,
  RIO: 86.71, SKLZ: 2.57, SPY5: 657.43, SPYW: 27.20,
  T: 28.93, VZ: 50.90,
}

export default function HoldingsPage() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [filter, setFilter] = useState<'all' | 'div' | 'nondiv'>('all')

  useEffect(() => {
    supabase.from('holdings').select('*').order('symbol').then(({ data }) => {
      if (data) setHoldings(data)
    })
  }, [])

  const filtered = holdings.filter(h => {
    if (filter === 'div') return h.is_dividend_payer
    if (filter === 'nondiv') return !h.is_dividend_payer
    return true
  })

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 220, flex: 1, padding: '32px 36px', maxWidth: 1100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 300, letterSpacing: -0.5 }}>Holdings</div>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', padding: 4, borderRadius: 7 }}>
            {(['all', 'div', 'nondiv'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '5px 12px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
                fontFamily: 'DM Mono, monospace',
                background: filter === f ? 'var(--bg2)' : 'transparent',
                color: filter === f ? 'var(--text)' : 'var(--text3)',
                border: filter === f ? '1px solid var(--border)' : '1px solid transparent',
              }}>
                {f === 'all' ? 'All' : f === 'div' ? 'Dividend payers' : 'Non-dividend'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Symbol', 'Name', 'Shares', 'Avg price', 'Last price', 'Mkt value', 'Unr. P&L', 'CCY', 'Exchange', 'Type'].map((h, i) => (
                  <th key={h} style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', padding: '10px 14px', textAlign: i < 2 ? 'left' : 'right', borderBottom: '1px solid var(--border)', fontWeight: 400, background: 'var(--bg3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(h => {
                const price = PRICES[h.symbol] ?? h.avg_price
                const mktVal = price * h.shares
                const pl = mktVal - h.avg_price * h.shares
                const plPct = (pl / (h.avg_price * h.shares)) * 100
                return (
                  <tr key={h.id}>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500, color: 'var(--text)' }}>{h.symbol}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', fontSize: 12 }}>{h.name}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{h.shares}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{h.avg_price.toLocaleString()}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text)' }}>{price.toLocaleString()}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{mktVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: pl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {pl >= 0 ? '+' : ''}{pl.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({plPct.toFixed(1)}%)
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                      <Badge variant={h.currency === 'USD' ? 'gray' : h.currency === 'EUR' ? 'blue' : 'amber'}>{h.currency}</Badge>
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text3)', fontSize: 11 }}>{h.exchange ?? '—'}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                      <Badge variant={h.is_dividend_payer ? 'green' : 'red'}>{h.is_dividend_payer ? 'Dividend' : 'Non-div'}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
