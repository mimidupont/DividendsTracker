'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, Holding, DividendReceived } from '@/lib/supabase'
import { toCZK, fmtCZK, DEFAULT_FX, fetchFxRates } from '@/lib/fx'
import { useMarketData } from '@/hooks/useMarketData'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'

const CURRENT_YEAR = new Date().getFullYear()

export default function PerformancePage() {
  const [holdings, setHoldings]   = useState<Holding[]>([])
  const [received, setReceived]   = useState<DividendReceived[]>([])
  const [fx, setFx]               = useState(DEFAULT_FX)
  const [loading, setLoading]     = useState(true)
  const [fxLoading, setFxLoading] = useState(false)
  const [fxTs, setFxTs]           = useState<string | null>(null)
  const [sortBy, setSortBy]       = useState<'pl' | 'pct' | 'value'>('pl')

  const market = useMarketData()

  const load = useCallback(async () => {
    const [h, r] = await Promise.all([
      supabase.from('holdings').select('*').order('symbol'),
      supabase.from('dividends_received').select('*').order('payment_date', { ascending: false }),
    ])
    if (h.data) setHoldings(h.data)
    if (r.data) setReceived(r.data)
    setLoading(false)
    return h.data ?? []
  }, [])

  useEffect(() => {
    load().then(h => {
      if (h.length > 0) market.refresh(h.map((hh: Holding) => hh.symbol))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshFx = async () => {
    setFxLoading(true)
    const rates = await fetchFxRates()
    setFx(rates)
    setFxTs(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    setFxLoading(false)
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  const rows = holdings.map(h => {
    const price    = market.getPrice(h.symbol, h.avg_price)
    const mktCZK   = toCZK(price * h.shares, h.currency, fx)
    const costCZK  = toCZK(h.avg_price * h.shares, h.currency, fx)
    const plCZK    = mktCZK - costCZK
    const plPct    = costCZK > 0 ? (plCZK / costCZK) * 100 : 0
    const chgPct   = market.quotes[h.symbol]?.changePercent ?? null
    const divIncome = received
      .filter(d => d.symbol === h.symbol)
      .reduce((s, d) => s + toCZK(d.gross_amount, d.currency, fx), 0)
    const totalReturn = plCZK + divIncome
    const totalReturnPct = costCZK > 0 ? (totalReturn / costCZK) * 100 : 0
    return { h, price, mktCZK, costCZK, plCZK, plPct, chgPct, divIncome, totalReturn, totalReturnPct }
  })

  const sorted = [...rows].sort((a, b) => {
    if (sortBy === 'pl')    return b.plCZK - a.plCZK
    if (sortBy === 'pct')   return b.plPct - a.plPct
    return b.mktCZK - a.mktCZK
  })

  const totalValueCZK   = rows.reduce((s, r) => s + r.mktCZK, 0)
  const totalCostCZK    = rows.reduce((s, r) => s + r.costCZK, 0)
  const totalPLCZK      = totalValueCZK - totalCostCZK
  const totalPLPct      = totalCostCZK > 0 ? (totalPLCZK / totalCostCZK) * 100 : 0
  const totalDivCZK     = received.reduce((s, d) => s + toCZK(d.gross_amount, d.currency, fx), 0)
  const totalReturnCZK  = totalPLCZK + totalDivCZK
  const totalReturnPct  = totalCostCZK > 0 ? (totalReturnCZK / totalCostCZK) * 100 : 0

  const winners = rows.filter(r => r.plCZK > 0).length
  const losers  = rows.filter(r => r.plCZK < 0).length

  // Monthly dividend income chart data
  const monthlyData: Record<string, number> = {}
  received.forEach(d => {
    const key = d.payment_date.slice(0, 7)
    monthlyData[key] = (monthlyData[key] ?? 0) + toCZK(d.gross_amount, d.currency, fx)
  })
  const monthlyChart = Object.entries(monthlyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, amount]) => ({
      month: new Date(month + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      amount: Math.round(amount),
    }))

  // P&L bar chart data (top/bottom 10 by absolute P&L)
  const plChartData = [...rows]
    .sort((a, b) => b.plCZK - a.plCZK)
    .slice(0, 12)
    .map(r => ({ symbol: r.h.symbol, pl: Math.round(r.plCZK), pct: parseFloat(r.plPct.toFixed(1)) }))

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        {payload.map((p: any) => (
          <div key={p.name} style={{ color: p.value >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {p.name === 'pl' ? fmtCZK(p.value) : `${p.value > 0 ? '+' : ''}${p.value}%`}
          </div>
        ))}
      </div>
    )
  }

  const DivTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        <div style={{ color: 'var(--green)' }}>{fmtCZK(payload[0].value, 0)}</div>
      </div>
    )
  }

  const marketStatusColor = { idle: 'var(--text3)', loading: 'var(--amber)', done: 'var(--green)', error: 'var(--red)' }[market.state]
  const marketStatusText  = { idle: '', loading: '⟳ Fetching…', done: `✓ Live · ${market.fetchedAt ? new Date(market.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}`, error: `⚠ ${market.errorMsg ?? 'Failed'}` }[market.state]

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>Loading…</main>
    </div>
  )

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 1200 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 26 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>Performance</h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, display: 'flex', gap: 10 }}>
              {holdings.length} positions · All values in CZK
              {fxTs && <span style={{ color: 'var(--green)' }}>· FX {fxTs}</span>}
              {marketStatusText && <span style={{ color: marketStatusColor }}>{marketStatusText}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refreshFx} disabled={fxLoading} style={btnStyle('secondary')}>
              {fxLoading ? '⟳ FX…' : '↻ FX rates'}
            </button>
            <button onClick={() => market.refresh(holdings.map(h => h.symbol))} disabled={market.state === 'loading'} style={btnStyle('secondary')}>
              {market.state === 'loading' ? '⟳ Loading…' : '↻ Refresh prices'}
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Unrealized P&L', value: (totalPLCZK >= 0 ? '+' : '') + fmtCZK(totalPLCZK), accent: totalPLCZK >= 0 ? 'var(--green)' : 'var(--red)', color: totalPLCZK >= 0 ? 'var(--green)' : 'var(--red)', note: `${totalPLPct >= 0 ? '+' : ''}${totalPLPct.toFixed(2)}% on cost` },
            { label: 'Dividend income', value: fmtCZK(totalDivCZK, 0), accent: 'var(--amber)', color: 'var(--text)', note: `${received.length} payments logged` },
            { label: 'Total return', value: (totalReturnCZK >= 0 ? '+' : '') + fmtCZK(totalReturnCZK), accent: totalReturnCZK >= 0 ? 'var(--green)' : 'var(--red)', color: totalReturnCZK >= 0 ? 'var(--green)' : 'var(--red)', note: `${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}% incl. dividends` },
            { label: 'Winners / Losers', value: `${winners} / ${losers}`, accent: 'var(--blue)', color: 'var(--text)', note: `${rows.filter(r => r.plCZK === 0).length} flat` },
            { label: 'Portfolio value', value: fmtCZK(totalValueCZK), accent: 'var(--blue)', color: 'var(--text)', note: `Cost: ${fmtCZK(totalCostCZK)}` },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.8 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400, marginBottom: 4, color: m.color }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

          {/* P&L by position bar chart */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>Unrealized P&L by position</span>
              <Badge variant="gray">top 12 by |P&L|</Badge>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={plChartData} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="symbol" tick={{ fontSize: 9, fill: 'var(--text3)' }} />
                <YAxis tickFormatter={n => fmtCZK(n)} tick={{ fontSize: 9, fill: 'var(--text3)' }} width={72} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0} stroke="var(--border2)" />
                <Bar dataKey="pl" name="pl" radius={[3, 3, 0, 0]}>
                  {plChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.pl >= 0 ? 'var(--green-mid)' : 'var(--red)'} opacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly dividend income chart */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>Monthly dividend income</span>
              <Badge variant="amber">last 12 months</Badge>
            </div>
            {monthlyChart.length === 0 ? (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 12 }}>No dividend data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyChart} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--text3)' }} />
                  <YAxis tickFormatter={n => fmtCZK(n)} tick={{ fontSize: 9, fill: 'var(--text3)' }} width={72} />
                  <Tooltip content={<DivTooltip />} />
                  <Bar dataKey="amount" name="Gross dividends" fill="var(--amber)" opacity={0.8} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Position-level P&L table */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>Position performance</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['pl', 'pct', 'value'] as const).map(s => (
                <button key={s} onClick={() => setSortBy(s)} style={{
                  padding: '3px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                  background: sortBy === s ? 'var(--green-bg)' : 'var(--bg2)',
                  border: `1px solid ${sortBy === s ? 'var(--green-bd)' : 'var(--border2)'}`,
                  color: sortBy === s ? 'var(--green)' : 'var(--text3)',
                }}>
                  {s === 'pl' ? 'P&L (CZK)' : s === 'pct' ? 'P&L (%)' : 'Value'}
                </button>
              ))}
              {market.state === 'done' && <Badge variant="live">LIVE</Badge>}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Company', 'Shares', 'Avg cost', 'Last price', 'Mkt value (CZK)', 'Unrealized P&L', 'P&L %', 'Div received', 'Total return'].map((h, i) => (
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
                {sorted.map(({ h, price, mktCZK, costCZK, plCZK, plPct, chgPct, divIncome, totalReturn, totalReturnPct }) => (
                  <tr key={h.id}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 500 }}>{h.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{h.symbol} · {h.currency}</div>
                    </td>
                    <td style={tdR}>{h.shares.toFixed(4)}</td>
                    <td style={tdR}>
                      {h.avg_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 3 }}>{h.currency}</span>
                    </td>
                    <td style={tdR}>
                      {market.state === 'loading'
                        ? <span style={{ color: 'var(--text4)' }}>…</span>
                        : <>{price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 3 }}>{h.currency}</span></>
                      }
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{fmtCZK(mktCZK)}</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12, color: plCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {plCZK >= 0 ? '+' : ''}{fmtCZK(plCZK)}
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12, color: plPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12, color: divIncome > 0 ? 'var(--amber)' : 'var(--text4)' }}>
                      {divIncome > 0 ? fmtCZK(divIncome) : '—'}
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12, color: totalReturn >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>
                      {totalReturn >= 0 ? '+' : ''}{fmtCZK(totalReturn)}
                      <div style={{ fontSize: 10, color: totalReturnPct >= 0 ? 'var(--green)' : 'var(--red)', opacity: 0.7 }}>
                        {totalReturnPct >= 0 ? '+' : ''}{totalReturnPct.toFixed(1)}%
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}

const tdR: React.CSSProperties = {
  padding: '9px 14px', borderBottom: '1px solid var(--border)',
  textAlign: 'right', color: 'var(--text2)', fontSize: 12,
}

function btnStyle(variant: 'primary' | 'secondary'): React.CSSProperties {
  return {
    padding: '7px 15px', borderRadius: 6, cursor: 'pointer',
    background: 'var(--bg2)', border: '1px solid var(--border2)',
    color: 'var(--text2)', fontFamily: "'Geist', sans-serif", fontSize: 12,
  }
}
