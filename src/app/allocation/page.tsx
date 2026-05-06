'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, Holding, DividendProjection } from '@/lib/supabase'
import { toCZK, fmtCZK, DEFAULT_FX, fetchFxRates } from '@/lib/fx'
import { useMarketData } from '@/hooks/useMarketData'
import { computeProjectedTotal } from '@/lib/projections'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

const CURRENT_YEAR = new Date().getFullYear()

// Sector mapping for known tickers
const SECTORS: Record<string, string> = {
  SPY5: 'ETF', SPYW: 'ETF',
  JPM: 'Financials', ERBAG: 'Financials', MONET: 'Financials', CSG1: 'Financials',
  KO: 'Consumer Staples', PEP: 'Consumer Staples', PG: 'Consumer Staples',
  MCD: 'Consumer Discretionary',
  T: 'Telecom', VZ: 'Telecom',
  AMZN: 'Technology', AAPL: 'Technology', SKLZ: 'Technology',
  O: 'Real Estate',
  RIO: 'Materials', ICL: 'Materials',
  OPEN: 'Real Estate', KPLT: 'Financials',
  PSNY: 'Industrials', BYND: 'Consumer Discretionary',
}

const SECTOR_COLORS: Record<string, string> = {
  'ETF':                  '#4a9448',
  'Financials':           '#185fa5',
  'Consumer Staples':     '#7a5810',
  'Consumer Discretionary': '#8a2b22',
  'Telecom':              '#2a7a7a',
  'Technology':           '#5a3a8a',
  'Real Estate':          '#8a6a2a',
  'Materials':            '#4a6a2a',
  'Industrials':          '#6a4a8a',
  'Other':                '#888c8e',
}

const CCY_COLORS: Record<string, string> = {
  USD: '#4a9448',
  EUR: '#185fa5',
  CZK: '#7a5810',
  GBP: '#8a2b22',
}

export default function AllocationPage() {
  const [holdings, setHoldings]       = useState<Holding[]>([])
  const [projections, setProjections] = useState<DividendProjection[]>([])
  const [fx, setFx]                   = useState(DEFAULT_FX)
  const [loading, setLoading]         = useState(true)
  const [fxLoading, setFxLoading]     = useState(false)
  const [fxTs, setFxTs]               = useState<string | null>(null)
  const [view, setView]               = useState<'value' | 'income'>('value')

  const market = useMarketData()

  const load = useCallback(async () => {
    const [h, p] = await Promise.all([
      supabase.from('holdings').select('*').order('symbol'),
      supabase.from('dividend_projections').select('*').eq('year', CURRENT_YEAR + 1),
    ])
    if (h.data) setHoldings(h.data)
    if (p.data) setProjections(p.data)
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

  // ── Compute per-holding values ──────────────────────────────────────────────
  const enriched = holdings.map(h => {
    const price      = market.getPrice(h.symbol, h.avg_price)
    const mktCZK     = toCZK(price * h.shares, h.currency, fx)
    const costCZK    = toCZK(h.avg_price * h.shares, h.currency, fx)
    const liveAnnual = market.getAnnualDiv(h.symbol)
    const proj       = projections.find(p => p.symbol === h.symbol)
    const annualDivCZK = liveAnnual != null
      ? toCZK(liveAnnual * h.shares, h.currency, fx)
      : proj ? toCZK(computeProjectedTotal(proj, holdings), proj.currency, fx) : 0
    const sector = SECTORS[h.symbol] ?? 'Other'
    return { h, mktCZK, costCZK, annualDivCZK, sector }
  })

  const totalMktCZK = enriched.reduce((s, r) => s + r.mktCZK, 0)
  const totalDivCZK = enriched.reduce((s, r) => s + r.annualDivCZK, 0)

  // ── Currency breakdown ──────────────────────────────────────────────────────
  const ccyMap: Record<string, { mktCZK: number; divCZK: number; count: number }> = {}
  enriched.forEach(({ h, mktCZK, annualDivCZK }) => {
    const c = h.currency
    if (!ccyMap[c]) ccyMap[c] = { mktCZK: 0, divCZK: 0, count: 0 }
    ccyMap[c].mktCZK   += mktCZK
    ccyMap[c].divCZK   += annualDivCZK
    ccyMap[c].count    += 1
  })

  const ccyData = Object.entries(ccyMap)
    .map(([ccy, d]) => ({
      name: ccy,
      value: view === 'value' ? d.mktCZK : d.divCZK,
      pct: view === 'value'
        ? totalMktCZK > 0 ? (d.mktCZK / totalMktCZK) * 100 : 0
        : totalDivCZK > 0 ? (d.divCZK / totalDivCZK) * 100 : 0,
      count: d.count,
      color: CCY_COLORS[ccy] ?? '#888',
    }))
    .sort((a, b) => b.value - a.value)

  // ── Sector breakdown ────────────────────────────────────────────────────────
  const sectorMap: Record<string, { mktCZK: number; divCZK: number; count: number }> = {}
  enriched.forEach(({ sector, mktCZK, annualDivCZK }) => {
    if (!sectorMap[sector]) sectorMap[sector] = { mktCZK: 0, divCZK: 0, count: 0 }
    sectorMap[sector].mktCZK   += mktCZK
    sectorMap[sector].divCZK   += annualDivCZK
    sectorMap[sector].count    += 1
  })

  const sectorData = Object.entries(sectorMap)
    .map(([sector, d]) => ({
      name: sector,
      value: view === 'value' ? d.mktCZK : d.divCZK,
      pct: view === 'value'
        ? totalMktCZK > 0 ? (d.mktCZK / totalMktCZK) * 100 : 0
        : totalDivCZK > 0 ? (d.divCZK / totalDivCZK) * 100 : 0,
      count: d.count,
      color: SECTOR_COLORS[sector] ?? '#888',
    }))
    .sort((a, b) => b.value - a.value)

  // ── Top holdings ────────────────────────────────────────────────────────────
  const topHoldings = [...enriched]
    .sort((a, b) => view === 'value'
      ? b.mktCZK - a.mktCZK
      : b.annualDivCZK - a.annualDivCZK
    )
    .slice(0, 10)

  // Concentration: HHI (Herfindahl–Hirschman Index)
  const hhi = enriched.reduce((s, r) => {
    const share = totalMktCZK > 0 ? r.mktCZK / totalMktCZK : 0
    return s + share * share
  }, 0)
  const hhiPct = (hhi * 100).toFixed(1)
  const concentration = hhi < 0.1 ? 'Well diversified' : hhi < 0.2 ? 'Moderate concentration' : 'High concentration'

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
        <div>{fmtCZK(d.value)} · {d.pct.toFixed(1)}%</div>
        <div style={{ color: 'var(--text3)', marginTop: 2 }}>{d.count} position{d.count > 1 ? 's' : ''}</div>
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
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 1160 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 26 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>Allocation</h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Portfolio composition by currency, sector & concentration
              {fxTs && <span style={{ color: 'var(--green)', marginLeft: 8 }}>· FX {fxTs}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* View toggle */}
            <div style={{ display: 'flex', border: '1px solid var(--border2)', borderRadius: 6, overflow: 'hidden' }}>
              {(['value', 'income'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12,
                  background: view === v ? 'var(--green-bg)' : 'var(--bg2)',
                  color: view === v ? 'var(--green)' : 'var(--text3)',
                  fontFamily: "'Geist', sans-serif",
                }}>
                  {v === 'value' ? 'By value' : 'By income'}
                </button>
              ))}
            </div>
            <button onClick={refreshFx} disabled={fxLoading} style={{
              padding: '7px 15px', borderRadius: 6, cursor: 'pointer',
              background: 'var(--bg2)', border: '1px solid var(--border2)',
              color: 'var(--text2)', fontFamily: "'Geist', sans-serif", fontSize: 12,
            }}>
              {fxLoading ? '⟳ FX…' : '↻ FX rates'}
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total value', value: fmtCZK(totalMktCZK), accent: 'var(--green)', note: `${holdings.length} positions` },
            { label: 'Est. annual income', value: fmtCZK(totalDivCZK), accent: 'var(--amber)', note: `${holdings.filter(h => h.is_dividend_payer).length} dividend payers` },
            { label: 'Currencies', value: String(Object.keys(ccyMap).length), accent: 'var(--blue)', note: ccyData.map(c => c.name).join(' · ') },
            { label: 'Concentration (HHI)', value: `${hhiPct}%`, accent: hhi < 0.1 ? 'var(--green)' : hhi < 0.2 ? 'var(--amber)' : 'var(--red)', note: concentration },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.8 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400, marginBottom: 4 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

          {/* Currency pie */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500, marginBottom: 4 }}>
              Currency exposure
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 14 }}>
              {view === 'value' ? 'By market value' : 'By estimated annual income'}
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={ccyData} dataKey="value" cx="50%" cy="50%" outerRadius={72} innerRadius={40} paddingAngle={2}>
                    {ccyData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {ccyData.map(c => (
                  <div key={c.name} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontWeight: 500 }}>{c.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{c.count} pos.</span>
                      </div>
                      <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--text2)' }}>
                        {c.pct.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${c.pct}%`, background: c.color, borderRadius: 2, transition: 'width 0.4s' }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{fmtCZK(c.value)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sector pie */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500, marginBottom: 4 }}>
              Sector allocation
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 14 }}>
              {view === 'value' ? 'By market value' : 'By estimated annual income'}
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={sectorData} dataKey="value" cx="50%" cy="50%" outerRadius={72} innerRadius={40} paddingAngle={2}>
                    {sectorData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {sectorData.map(s => (
                  <div key={s.name} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, fontWeight: 500 }}>{s.name}</span>
                      </div>
                      <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--text2)' }}>
                        {s.pct.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ height: 3, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${s.pct}%`, background: s.color, borderRadius: 2, transition: 'width 0.4s' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Top holdings table */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>
              Top 10 positions by {view === 'value' ? 'market value' : 'annual income'}
            </span>
            <Badge variant={view === 'value' ? 'green' : 'amber'}>{view === 'value' ? 'by value' : 'by income'}</Badge>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['#', 'Company', 'Sector', 'Currency', 'Mkt value (CZK)', '% of portfolio', 'Annual div (CZK)', '% of income'].map((h, i) => (
                  <th key={h} style={{
                    fontSize: 9, letterSpacing: '0.09em', textTransform: 'uppercase',
                    color: 'var(--text3)', padding: '8px 14px',
                    textAlign: i <= 1 ? 'left' : 'right',
                    borderBottom: '1px solid var(--border)', fontWeight: 400,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topHoldings.map(({ h, mktCZK, annualDivCZK, sector }, idx) => {
                const valuePct   = totalMktCZK > 0 ? (mktCZK / totalMktCZK) * 100 : 0
                const incomePct  = totalDivCZK > 0 ? (annualDivCZK / totalDivCZK) * 100 : 0
                const sectorColor = SECTOR_COLORS[sector] ?? '#888'
                return (
                  <tr key={h.id}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text3)', fontSize: 11 }}>
                      {idx + 1}
                    </td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 500 }}>{h.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{h.symbol}</div>
                    </td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: sectorColor + '18', color: sectorColor, border: `1px solid ${sectorColor}40` }}>
                        {sector}
                      </span>
                    </td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                      <Badge variant={h.currency === 'USD' ? 'gray' : h.currency === 'EUR' ? 'blue' : 'amber'}>{h.currency}</Badge>
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(mktCZK)}</td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                        <div style={{ width: 60, height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(valuePct, 100)}%`, background: 'var(--green-mid)', borderRadius: 2 }} />
                        </div>
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, minWidth: 36, textAlign: 'right' }}>
                          {valuePct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: annualDivCZK > 0 ? 'var(--amber)' : 'var(--text4)' }}>
                      {annualDivCZK > 0 ? `~${fmtCZK(annualDivCZK)}` : '—'}
                    </td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                      {annualDivCZK > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                          <div style={{ width: 60, height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(incomePct, 100)}%`, background: 'var(--amber)', borderRadius: 2 }} />
                          </div>
                          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, minWidth: 36, textAlign: 'right' }}>
                            {incomePct.toFixed(1)}%
                          </span>
                        </div>
                      ) : <span style={{ color: 'var(--text4)', fontSize: 12 }}>—</span>}
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

const tdR: React.CSSProperties = {
  padding: '9px 14px', borderBottom: '1px solid var(--border)',
  textAlign: 'right', color: 'var(--text2)', fontSize: 12,
}
