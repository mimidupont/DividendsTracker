'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, Holding, DividendProjection } from '@/lib/supabase'
import { toCZK, fmtCZK, DEFAULT_FX } from '@/lib/fx'
import { computeProjectedTotal } from '@/lib/projections'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const CURRENT_YEAR = new Date().getFullYear()

interface SimYear {
  year: number
  portfolioValue: number
  dividendIncome: number
  cumulativeDividends: number
  fireNumber: number
}

function simulate(
  initialValueCZK: number,
  annualDivCZK: number,
  params: {
    annualContribution: number
    portfolioGrowthRate: number
    dividendGrowthRate: number
    withdrawalRate: number
    years: number
    reinvestDividends: boolean
  }
): SimYear[] {
  const rows: SimYear[] = []
  let value = initialValueCZK
  let annualDiv = annualDivCZK
  let cumulativeDivs = 0

  for (let i = 0; i <= params.years; i++) {
    const year = CURRENT_YEAR + i
    const fireNumber = annualDiv > 0 ? (annualDiv / params.withdrawalRate) : value

    rows.push({
      year,
      portfolioValue: Math.round(value),
      dividendIncome: Math.round(annualDiv),
      cumulativeDividends: Math.round(cumulativeDivs),
      fireNumber: Math.round(fireNumber),
    })

    // Next year
    cumulativeDivs += annualDiv
    if (params.reinvestDividends) {
      value = (value + params.annualContribution + annualDiv) * (1 + params.portfolioGrowthRate)
    } else {
      value = (value + params.annualContribution) * (1 + params.portfolioGrowthRate)
    }
    annualDiv = annualDiv * (1 + params.dividendGrowthRate)
  }

  return rows
}

const fmtK = (n: number) => {
  if (n >= 1_000_000) return `Kč ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `Kč ${(n / 1_000).toFixed(0)}K`
  return fmtCZK(n)
}

export default function SimulationPage() {
  const [holdings, setHoldings]     = useState<Holding[]>([])
  const [projections, setProjections] = useState<DividendProjection[]>([])
  const [loading, setLoading]       = useState(true)
  const fx = DEFAULT_FX

  // Sim params
  const [years, setYears]                 = useState(30)
  const [contribution, setContribution]   = useState(50000)  // CZK/year
  const [growthRate, setGrowthRate]       = useState(7)       // %
  const [divGrowth, setDivGrowth]         = useState(5)       // %
  const [withdrawalRate, setWithdrawal]   = useState(4)       // %
  const [reinvest, setReinvest]           = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('holdings').select('*'),
      supabase.from('dividend_projections').select('*').eq('year', CURRENT_YEAR + 1),
    ]).then(([h, p]) => {
      if (h.data) setHoldings(h.data)
      if (p.data) setProjections(p.data)
      setLoading(false)
    })
  }, [])

  const initialValueCZK = holdings.reduce((s, h) =>
    s + toCZK(h.avg_price * h.shares, h.currency, fx), 0)

  const annualDivCZK = holdings.reduce((s, h) => {
    const proj = projections.find(p => p.symbol === h.symbol)
    if (!proj) return s
    return s + toCZK(computeProjectedTotal(proj, holdings), proj.currency, fx)
  }, 0)

  const data = loading ? [] : simulate(initialValueCZK, annualDivCZK, {
    annualContribution: contribution,
    portfolioGrowthRate: growthRate / 100,
    dividendGrowthRate: divGrowth / 100,
    withdrawalRate: withdrawalRate / 100,
    years,
    reinvestDividends: reinvest,
  })

  const fireYear = data.find(d => d.dividendIncome >= d.fireNumber * withdrawalRate / 100 ||
    d.portfolioValue * (withdrawalRate / 100) >= annualDivCZK * 12)
  const final = data[data.length - 1]

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border2)',
        borderRadius: 8, padding: '12px 16px', fontSize: 11,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>{label}</div>
        {payload.map((p: any) => (
          <div key={p.name} style={{ color: p.color, marginBottom: 3 }}>
            {p.name}: {fmtK(p.value)}
          </div>
        ))}
      </div>
    )
  }

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>Loading…</main>
    </div>
  )

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 1100 }}>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>
            Wealth simulation
          </h1>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
            Project your portfolio and dividend income over time · FIRE planning
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Current value', value: fmtK(initialValueCZK), accent: 'var(--blue)', note: 'cost basis' },
            { label: `In ${years} years`, value: fmtK(final?.portfolioValue ?? 0), accent: 'var(--green)', note: 'est. portfolio value' },
            { label: `Annual dividends in ${years}y`, value: fmtK(final?.dividendIncome ?? 0), accent: 'var(--amber)', note: 'est. annual income' },
            { label: 'FIRE number (4% rule)', value: fmtK((annualDivCZK * 12) / (withdrawalRate / 100)), accent: 'var(--red)', note: `at ${withdrawalRate}% withdrawal` },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400, marginBottom: 3 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18 }}>

          {/* Controls */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500, marginBottom: 18 }}>Assumptions</div>

            {[
              { label: 'Time horizon', value: years, setter: setYears, min: 5, max: 50, step: 1, unit: 'years' },
              { label: 'Annual contribution', value: contribution, setter: setContribution, min: 0, max: 500000, step: 5000, unit: 'CZK' },
              { label: 'Portfolio growth rate', value: growthRate, setter: setGrowthRate, min: 0, max: 20, step: 0.5, unit: '%' },
              { label: 'Dividend growth rate', value: divGrowth, setter: setDivGrowth, min: 0, max: 15, step: 0.5, unit: '%' },
              { label: 'Withdrawal rate', value: withdrawalRate, setter: setWithdrawal, min: 1, max: 8, step: 0.5, unit: '%' },
            ].map(s => (
              <div key={s.label} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{s.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', fontFamily: "'DM Mono', monospace" }}>
                    {s.unit === 'CZK' ? fmtCZK(s.value) : `${s.value}${s.unit}`}
                  </span>
                </div>
                <input
                  type="range"
                  min={s.min} max={s.max} step={s.step}
                  value={s.value}
                  onChange={e => s.setter(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--green)' }}
                />
              </div>
            ))}

            <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={reinvest}
                  onChange={e => setReinvest(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: 'var(--green)' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>Reinvest dividends (DRIP)</span>
              </label>
            </div>

            {/* FIRE insight */}
            <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--green-bg)', border: '1px solid var(--green-bd)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                FIRE target
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
                At <strong>{withdrawalRate}% withdrawal</strong>, you need{' '}
                <strong style={{ color: 'var(--green)' }}>
                  {fmtK(annualDivCZK * 25)}
                </strong>{' '}
                to replace your current dividend income.
              </div>
            </div>
          </div>

          {/* Chart */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>
                Portfolio projection
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Badge variant="green">Portfolio value</Badge>
                <Badge variant="amber">Dividend income</Badge>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4a9448" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#4a9448" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorDiv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7a5810" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#7a5810" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: 'var(--text3)' }} />
                <YAxis tickFormatter={fmtK} tick={{ fontSize: 9, fill: 'var(--text3)' }} width={70} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="portfolioValue"
                  name="Portfolio value"
                  stroke="#4a9448"
                  strokeWidth={2}
                  fill="url(#colorValue)"
                />
                <Area
                  type="monotone"
                  dataKey="dividendIncome"
                  name="Dividend income"
                  stroke="#7a5810"
                  strokeWidth={2}
                  fill="url(#colorDiv)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Milestones table */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginTop: 18 }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>Year-by-year milestones</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Year', 'Portfolio value', 'Annual dividends', 'Cumulative dividends', 'Growth vs today'].map((h, i) => (
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
                {data.filter((_, i) => i % 5 === 0 || i === data.length - 1).map(row => {
                  const growth = initialValueCZK > 0 ? ((row.portfolioValue - initialValueCZK) / initialValueCZK) * 100 : 0
                  return (
                    <tr key={row.year}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500 }}>
                        {row.year}
                        {row.year === CURRENT_YEAR && <Badge variant="blue" style={{ marginLeft: 8 }}>today</Badge>}
                      </td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {fmtK(row.portfolioValue)}
                      </td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--amber)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {fmtK(row.dividendIncome)}
                      </td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text3)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {fmtK(row.cumulativeDividends)}
                      </td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: growth >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {growth >= 0 ? '+' : ''}{growth.toFixed(0)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>
  )
}
