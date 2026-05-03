'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import AddPositionModal from '@/components/AddPositionModal'
import LogDividendModal from '@/components/LogDividendModal'
import DripCheckModal from '@/components/DripCheckModal'
import { supabase, Holding, DividendReceived, DividendProjection } from '@/lib/supabase'
import { toCZK, fmtCZK, fmtDate, DEFAULT_FX, fetchFxRates } from '@/lib/fx'
import { useMarketData } from '@/hooks/useMarketData'

const CURRENT_YEAR = new Date().getFullYear()

export default function Dashboard() {
  const [holdings, setHoldings]       = useState<Holding[]>([])
  const [received, setReceived]       = useState<DividendReceived[]>([])
  const [projections, setProjections] = useState<DividendProjection[]>([])
  const [fx, setFx]                   = useState(DEFAULT_FX)
  const [loading, setLoading]         = useState(true)
  const [fxLoading, setFxLoading]     = useState(false)
  const [fxTs, setFxTs]               = useState<string | null>(null)

  const [showAdd, setShowAdd]   = useState(false)
  const [showLog, setShowLog]   = useState(false)
  const [showDrip, setShowDrip] = useState(false)

  const market = useMarketData()

  const load = useCallback(async () => {
    const [h, r, p] = await Promise.all([
      supabase.from('holdings').select('*').order('symbol'),
      supabase.from('dividends_received').select('*').order('payment_date', { ascending: false }),
      supabase.from('dividend_projections').select('*').eq('year', CURRENT_YEAR + 1).order('projected_total', { ascending: false }),
    ])
    if (h.data) setHoldings(h.data)
    if (r.data) setReceived(r.data)
    if (p.data) setProjections(p.data)
    setLoading(false)
    return h.data ?? []
  }, [])

  // Initial load then auto-fetch market data
  useEffect(() => {
    load().then(h => {
      if (h.length > 0) {
        market.refresh(h.map((hh: Holding) => hh.symbol))
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshAll = async () => {
    const h = await load()
    if (h.length > 0) {
      await market.refresh(h.map((hh: Holding) => hh.symbol))
    }
  }

  const refreshFx = async () => {
    setFxLoading(true)
    const rates = await fetchFxRates()
    setFx(rates)
    setFxTs(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    setFxLoading(false)
  }

  // ── Metrics ──────────────────────────────────────────────
  const totalValueCZK = holdings.reduce((sum, h) => {
    const price = market.getPrice(h.symbol, h.avg_price)
    return sum + toCZK(price * h.shares, h.currency, fx)
  }, 0)

  const totalCostCZK = holdings.reduce((sum, h) =>
    sum + toCZK(h.avg_price * h.shares, h.currency, fx), 0)

  const unrealizedPLCZK = totalValueCZK - totalCostCZK

  const ytdReceived = received.filter(d =>
    new Date(d.payment_date).getFullYear() === CURRENT_YEAR
  )
  const ytdGrossCZK = ytdReceived.reduce((sum, d) => sum + toCZK(d.gross_amount, d.currency, fx), 0)
  const ytdNetCZK   = ytdReceived.reduce((sum, d) => sum + toCZK(d.net_amount,   d.currency, fx), 0)

  // Use live annual div * shares for projected income when available, else fall back to DB projections
  const projGrossCZK = holdings.reduce((sum, h) => {
    const liveAnnual = market.getAnnualDiv(h.symbol)
    if (liveAnnual != null) {
      return sum + toCZK(liveAnnual * h.shares, h.currency, fx)
    }
    const proj = projections.find(p => p.symbol === h.symbol)
    return sum + toCZK(proj?.projected_total ?? 0, proj?.currency ?? h.currency, fx)
  }, 0)

  const portfolioYield     = totalValueCZK > 0 ? (projGrossCZK / totalValueCZK) * 100 : 0
  const portfolioYieldCost = totalCostCZK  > 0 ? (projGrossCZK / totalCostCZK)  * 100 : 0
  const divPayers = holdings.filter(h => h.is_dividend_payer).length

  const marketStatusColor = {
    idle: 'var(--text3)',
    loading: 'var(--amber)',
    done: 'var(--green)',
    error: 'var(--red)',
  }[market.state]

  const marketStatusText = {
    idle: '',
    loading: '⟳ Fetching live prices…',
    done: `✓ Prices live · ${market.fetchedAt ? new Date(market.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}`,
    error: `⚠ ${market.errorMsg ?? 'Price fetch failed'}`,
  }[market.state]

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
        Loading portfolio…
      </main>
    </div>
  )

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />

      {showAdd  && <AddPositionModal onClose={() => setShowAdd(false)}  onSaved={refreshAll} />}
      {showLog  && <LogDividendModal onClose={() => setShowLog(false)}  onSaved={load} />}
      {showDrip && <DripCheckModal  holdings={holdings} onClose={() => setShowDrip(false)} onSaved={load} />}

      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 1160 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 26 }}>
          <div>
            <h1 style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 27, fontWeight: 400, letterSpacing: -0.5, lineHeight: 1.1,
            }}>
              {greeting()}, <em style={{ color: 'var(--green)', fontStyle: 'italic' }}>Eliot</em>
            </h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              &nbsp;·&nbsp;All values in CZK
              {fxTs && <span style={{ color: 'var(--green)' }}>· FX {fxTs}</span>}
              {marketStatusText && (
                <span style={{ color: marketStatusColor }}>{marketStatusText}</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refreshFx} disabled={fxLoading} style={btnStyle('secondary')}>
              {fxLoading ? '⟳ FX…' : '↻ FX rates'}
            </button>
            <button
              onClick={() => market.refresh(holdings.map(h => h.symbol))}
              disabled={market.state === 'loading'}
              style={btnStyle('secondary')}
            >
              {market.state === 'loading' ? '⟳ Loading…' : '↻ Refresh prices'}
            </button>
            <button onClick={() => setShowAdd(true)}  style={btnStyle('secondary')}>+ Add position</button>
            <button onClick={() => setShowLog(true)}  style={btnStyle('secondary')}>+ Log dividend</button>
            <button onClick={() => setShowDrip(true)} style={btnStyle('primary')}>⟳ Check dividends</button>
          </div>
        </div>

        {/* Metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 12 }}>
          {[
            {
              label: 'Portfolio value',
              value: fmtCZK(totalValueCZK),
              sub: <Badge variant={unrealizedPLCZK >= 0 ? 'green' : 'red'}>
                {unrealizedPLCZK >= 0 ? '+' : ''}{fmtCZK(unrealizedPLCZK)} P&L
              </Badge>,
              accent: 'var(--green)',
            },
            {
              label: 'YTD dividends',
              value: fmtCZK(ytdGrossCZK, 2),
              sub: <Badge variant="green">{fmtCZK(ytdNetCZK, 2)} net</Badge>,
              accent: 'var(--green)',
            },
            {
              label: 'Est. annual income',
              value: fmtCZK(projGrossCZK),
              sub: <Badge variant="amber">{market.state === 'done' ? 'live data' : 'projected'}</Badge>,
              accent: 'var(--amber)',
            },
            {
              label: 'Portfolio yield',
              value: `${portfolioYield.toFixed(2)}%`,
              sub: <Badge variant="blue">on market value</Badge>,
              accent: 'var(--blue)',
            },
            {
              label: 'Yield on cost',
              value: `${portfolioYieldCost.toFixed(2)}%`,
              sub: <Badge variant="blue">on cost basis</Badge>,
              accent: 'var(--blue)',
            },
          ].map((m, i) => (
            <div key={i} style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 18px', position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.8 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 7, fontWeight: 500 }}>
                {m.label}
              </div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400, lineHeight: 1, marginBottom: 7 }}>
                {m.value}
              </div>
              {m.sub}
            </div>
          ))}
        </div>

        <HoldingsTable holdings={holdings} projections={projections} fx={fx} divPayers={divPayers} market={market} />
        <DividendLog received={received} fx={fx} ytdGrossCZK={ytdGrossCZK} />
      </main>
    </div>
  )
}

// ── Holdings Table ─────────────────────────────────────────────────────────────

function HoldingsTable({
  holdings, projections, fx, divPayers, market,
}: {
  holdings: Holding[]
  projections: DividendProjection[]
  fx: Record<string, number>
  divPayers: number
  market: ReturnType<typeof import('@/hooks/useMarketData').useMarketData>
}) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>Holdings</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Badge variant="green">{divPayers} dividend payers</Badge>
          <Badge variant="gray">{holdings.length - divPayers} non-div</Badge>
          {market.state === 'done' && <Badge variant="live">LIVE prices</Badge>}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Company', 'Shares', 'Avg price', 'Last price', 'Chg%', 'Mkt value (CZK)', 'Unr. P&L (CZK)', 'Div yield', 'Annual div (CZK)'].map((h, i) => (
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
            {holdings.map(h => {
              const price      = market.getPrice(h.symbol, h.avg_price)
              const mktCZK     = toCZK(price * h.shares, h.currency, fx)
              const costCZK    = toCZK(h.avg_price * h.shares, h.currency, fx)
              const plCZK      = mktCZK - costCZK
              const chgPct     = market.quotes[h.symbol]?.changePercent ?? null

              const liveYield  = market.getYield(h.symbol)
              const proj       = projections.find(p => p.symbol === h.symbol)
              const projYield  = proj?.projected_yield ?? null
              const displayY   = liveYield ?? projYield

              const liveAnnual = market.getAnnualDiv(h.symbol)
              const annualCZK  = liveAnnual != null
                ? toCZK(liveAnnual * h.shares, h.currency, fx)
                : proj ? toCZK(proj.projected_total ?? 0, proj.currency, fx) : null

              return (
                <tr key={h.id}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 500 }}>{h.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                      {h.symbol} · {h.exchange ?? '—'} · {h.currency}
                      {h.is_dividend_payer && <span style={{ marginLeft: 6, color: 'var(--green)' }}>●</span>}
                    </div>
                  </td>
                  <td style={tdR}>{h.shares.toFixed(4)}</td>
                  <td style={tdR}>
                    {h.avg_price.toLocaleString()}
                    <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 3 }}>{h.currency}</span>
                  </td>
                  <td style={tdR}>
                    {market.state === 'loading'
                      ? <span style={{ color: 'var(--text4)' }}>…</span>
                      : <>{price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 3 }}>{h.currency}</span></>
                    }
                  </td>
                  <td style={{ ...tdR, color: chgPct == null ? 'var(--text4)' : chgPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {chgPct != null ? `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%` : '—'}
                  </td>
                  <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{fmtCZK(mktCZK)}</td>
                  <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12, color: plCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {plCZK >= 0 ? '+' : ''}{fmtCZK(plCZK)}
                  </td>
                  <td style={tdR}>
                    {displayY != null ? (
                      <span style={{
                        color: displayY >= 0.04 ? 'var(--green)' : displayY >= 0.02 ? 'var(--amber)' : 'var(--text3)',
                        fontFamily: "'DM Mono', monospace", fontSize: 12,
                      }}>
                        {(displayY * 100).toFixed(2)}%
                        {liveYield != null && <span style={{ marginLeft: 4 }}><Badge variant="live">LIVE</Badge></span>}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text4)' }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12, color: annualCZK ? 'var(--green)' : 'var(--text4)' }}>
                    {annualCZK ? `~${fmtCZK(annualCZK)}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Dividend Log ───────────────────────────────────────────────────────────────

function DividendLog({ received, fx, ytdGrossCZK }: {
  received: DividendReceived[]
  fx: Record<string, number>
  ytdGrossCZK: number
}) {
  const [expanded, setExpanded] = useState(true)
  const recent = received.slice(0, 10)

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ padding: '12px 18px', borderBottom: expanded ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>Dividend log</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Badge variant="green">YTD: {fmtCZK(ytdGrossCZK, 2)}</Badge>
          <span style={{ color: 'var(--text3)', fontSize: 14 }}>{expanded ? '▴' : '▾'}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '4px 18px' }}>
          {received.length === 0 ? (
            <div style={{ padding: '18px 0', color: 'var(--text3)', fontSize: 12 }}>No dividends logged yet.</div>
          ) : recent.map(d => (
            <div key={d.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0', borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
              <div style={{ fontWeight: 500, minWidth: 44 }}>{d.symbol}</div>
              <div style={{ color: 'var(--text3)', fontSize: 11, flex: 1 }}>
                {fmtDate(d.payment_date)} · {d.amount_per_share} {d.currency}/share × {d.shares_held} shares
                {d.drip_shares_added ? <span style={{ color: 'var(--green)' }}> · DRIP +{d.drip_shares_added.toFixed(4)} shares</span> : null}
                {d.notes && !d.drip_shares_added && <span> · {d.notes}</span>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: 'var(--green)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                  +{fmtCZK(toCZK(d.gross_amount, d.currency, fx), 2)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                  WHT −{fmtCZK(toCZK(d.withholding_tax, d.currency, fx), 2)}
                  <span style={{ marginLeft: 6, opacity: 0.6 }}>({d.gross_amount.toFixed(2)} {d.currency})</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const tdR: React.CSSProperties = {
  padding: '9px 14px', borderBottom: '1px solid var(--border)',
  textAlign: 'right', color: 'var(--text2)',
}

function btnStyle(variant: 'primary' | 'secondary'): React.CSSProperties {
  if (variant === 'primary') return {
    padding: '7px 15px', borderRadius: 6, cursor: 'pointer',
    background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
    color: 'var(--green)', fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500,
  }
  return {
    padding: '7px 15px', borderRadius: 6, cursor: 'pointer',
    background: 'var(--bg2)', border: '1px solid var(--border2)',
    color: 'var(--text2)', fontFamily: "'Geist', sans-serif", fontSize: 12,
  }
}
