'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, DividendProjection } from '@/lib/supabase'
import { toCZK, fmtCZK, DEFAULT_FX } from '@/lib/fx'

export default function ProjectedPage() {
  const [projections, setProjections] = useState<DividendProjection[]>([])
  const fx = DEFAULT_FX

  useEffect(() => {
    supabase.from('dividend_projections').select('*').order('projected_total', { ascending: false })
      .then(({ data }) => { if (data) setProjections(data) })
  }, [])

  const years = Array.from(new Set(projections.map(p => p.year))).sort()

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 1060 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>
            Dividend projections
          </h1>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
            Estimated future income based on current holdings and growth rates
          </div>
        </div>

        {years.map(year => {
          const rows = projections.filter(p => p.year === year)
          const yearTotalCZK = rows.reduce((s, p) => s + toCZK(p.projected_total ?? 0, p.currency, fx), 0)
          const yearNetCZK = yearTotalCZK * 0.85

          return (
            <div key={year} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 18 }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
                <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 17, fontWeight: 400, fontStyle: 'italic', color: 'var(--text2)' }}>
                  {year}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Badge variant="amber">~{fmtCZK(yearTotalCZK)} gross</Badge>
                  <Badge variant="green">~{fmtCZK(yearNetCZK)} net</Badge>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Symbol', 'Div/share', 'Yield', 'Growth', 'Projected total', 'CZK equiv.', 'CCY'].map((h, i) => (
                      <th key={h} style={{
                        fontSize: 9, letterSpacing: '0.09em', textTransform: 'uppercase',
                        color: 'var(--text3)', padding: '8px 14px',
                        textAlign: i === 0 ? 'left' : 'right',
                        borderBottom: '1px solid var(--border)', fontWeight: 400,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => (
                    <tr key={p.id}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500 }}>{p.symbol}</td>
                      <td style={tdR}>{p.projected_div_per_share ?? '—'}</td>
                      <td style={tdR}>{p.projected_yield ? `${(p.projected_yield * 100).toFixed(1)}%` : '—'}</td>
                      <td style={tdR}>{(p.growth_rate * 100).toFixed(1)}%</td>
                      <td style={{ ...tdR, color: 'var(--green)' }}>~{(p.projected_total ?? 0).toLocaleString()}</td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--green)' }}>
                        ~{fmtCZK(toCZK(p.projected_total ?? 0, p.currency, fx))}
                      </td>
                      <td style={tdR}>
                        <Badge variant={p.currency === 'USD' ? 'gray' : p.currency === 'EUR' ? 'blue' : 'amber'}>
                          {p.currency}
                        </Badge>
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

const tdR: React.CSSProperties = {
  padding: '9px 14px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'right',
  color: 'var(--text2)',
  fontSize: 12,
}
