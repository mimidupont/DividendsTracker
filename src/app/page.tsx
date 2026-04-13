'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import LogDividendModal from '@/components/LogDividendModal'
import AddPositionModal from '@/components/AddPositionModal'
import { supabase, Holding, DividendReceived, DividendProjection } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// FX rates to CZK (base currency)
const FX_TO_CZK: Record<string, number> = { USD: 23.50, EUR: 25.60, CZK: 1 }
const toCZK = (amount: number, ccy: string) => amount * (FX_TO_CZK[ccy] ?? 23.50)
const fmtCZK = (n: number, decimals = 0) =>
  `Kč ${n.toLocaleString('cs-CZ', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

// Current prices
const PRICES: Record<string, number> = {
  AAPL: 251.40, AMZN: 206.99, BYND: 0.69, CSG1: 27.99,
  ERBAG: 2222, ICL: 5.17, JPM: 292.21, KO: 74.81,
  KPLT: 7.29, MCD: 308.54, MONET: 186.40, O: 60.58,
  OPEN: 5.17, PEP: 150.62, PG: 143.08, PSNY: 17.50,
  RIO: 86.71, SKLZ: 2.57, SPY5: 657.43, SPYW: 27.20,
  T: 28.93, VZ: 50.90,
}

export default function Dashboard() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [received, setReceived] = useState<DividendReceived[]>([])
  const [projections, setProjections] = useState<DividendProjection[]>([])
  const [showModal, setShowModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [h, r, p] = await Promise.all([
      supabase.from('holdings').select('*').order('symbol'),
      supabase.from('dividends_received').select('*').order('payment_date', { ascending: false }),
      supabase.from('dividend_projections').select('*').eq('year', 2027).order('projected_total', { ascending: false }),
    ])
    if (h.data) setHoldings(h.data)
    if (r.data) setReceived(r.data)
    if (p.data) setProjections(p.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Metrics in CZK
  const totalValueCZK = holdings.reduce((sum, h) => {
    const price = PRICES[h.symbol] ?? h.avg_price
    return sum + toCZK(price * h.shares, h.currency)
  }, 0)

  const totalCostCZK = holdings.reduce((sum, h) => sum + toCZK(h.avg_price * h.shares, h.currency), 0)
  const unrealizedPLCZK = totalValueCZK - totalCostCZK

  const ytdGrossCZK = received.reduce((sum, d) => sum + toCZK(d.gross_amount, d.currency), 0)
  const ytdNetCZK = received.reduce((sum, d) => sum + toCZK(d.net_amount, d.currency), 0)

  const proj2027GrossCZK = projections.reduce((sum, p) => sum + toCZK(p.projected_total ?? 0, p.currency), 0)
  const proj2027NetCZK = proj2027GrossCZK * 0.85

  const portfolioYield = totalValueCZK > 0 ? (proj2027GrossCZK / totalValueCZK) * 100 : 0
  const portfolioYieldOnCost = totalCostCZK > 0 ? (proj2027GrossCZK / totalCostCZK) * 100 : 0

  // Chart data — top 8 projected (in CZK)
  const chartData = projections.slice(0, 8).map(p => ({
    symbol: p.symbol,
    amount: Math.round(toCZK(p.projected_total ?? 0, p.currency)),
  }))

  // Currency exposure
  const byCcy: Record<string, number> = {}
  holdings.forEach(h => {
    const v = toCZK((PRICES[h.symbol] ?? h.avg_price) * h.shares, h.currency)
    byCcy[h.currency] = (byCcy[h.currency] ?? 0) + v
  })
  const totalV = Object.values(byCcy).reduce((a, b) => a + b, 0)

  const divPayers = holdings.filter(h => h.is_dividend_payer).length
  const nonDiv = holdings.length - divPayers

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 220, flex: 1, padding: '32px 36px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
        Loading portfolio…
      </main>
    </div>
  )

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      {showModal && <LogDividendModal onClose={() => setShowModal(false)} onSaved={load} />}
      {showAddModal && <AddPositionModal onClose={() => setShowAddModal(false)} onSaved={load} />}

      <main style={{ marginLeft: 220, flex: 1, padding: '32px 36px', maxWidth: 1100 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 300, letterSpacing: -0.5, lineHeight: 1.1 }}>
              Good morning, <span style={{ color: 'var(--green)', fontStyle: 'italic' }}>Eliot</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · All values in CZK
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAddModal(true)} style={{
              padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
              background: 'var(--bg2)', border: '1px solid var(--border2)',
              color: 'var(--text2)', fontFamily: 'DM Mono, monospace', fontSize: 12,
            }}>
              + Add position
            </button>
            <button onClick={() => setShowModal(true)} style={{
              padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
              background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
              color: 'var(--green)', fontFamily: 'DM Mono, monospace', fontSize: 12,
            }}>
              + Log dividend
            </button>
          </div>
        </div>

        {/* Metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
          {[
            {
              label: 'Portfolio value',
              value: fmtCZK(totalValueCZK),
              sub: <Badge variant={unrealizedPLCZK >= 0 ? 'green' : 'red'}>{unrealizedPLCZK >= 0 ? '+' : ''}{fmtCZK(unrealizedPLCZK)} P&L</Badge>,
              accent: 'var(--green)',
            },
            {
              label: 'YTD dividends received',
              value: fmtCZK(ytdGrossCZK, 2),
              sub: <Badge variant="green">{fmtCZK(ytdNetCZK, 2)} net after WHT</Badge>,
              accent: 'var(--green)',
            },
            {
              label: '2027 projected gross',
              value: fmtCZK(proj2027GrossCZK),
              sub: <Badge variant="amber">pre-withholding tax</Badge>,
              accent: 'var(--amber)',
            },
            {
              label: '2027 projected net',
              value: fmtCZK(proj2027NetCZK),
              sub: <Badge variant="blue">≈ ${Math.round(proj2027NetCZK / 23.50).toLocaleString()} USD</Badge>,
              accent: 'var(--blue)',
            },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.7 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8 }}>{m.label}</div>
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 400, lineHeight: 1, marginBottom: 8 }}>{m.value}</div>
              <div>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Yield cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'Portfolio yield', value: `${portfolioYield.toFixed(2)}%`, sub: <Badge variant="green">annual dividends / market value</Badge>, accent: 'var(--green)' },
            { label: 'Yield on cost', value: `${portfolioYieldOnCost.toFixed(2)}%`, sub: <Badge variant="blue">annual dividends / cost basis</Badge>, accent: 'var(--blue)' },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.7 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8 }}>{m.label}</div>
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 400, lineHeight: 1, marginBottom: 8 }}>{m.value}</div>
              <div>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Two columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, marginBottom: 16 }}>

          {/* Holdings table */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)' }}>Holdings</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Badge variant="green">{divPayers} div. payers</Badge>
                <Badge variant="red">{nonDiv} non-div.</Badge>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Symbol', 'Shares', 'Price', 'Mkt value (CZK)', 'Unr. P&L (CZK)', '2027 div (CZK)'].map((h, i) => (
                      <th key={h} style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', padding: '8px 14px', textAlign: i === 0 ? 'left' : 'right', borderBottom: '1px solid var(--border)', fontWeight: 400 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map(h => {
                    const price = PRICES[h.symbol] ?? h.avg_price
                    const mktValCZK = toCZK(price * h.shares, h.currency)
                    const costValCZK = toCZK(h.avg_price * h.shares, h.currency)
                    const plCZK = mktValCZK - costValCZK
                    const proj = projections.find(p => p.symbol === h.symbol)
                    const projTotalCZK = proj ? toCZK(proj.projected_total ?? 0, proj.currency) : null
                    return (
                      <tr key={h.id}>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontWeight: 500, color: 'var(--text)' }}>{h.symbol}</span>
                          <br />
                          <span style={{ fontSize: 10, color: 'var(--text3)' }}>{h.name}</span>
                        </td>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{h.shares}</td>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>
                          {price.toLocaleString()} <span style={{ fontSize: 10, color: 'var(--text3)' }}>{h.currency}</span>
                        </td>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)', fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
                          {fmtCZK(mktValCZK)}
                        </td>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: plCZK >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
                          {plCZK >= 0 ? '+' : ''}{fmtCZK(plCZK)}
                        </td>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: projTotalCZK ? 'var(--green)' : 'var(--text3)', fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
                          {projTotalCZK ? `~${fmtCZK(projTotalCZK)}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Currency exposure */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)' }}>Currency exposure</span>
              </div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Object.entries(byCcy).sort((a, b) => b[1] - a[1]).map(([ccy, val]) => {
                  const pct = (val / totalV * 100).toFixed(1)
                  const colors: Record<string, string> = { USD: 'var(--green)', EUR: 'var(--blue)', CZK: 'var(--amber)' }
                  return (
                    <div key={ccy}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>
                        <span>{ccy}</span>
                        <span>
                          <span style={{ color: colors[ccy] ?? 'var(--text3)', marginRight: 8 }}>{pct}%</span>
                          <span style={{ color: 'var(--text3)', fontSize: 10 }}>{fmtCZK(val)}</span>
                        </span>
                      </div>
                      <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: colors[ccy] ?? 'var(--text3)', borderRadius: 3, transition: 'width 1s ease' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 2027 income chart (CZK) */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flex: 1 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)' }}>2027 income by holding (CZK)</span>
              </div>
              <div style={{ padding: '16px 8px 8px' }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24, top: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text3)', fontFamily: 'DM Mono' }} axisLine={false} tickLine={false}
                      tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis type="category" dataKey="symbol" tick={{ fontSize: 11, fill: 'var(--text2)', fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip
                      formatter={(v: number) => [fmtCZK(v), '2027 est.']}
                      contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11 }}
                    />
                    <Bar dataKey="amount" radius={[0, 3, 3, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.symbol === 'RIO' ? '#c8a030' : '#2d6e2b'} fillOpacity={0.75} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* Dividend log */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)' }}>Dividend log</span>
            <Badge variant="green">YTD gross: {fmtCZK(ytdGrossCZK, 2)}</Badge>
          </div>
          <div style={{ padding: '4px 20px' }}>
            {received.length === 0 && (
              <div style={{ padding: '20px 0', color: 'var(--text3)', fontSize: 12 }}>No dividends logged yet. Click "Log dividend" to add one.</div>
            )}
            {received.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
                <div style={{ fontWeight: 500, color: 'var(--text)', minWidth: 44 }}>{d.symbol}</div>
                <div style={{ color: 'var(--text3)', fontSize: 11, flex: 1 }}>
                  {fmtDate(d.payment_date)} · {d.amount_per_share} {d.currency}/share × {d.shares_held} shares
                  {d.notes && <span> · {d.notes}</span>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: 'var(--green)' }}>+{fmtCZK(toCZK(d.gross_amount, d.currency), 2)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                    WHT −{fmtCZK(toCZK(d.withholding_tax, d.currency), 2)}
                    <span style={{ marginLeft: 6, opacity: 0.6 }}>({d.gross_amount.toFixed(2)} {d.currency})</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  )
}
