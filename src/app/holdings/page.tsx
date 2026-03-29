'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import AddPositionModal from '@/components/AddPositionModal'
import { supabase, Holding, DividendProjection } from '@/lib/supabase'

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
  const [projections, setProjections] = useState<DividendProjection[]>([])
  const [filter, setFilter] = useState<'all' | 'div' | 'nondiv'>('all')
  const [showAddModal, setShowAddModal] = useState(false)

  const load = useCallback(async () => {
    const [h, p] = await Promise.all([
      supabase.from('holdings').select('*').order('symbol'),
      supabase.from('dividend_projections').select('*').eq('year', 2027),
    ])
    if (h.data) setHoldings(h.data)
    if (p.data) setProjections(p.data)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = holdings.filter(h => {
    if (filter === 'div') return h.is_dividend_payer
    if (filter === 'nondiv') return !h.is_dividend_payer
    return true
  })

  const FX: Record<string, number> = { USD: 1, EUR: 1.09, CZK: 0.04667 }
  const toUSD = (amount: number, ccy: string) => amount * (FX[ccy] ?? 1)

  const totalMktValueUSD = holdings.reduce((sum, h) => {
    const price = PRICES[h.symbol] ?? h.avg_price
    return sum + toUSD(price * h.shares, h.currency)
  }, 0)

  const totalCostUSD = holdings.reduce((sum, h) => sum + toUSD(h.avg_price * h.shares, h.currency), 0)
  const totalProjDivUSD = projections.reduce((sum, p) => sum + toUSD(p.projected_total ?? 0, p.currency), 0)

  const portfolioYield = totalMktValueUSD > 0 ? (totalProjDivUSD / totalMktValueUSD) * 100 : 0
  const portfolioYieldOnCost = totalCostUSD > 0 ? (totalProjDivUSD / totalCostUSD) * 100 : 0

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      {showAddModal && <AddPositionModal onClose={() => setShowAddModal(false)} onSaved={load} />}
      <main style={{ marginLeft: 220, flex: 1, padding: '32px 36px', maxWidth: 1200 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 300, letterSpacing: -0.5 }}>Holdings</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
            <button onClick={() => setShowAddModal(true)} style={{
              padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
              background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
              color: 'var(--green)', fontFamily: 'DM Mono, monospace', fontSize: 12,
            }}>
              + Add position
            </button>
          </div>
        </div>

        {/* Portfolio yield summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Portfolio yield', value: `${portfolioYield.toFixed(2)}%`, sub: 'Annual div / market value', accent: 'var(--green)' },
            { label: 'Yield on cost', value: `${portfolioYieldOnCost.toFixed(2)}%`, sub: 'Annual div / cost basis', accent: 'var(--blue)' },
            { label: '2027 projected income', value: `$${Math.round(totalProjDivUSD).toLocaleString()}`, sub: `on $${Math.round(totalMktValueUSD).toLocaleString()} market value`, accent: 'var(--amber)' },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.7 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 400, lineHeight: 1, marginBottom: 4 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Holdings table */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Symbol', 'Name', 'Shares', 'Avg price', 'Last price', 'Mkt value', 'Unr. P&L', 'Div yield', 'CCY', 'Exchange', 'Type'].map((h, i) => (
                  <th key={h} style={{
                    fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: 'var(--text3)', padding: '10px 14px',
                    textAlign: i < 2 ? 'left' : 'right',
                    borderBottom: '1px solid var(--border)', fontWeight: 400,
                    background: 'var(--bg3)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(h => {
                const price = PRICES[h.symbol] ?? h.avg_price
                const mktVal = price * h.shares
                const costVal = h.avg_price * h.shares
                const pl = mktVal - costVal
                const plPct = (pl / costVal) * 100

                const proj = projections.find(p => p.symbol === h.symbol)
                const annualDivPerShare = proj?.projected_div_per_share ?? null
                const divYield = annualDivPerShare != null && price > 0
                  ? (annualDivPerShare / price) * 100
                  : null

                return (
                  <tr key={h.id}>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500, color: 'var(--text)' }}>{h.symbol}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', fontSize: 12 }}>{h.name}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{h.shares}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{h.avg_price.toLocaleString()}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text)' }}>{price.toLocaleString()}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>
                      {mktVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: pl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {pl >= 0 ? '+' : ''}{pl.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({plPct.toFixed(1)}%)
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                      {divYield != null ? (
                        <span style={{
                          color: divYield >= 4 ? 'var(--green)' : divYield >= 2 ? 'var(--amber)' : 'var(--text3)',
                          fontFamily: 'DM Mono, monospace', fontSize: 12,
                        }}>
                          {divYield.toFixed(2)}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text3)' }}>—</span>
                      )}
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
