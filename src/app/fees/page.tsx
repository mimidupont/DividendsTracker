'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, Holding } from '@/lib/supabase'
import { toCZK, fmtCZK, DEFAULT_FX, fetchFxRates } from '@/lib/fx'
import { useMarketData } from '@/hooks/useMarketData'

// Known expense ratios for ETFs and funds (as decimals)
const EXPENSE_RATIOS: Record<string, { ter: number; label: string; type: 'etf' | 'stock' }> = {
  SPY5:  { ter: 0.0003, label: 'SPDR S&P 500 UCITS',        type: 'etf' },
  SPYW:  { ter: 0.0030, label: 'SPDR Euro Div Aristocrats',  type: 'etf' },
  // Stocks have no TER — just brokerage friction
  JPM:   { ter: 0,      label: 'Individual stock',           type: 'stock' },
  KO:    { ter: 0,      label: 'Individual stock',           type: 'stock' },
  T:     { ter: 0,      label: 'Individual stock',           type: 'stock' },
  MCD:   { ter: 0,      label: 'Individual stock',           type: 'stock' },
  AMZN:  { ter: 0,      label: 'Individual stock',           type: 'stock' },
  AAPL:  { ter: 0,      label: 'Individual stock',           type: 'stock' },
  RIO:   { ter: 0,      label: 'Individual stock',           type: 'stock' },
  VZ:    { ter: 0,      label: 'Individual stock',           type: 'stock' },
  O:     { ter: 0,      label: 'Individual stock',           type: 'stock' },
  PEP:   { ter: 0,      label: 'Individual stock',           type: 'stock' },
  PG:    { ter: 0,      label: 'Individual stock',           type: 'stock' },
  ICL:   { ter: 0,      label: 'Individual stock',           type: 'stock' },
  OPEN:  { ter: 0,      label: 'Individual stock',           type: 'stock' },
  KPLT:  { ter: 0,      label: 'Individual stock',           type: 'stock' },
  PSNY:  { ter: 0,      label: 'Individual stock',           type: 'stock' },
  BYND:  { ter: 0,      label: 'Individual stock',           type: 'stock' },
  SKLZ:  { ter: 0,      label: 'Individual stock',           type: 'stock' },
  CSG1:  { ter: 0,      label: 'Individual stock',           type: 'stock' },
  ERBAG: { ter: 0,      label: 'Individual stock',           type: 'stock' },
  MONET: { ter: 0,      label: 'Individual stock',           type: 'stock' },
}

// IBKR commission estimates per trade type
const IBKR_COMMISSION = {
  US_STOCK:  0.005,   // $0.005/share, min $1
  EU_STOCK:  0.0010,  // 0.10% of trade value
  CZK_STOCK: 0.0010,
}

// Assumed annual turnover rate for cost estimation
const ASSUMED_TURNOVER = 0.10 // 10% per year

export default function FeeScannerPage() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [fx, setFx]             = useState(DEFAULT_FX)
  const [loading, setLoading]   = useState(true)
  const [fxLoading, setFxLoading] = useState(false)
  const [fxTs, setFxTs]         = useState<string | null>(null)
  const [horizon, setHorizon]   = useState(10)    // years for drag calc
  const [growth, setGrowth]     = useState(7)     // % annual return assumption

  const market = useMarketData()

  const load = useCallback(async () => {
    const { data } = await supabase.from('holdings').select('*').order('symbol')
    if (data) setHoldings(data)
    setLoading(false)
    return data ?? []
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

  // ── Per-holding fee analysis ───────────────────────────────────────────────
  const rows = holdings.map(h => {
    const price   = market.getPrice(h.symbol, h.avg_price)
    const mktCZK  = toCZK(price * h.shares, h.currency, fx)
    const info    = EXPENSE_RATIOS[h.symbol]
    const ter     = info?.ter ?? 0
    const isEtf   = info?.type === 'etf'

    // Annual TER cost in CZK
    const annualTerCZK = mktCZK * ter

    // Estimated annual trading cost: turnover * commission rate * value
    let commRate = IBKR_COMMISSION.US_STOCK
    if (h.currency === 'EUR') commRate = IBKR_COMMISSION.EU_STOCK
    if (h.currency === 'CZK') commRate = IBKR_COMMISSION.CZK_STOCK
    const annualTradingCZK = mktCZK * ASSUMED_TURNOVER * commRate

    // Total annual fee CZK
    const totalAnnualCZK = annualTerCZK + annualTradingCZK

    // Fee drag over horizon: how much less you'd have vs. 0 fees
    // Value with fees: V * (1 + g - ter)^n vs V * (1+g)^n
    const growthRate = growth / 100
    const valueNow = mktCZK
    const valueWithFees = valueNow * Math.pow(1 + growthRate - ter, horizon)
    const valueNoFees   = valueNow * Math.pow(1 + growthRate, horizon)
    const feeDragCZK    = valueNoFees - valueWithFees

    // Effective cost ratio (all-in)
    const effectiveCostPct = mktCZK > 0 ? (totalAnnualCZK / mktCZK) * 100 : 0

    return {
      h, mktCZK, ter, isEtf, annualTerCZK, annualTradingCZK,
      totalAnnualCZK, feeDragCZK, effectiveCostPct,
    }
  })

  const totalValueCZK      = rows.reduce((s, r) => s + r.mktCZK, 0)
  const totalAnnualFeesCZK = rows.reduce((s, r) => s + r.totalAnnualCZK, 0)
  const totalFeeDragCZK    = rows.reduce((s, r) => s + r.feeDragCZK, 0)
  const wtdTer             = totalValueCZK > 0
    ? rows.reduce((s, r) => s + r.ter * r.mktCZK, 0) / totalValueCZK
    : 0
  const etfValue  = rows.filter(r => r.isEtf).reduce((s, r) => s + r.mktCZK, 0)
  const etfPct    = totalValueCZK > 0 ? (etfValue / totalValueCZK) * 100 : 0

  const sorted = [...rows].sort((a, b) => b.totalAnnualCZK - a.totalAnnualCZK)

  const feeRating = (pct: number) => {
    if (pct < 0.05) return { label: 'Excellent', variant: 'green' as const }
    if (pct < 0.15) return { label: 'Good',      variant: 'green' as const }
    if (pct < 0.30) return { label: 'Moderate',  variant: 'amber' as const }
    return { label: 'High',  variant: 'red' as const }
  }

  const portfolioRating = feeRating(totalValueCZK > 0 ? (totalAnnualFeesCZK / totalValueCZK) * 100 : 0)

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

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 26 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>Fee scanner</h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Expense ratios, brokerage costs &amp; long-run fee drag · IBKR account
              {fxTs && <span style={{ color: 'var(--green)', marginLeft: 8 }}>· FX {fxTs}</span>}
            </div>
          </div>
          <button onClick={refreshFx} disabled={fxLoading} style={{
            padding: '7px 15px', borderRadius: 6, cursor: 'pointer',
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            color: 'var(--text2)', fontFamily: "'Geist', sans-serif", fontSize: 12,
          }}>
            {fxLoading ? '⟳ FX…' : '↻ FX rates'}
          </button>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Est. annual fees', value: fmtCZK(totalAnnualFeesCZK, 0), accent: 'var(--amber)', note: `${((totalAnnualFeesCZK / totalValueCZK) * 100).toFixed(3)}% of portfolio` },
            { label: 'Weighted avg TER', value: `${(wtdTer * 100).toFixed(3)}%`, accent: wtdTer < 0.002 ? 'var(--green)' : 'var(--amber)', note: `ETFs are ${etfPct.toFixed(0)}% of portfolio` },
            { label: `Fee drag (${horizon}y)`, value: fmtCZK(totalFeeDragCZK, 0), accent: 'var(--red)', note: `vs. 0% cost at ${growth}% growth` },
            { label: 'Fee rating', value: portfolioRating.label, accent: portfolioRating.variant === 'green' ? 'var(--green)' : portfolioRating.variant === 'amber' ? 'var(--amber)' : 'var(--red)', note: 'Overall portfolio efficiency' },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.8 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400, marginBottom: 4 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        {/* Parameters */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500, marginBottom: 14 }}>
            Drag calculation assumptions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 600 }}>
            {[
              { label: 'Time horizon', value: horizon, setter: setHorizon, min: 1, max: 30, step: 1, unit: ' years' },
              { label: 'Annual return assumption', value: growth, setter: setGrowth, min: 1, max: 15, step: 0.5, unit: '%' },
            ].map(s => (
              <div key={s.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{s.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>{s.value}{s.unit}</span>
                </div>
                <input
                  type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                  onChange={e => s.setter(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--green)' }}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--blue-bg)', border: '1px solid var(--blue-bd)', borderRadius: 7, fontSize: 11, color: 'var(--blue)', maxWidth: 600 }}>
            ⓘ Fee drag = money lost over {horizon} years due to compounding at {growth}% minus fees, vs. {growth}% with no fees.
            Trading cost uses {(ASSUMED_TURNOVER * 100).toFixed(0)}% assumed annual turnover at IBKR rates.
          </div>
        </div>

        {/* Holdings fee table */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>Position fee breakdown</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <Badge variant="amber">{rows.filter(r => r.isEtf).length} ETFs with TER</Badge>
              <Badge variant="gray">{rows.filter(r => !r.isEtf).length} individual stocks</Badge>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Company', 'Type', 'Value (CZK)', 'TER', 'Annual TER cost', 'Trading est.', 'Total annual', 'Effective %', `${horizon}y drag`].map((h, i) => (
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
                {sorted.map(({ h, mktCZK, ter, isEtf, annualTerCZK, annualTradingCZK, totalAnnualCZK, feeDragCZK, effectiveCostPct }) => {
                  const rating = feeRating(effectiveCostPct)
                  return (
                    <tr key={h.id}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 500 }}>{h.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{h.symbol} · {h.currency}</div>
                      </td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                        <Badge variant={isEtf ? 'blue' : 'gray'}>{isEtf ? 'ETF/Fund' : 'Stock'}</Badge>
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(mktCZK)}</td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>
                        {isEtf
                          ? <span style={{ color: ter > 0.005 ? 'var(--red)' : ter > 0.002 ? 'var(--amber)' : 'var(--green)' }}>
                              {(ter * 100).toFixed(2)}%
                            </span>
                          : <span style={{ color: 'var(--text4)' }}>n/a</span>
                        }
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: annualTerCZK > 0 ? 'var(--red)' : 'var(--text4)' }}>
                        {annualTerCZK > 0.50 ? `−${fmtCZK(annualTerCZK, 0)}` : '—'}
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--text3)' }}>
                        ~{fmtCZK(annualTradingCZK, 0)}
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontWeight: 500 }}>
                        ~{fmtCZK(totalAnnualCZK, 0)}
                      </td>
                      <td style={{ ...tdR }}>
                        <Badge variant={rating.variant}>{effectiveCostPct.toFixed(3)}%</Badge>
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: feeDragCZK > 1000 ? 'var(--red)' : 'var(--text3)' }}>
                        {feeDragCZK > 100 ? `−${fmtCZK(feeDragCZK, 0)}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg3)' }}>
                  <td colSpan={2} style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontWeight: 600, fontSize: 12 }}>Total</td>
                  <td style={{ ...tdR, borderTop: '1px solid var(--border)', fontFamily: "'DM Mono', monospace', fontWeight: 600" }}>{fmtCZK(totalValueCZK)}</td>
                  <td style={{ ...tdR, borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{(wtdTer * 100).toFixed(3)}% wtd</span>
                  </td>
                  <td colSpan={2} style={{ borderTop: '1px solid var(--border)' }} />
                  <td style={{ ...tdR, borderTop: '1px solid var(--border)', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                    ~{fmtCZK(totalAnnualFeesCZK, 0)}
                  </td>
                  <td style={{ borderTop: '1px solid var(--border)' }} />
                  <td style={{ ...tdR, borderTop: '1px solid var(--border)', fontFamily: "'DM Mono', monospace", fontWeight: 600, color: 'var(--red)' }}>
                    −{fmtCZK(totalFeeDragCZK, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Efficiency tips */}
        <div style={{ marginTop: 14, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500, marginBottom: 12 }}>
            Fee efficiency notes
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              {
                icon: '✓',
                color: 'var(--green)',
                bg: 'var(--green-bg)',
                bd: 'var(--green-bd)',
                title: 'Low-cost ETFs',
                body: `SPY5 (0.03%) and SPYW (0.30%) are your only fund costs. ETFs represent ${etfPct.toFixed(0)}% of your portfolio — this keeps fund-level costs minimal.`,
              },
              {
                icon: '↓',
                color: 'var(--blue)',
                bg: 'var(--blue-bg)',
                bd: 'var(--blue-bd)',
                title: 'Reduce trading turnover',
                body: `At ${(ASSUMED_TURNOVER * 100).toFixed(0)}% assumed turnover, trading friction is your largest cost driver for individual stocks. Buy-and-hold reduces this to near zero.`,
              },
              {
                icon: '⚠',
                color: 'var(--amber)',
                bg: 'var(--amber-bg)',
                bd: 'var(--amber-bd)',
                title: 'Small positions cost more',
                body: `IBKR charges a minimum $1 per US trade regardless of size. Positions under ~$200 face disproportionately high effective commission rates.`,
              },
              {
                icon: 'ⓘ',
                color: 'var(--text2)',
                bg: 'var(--bg3)',
                bd: 'var(--border2)',
                title: 'Withholding tax is your real cost',
                body: `At 15% WHT on US dividends, tax drag far exceeds fund fees. Consider tax-efficient structures (e.g. Irish-domiciled UCITS ETFs) where possible.`,
              },
            ].map((tip, i) => (
              <div key={i} style={{ background: tip.bg, border: `1px solid ${tip.bd}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ color: tip.color, fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{tip.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: tip.color, marginBottom: 4 }}>{tip.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6 }}>{tip.body}</div>
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

const tdR: React.CSSProperties = {
  padding: '9px 14px', borderBottom: '1px solid var(--border)',
  textAlign: 'right', color: 'var(--text2)', fontSize: 12,
}
