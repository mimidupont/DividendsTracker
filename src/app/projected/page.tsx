'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, DividendProjection } from '@/lib/supabase'

const FX: Record<string, number> = { USD: 1, EUR: 1.09, CZK: 0.04667 }

export default function ProjectedPage() {
  const [projections, setProjections] = useState<DividendProjection[]>([])

  useEffect(() => {
    supabase.from('dividend_projections').select('*').order('projected_total', { ascending: false }).then(({ data }) => {
      if (data) setProjections(data)
    })
  }, [])

  const totalUSD = projections.filter(p => p.year === 2027).reduce((s, p) => s + (p.projected_total ?? 0) * (FX[p.currency] ?? 1), 0)
  const totalNet = totalUSD * 0.85

  const years = Array.from(new Set(projections.map(p => p.year))).sort()

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 220, flex: 1, padding: '32px 36px', maxWidth: 1000 }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 300, letterSpacing: -0.5 }}>Dividend projections</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Estimated future income based on current holdings and growth rates</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 24 }}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>2027 gross (USD equiv.)</div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 400, color: 'var(--amber)' }}>${Math.round(totalUSD).toLocaleString()}</div>
          </div>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>2027 net after ~15% WHT</div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 400, color: 'var(--green)' }}>${Math.round(totalNet).toLocaleString()}</div>
          </div>
        </div>

        {years.map(year => {
          const rows = projections.filter(p => p.year === year)
          const yearTotal = rows.reduce((s, p) => s + (p.projected_total ?? 0) * (FX[p.currency] ?? 1), 0)
          return (
            <div key={year} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
                <span style={{ fontFamily: 'Fraunces, serif', fontSize: 16, fontWeight: 400, fontStyle: 'italic', color: 'var(--text2)' }}>{year}</span>
                <Badge variant="amber">~${Math.round(yearTotal).toLocaleString()} gross USD equiv.</Badge>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Symbol', 'Projected div/share', 'Yield', 'Growth rate', 'Projected total', 'CCY', 'USD equiv.'].map((h, i) => (
                      <th key={h} style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', padding: '8px 14px', textAlign: i === 0 ? 'left' : 'right', borderBottom: '1px solid var(--border)', fontWeight: 400 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => (
                    <tr key={p.id}>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500, color: 'var(--text)' }}>{p.symbol}</td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{p.projected_div_per_share ?? '—'}</td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{p.projected_yield ? `${(p.projected_yield * 100).toFixed(1)}%` : '—'}</td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{(p.growth_rate * 100).toFixed(1)}%</td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--green)' }}>~{(p.projected_total ?? 0).toLocaleString()}</td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                        <Badge variant={p.currency === 'USD' ? 'gray' : p.currency === 'EUR' ? 'blue' : 'amber'}>{p.currency}</Badge>
                      </td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontWeight: 500, color: 'var(--text)' }}>
                        ~${Math.round((p.projected_total ?? 0) * (FX[p.currency] ?? 1)).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </main>
    </div>
  )
}
