'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, Holding } from '@/lib/supabase'
import { toCZK, fmtCZK, DEFAULT_FX } from '@/lib/fx'
import { getPrice } from '@/lib/prices'

export default function CurrencyPage() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const fx = DEFAULT_FX

  useEffect(() => {
    supabase.from('holdings').select('*').then(({ data }) => { if (data) setHoldings(data) })
  }, [])

  const byCcy: Record<string, { value: number; holdings: Holding[] }> = {}
  holdings.forEach(h => {
    const v = toCZK(getPrice(h.symbol, h.avg_price) * h.shares, h.currency, fx)
    if (!byCcy[h.currency]) byCcy[h.currency] = { value: 0, holdings: [] }
    byCcy[h.currency].value += v
    byCcy[h.currency].holdings.push(h)
  })

  const totalV = Object.values(byCcy).reduce((a, b) => a + b.value, 0)
  const sorted = Object.entries(byCcy).sort((a, b) => b[1].value - a[1].value)

  const ccyColors: Record<string, string> = {
    USD: 'var(--green)',
    EUR: 'var(--blue)',
    CZK: 'var(--amber)',
    GBP: 'var(--red)',
  }

  const ccyBadge: Record<string, 'green' | 'blue' | 'amber' | 'red'> = {
    USD: 'green', EUR: 'blue', CZK: 'amber', GBP: 'red',
  }

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 900 }}>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>
            Currency mix
          </h1>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
            Portfolio exposure by base currency · Total {fmtCZK(totalV)}
          </div>
        </div>

        {/* Big bars */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '20px 24px', marginBottom: 16 }}>
          <div style={{ height: 20, display: 'flex', borderRadius: 6, overflow: 'hidden', marginBottom: 16 }}>
            {sorted.map(([ccy, { value }]) => {
              const pct = (value / totalV) * 100
              return (
                <div key={ccy} style={{
                  width: `${pct}%`,
                  background: ccyColors[ccy] ?? 'var(--text3)',
                  opacity: 0.75,
                  transition: 'width 1s ease',
                  position: 'relative',
                }} title={`${ccy}: ${pct.toFixed(1)}%`} />
              )
            })}
          </div>

          {sorted.map(([ccy, { value }]) => {
            const pct = (value / totalV) * 100
            return (
              <div key={ccy} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: ccyColors[ccy], opacity: 0.8 }} />
                    <span style={{ fontWeight: 500 }}>{ccy}</span>
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {fx[ccy] ? `1 ${ccy} = ${fx[ccy].toFixed(2)} CZK` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{fmtCZK(value)}</span>
                    <span style={{ color: ccyColors[ccy], fontWeight: 600, fontSize: 13 }}>{pct.toFixed(1)}%</span>
                  </div>
                </div>
                <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: ccyColors[ccy] ?? 'var(--text3)',
                    borderRadius: 3,
                    opacity: 0.7,
                    transition: 'width 1s ease',
                  }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Per-currency holdings breakdown */}
        {sorted.map(([ccy, { holdings: ccyHoldings, value }]) => (
          <div key={ccy} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ padding: '11px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Badge variant={ccyBadge[ccy] ?? 'gray'}>{ccy}</Badge>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>{ccyHoldings.length} holdings</span>
              </div>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                {fmtCZK(value)} · {((value / totalV) * 100).toFixed(1)}%
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {ccyHoldings.map(h => {
                  const v = toCZK(getPrice(h.symbol, h.avg_price) * h.shares, h.currency, fx)
                  const share = (v / value) * 100
                  return (
                    <tr key={h.id}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)', width: 180 }}>
                        <span style={{ fontWeight: 500 }}>{h.symbol}</span>
                        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>{h.name}</span>
                      </td>
                      <td style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 5, background: 'var(--bg3)', borderRadius: 3 }}>
                            <div style={{
                              height: '100%',
                              width: `${share}%`,
                              background: ccyColors[ccy],
                              borderRadius: 3, opacity: 0.6,
                            }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text3)', minWidth: 40, textAlign: 'right' }}>
                            {share.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {fmtCZK(v)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}

      </main>
    </div>
  )
}
