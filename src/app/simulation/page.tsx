'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, Holding, DividendProjection } from '@/lib/supabase'
import { toCZK, fmtCZK } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'
import { computeProjectedTotal } from '@/lib/projections'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const CURRENT_YEAR = new Date().getFullYear()

interface SimYear {
  year: number
  portfolioValue: number
  dividendIncome: number
  cumulativeDividends: number
}

/**
 * Simulate portfolio growth year by year.
 *
 * Logic per year i (starting from i=0 = today):
 *   1. Record current state (value, div income) for year CURRENT_YEAR + i
 *   2. Add annual contribution
 *   3. Add reinvested dividends (net of 15% WHT) if DRIP enabled
 *   4. Apply portfolio growth rate to get next year's value
 *   5. Grow dividend by dividendGrowthRate for next year
 *
 * FIRE number: target portfolio = annualIncome / withdrawalRate
 * e.g. 50 000 CZK/yr income, 4% rate → need 1 250 000 CZK portfolio
 */
function simulate(
  initialValue: number,
  annualDiv: number,
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
  let value = initialValue
  let div = annualDiv
  let cumDiv = 0

  const WHT = 0.15 // withholding tax on dividends

  for (let i = 0; i <= params.years; i++) {
    // Record this year's snapshot first
    rows.push({
      year: CURRENT_YEAR + i,
      portfolioValue: Math.round(value),
      dividendIncome: Math.round(div),
      cumulativeDividends: Math.round(cumDiv),
    })

    // Accumulate dividends received this year (net of WHT)
    const netDiv = div * (1 - WHT)
    cumDiv += netDiv

    // Grow portfolio for next year
    const reinvestAmount = params.reinvestDividends ? netDiv : 0
    value = (value + params.annualContribution + reinvestAmount) * (1 + params.portfolioGrowthRate)

    // Grow dividend for next year
    div = div * (1 + params.dividendGrowthRate)
  }

  return rows
}

const fmtK = (n: number) => {
  if (n >= 1_000_000) return `Kč\u202f${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `Kč\u202f${(n / 1_000).toFixed(0)}K`
  return fmtCZK(n)
}

export default function SimulationPage() {
  const [holdings, setHoldings]       = useState<Holding[]>([])
  const [projections, setProjections] = useState<DividendProjection[]>([])
  const [loading, setLoading]         = useState(true)
  const { fx } = useFx()

  const [years, setYears]               = useState(30)
  const [contribution, setContribution] = useState(50000)
  const [growthRate, setGrowthRate]     = useState(7)
  const [divGrowth, setDivGrowth]       = useState(5)
  const [withdrawalRate, setWithdrawal] = useState(4)
  const [reinvest, setReinvest]         = useState(true)

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

  // Use cost basis as portfolio starting value (market data not loaded on this page)
  const initialValueCZK = holdings.reduce(
    (s, h) => s + toCZK(h.avg_price * h.shares, h.currency, fx), 0
  )

  // Annual dividend income from projections
  const annualDivCZK = holdings.reduce((s, h) => {
    const proj = projections.find(p => p.symbol === h.symbol)
    if (!proj) return s
    return s + toCZK(computeProjectedTotal(proj, holdings), proj.currency, fx)
  }, 0)

  const data = loading ? [] : simulate(initialValueCZK, annualDivCZK, {
    annualContribution: contribution,
    portfolioGrowthRate: growthRate / 100,
    dividendGrowthRate:  divGrowth / 100,
    withdrawalRate:      withdrawalRate / 100,
    years,
    reinvestDividends: reinvest,
  })

  const final = data[data.length - 1]

  // FIRE number: how much portfolio you need so withdrawalRate% covers annual div income
  // e.g. Kč 50 000 / yr ÷ 4% = Kč 1 250 000 needed
  const fireNumber = withdrawalRate > 0
    ? annualDivCZK / (withdrawalRate / 100)
    : 0

  // Years until portfolio reaches FIRE number (first year where value >= fireNumber)
  const fireYear = data.find(r => r.portfolioValue >= fireNumber)
  const yearsToFire = fireYear ? fireYear.year - CURRENT_YEAR : null

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border2)',
        borderRadius: 8, padding: '12px 16px', fontSize: 11,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
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
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>
        Loading…
      </main>
    </div>
  )

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 1100 }}>

        {/* Header */}
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
            {
              label: 'Current value (cost basis)',
              value: fmtK(initialValueCZK),
              accent: 'var(--blue)',
              note: `${holdings.length} positions`,
            },
            {
              label: `Portfolio in ${years} years`,
              value: fmtK(final?.portfolioValue ?? 0),
              accent: 'var(--green)',
              note: `at ${growthRate}% annual growth`,
            },
            {
              label: `Annual dividends in ${years}y`,
              value: fmtK(final?.dividendIncome ?? 0),
              accent: 'var(--amber)',
              note: `at ${divGrowth}% dividend growth`,
            },
            {
              label: `FIRE number (${withdrawalRate}% rule)`,
              value: fmtK(fireNumber),
              accent: 'var(--red)',
              note: yearsToFire != null
                ? `~${yearsToFire} years away`
                : 'beyond simulation range',
            },
          ].map((m, i) => (
            <div key={i} style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 18px',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, fontWeight: 500 }}>
                {m.label}
              </div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400, marginBottom: 3 }}>
                {m.value}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18 }}>

          {/* Controls */}
          <div style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '18px 20px',
          }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500, marginBottom: 18 }}>
              Assumptions
            </div>

            {[
              { label: 'Time horizon',            value: years,        setter: setYears,        min: 5,  max: 50,     step: 1,   unit: ' years' },
              { label: 'Annual contribution',     value: contribution, setter: setContribution, min: 0,  max: 500000, step: 5000, unit: ' CZK',  fmt: (v: number) => fmtCZK(v, 0) },
              { label: 'Portfolio growth rate',   value: growthRate,   setter: setGrowthRate,   min: 0,  max: 20,     step: 0.5, unit: '%' },
              { label: 'Dividend growth rate',    value: divGrowth,    setter: setDivGrowth,    min: 0,  max: 15,     step: 0.5, unit: '%' },
              { label: 'Withdrawal rate (FIRE)',  value: withdrawalRate, setter: setWithdrawal, min: 1,  max: 8,      step: 0.5, unit: '%' },
            ].map(s => (
              <div key={s.label} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{s.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>
                    {s.fmt ? s.fmt(s.value) : `${s.value}${s.unit}`}
                  </span>
                </div>
                <input
                  type="range"
                  min={s.min} max={s.max} step={s.step} value={s.value}
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
              <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 4, marginLeft: 23 }}>
                Reinvests net-of-15%-WHT dividends
              </div>
            </div>

            {/* FIRE explanation box */}
            <div style={{
              marginTop: 16, padding: '12px 14px',
              background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                FIRE target
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6 }}>
                At <strong>{withdrawalRate}%</strong> withdrawal rate, you need a portfolio of{' '}
                <strong style={{ color: 'var(--green)' }}>{fmtK(fireNumber)}</strong>{' '}
                to sustainably generate your current projected dividend income of{' '}
                <strong>{fmtK(annualDivCZK)}/yr</strong> indefinitely.
              </div>
              {yearsToFire != null && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--green)' }}>
                  ✓ Portfolio reaches this in ~<strong>{yearsToFire} years</strong> ({CURRENT_YEAR + yearsToFire})
                </div>
              )}
            </div>

            {/* Assumptions note */}
            <div style={{
              marginTop: 10, padding: '10px 12px',
              background: 'var(--bg3)', border: '1px solid var(--border)',
              borderRadius: 7, fontSize: 10, color: 'var(--text4)', lineHeight: 1.6,
            }}>
              ⓘ Starting value uses cost basis. Growth and dividend rates are nominal (pre-inflation). Dividends taxed at 15% WHT before reinvestment.
            </div>
          </div>

          {/* Chart */}
          <div style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '18px 20px',
          }}>
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
                    <stop offset="5%"  stopColor="#4a9448" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#4a9448" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorDiv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#7a5810" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#7a5810" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: 'var(--text3)' }} />
                <YAxis tickFormatter={fmtK} tick={{ fontSize: 9, fill: 'var(--text3)' }} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone" dataKey="portfolioValue" name="Portfolio value"
                  stroke="#4a9448" strokeWidth={2} fill="url(#colorValue)"
                />
                <Area
                  type="monotone" dataKey="dividendIncome" name="Dividend income"
                  stroke="#7a5810" strokeWidth={2} fill="url(#colorDiv)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Milestones table */}
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 10, overflow: 'hidden', marginTop: 18,
        }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>
              Year-by-year milestones
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Year', 'Portfolio value', 'Annual dividends (gross)', 'Cumul. dividends (net)', 'Growth vs today', 'FIRE progress'].map((h, i) => (
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
                {data
                  .filter((_, i) => i % 5 === 0 || i === data.length - 1)
                  .map(row => {
                    const growthPct = initialValueCZK > 0
                      ? ((row.portfolioValue - initialValueCZK) / initialValueCZK) * 100
                      : 0
                    const firePct = fireNumber > 0
                      ? Math.min((row.portfolioValue / fireNumber) * 100, 100)
                      : 0
                    const isFired = row.portfolioValue >= fireNumber && fireNumber > 0

                    return (
                      <tr
                        key={row.year}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        style={{ background: isFired ? 'rgba(74,222,128,0.03)' : '' }}
                      >
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500 }}>
                          {row.year}
                          {row.year === CURRENT_YEAR && (
                            <Badge variant="blue" style={{ marginLeft: 8 }}>today</Badge>
                          )}
                          {isFired && row.year === (fireYear?.year ?? -1) && (
                            <Badge variant="green" style={{ marginLeft: 8 }}>FIRE ✓</Badge>
                          )}
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
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: growthPct >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                          {growthPct >= 0 ? '+' : ''}{growthPct.toFixed(0)}%
                        </td>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                          {fireNumber > 0 ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                              <div style={{ width: 60, height: 4, background: 'var(--bg4)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%', width: `${firePct}%`,
                                  background: isFired ? 'var(--green)' : 'var(--amber)',
                                  borderRadius: 2, transition: 'width 0.3s',
                                }} />
                              </div>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: isFired ? 'var(--green)' : 'var(--text3)', minWidth: 36, textAlign: 'right' }}>
                                {firePct.toFixed(0)}%
                              </span>
                            </div>
                          ) : <span style={{ color: 'var(--text4)', fontSize: 11 }}>—</span>}
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
