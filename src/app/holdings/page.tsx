'use client'
import { useState, useCallback, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import AddPositionModal from '@/components/AddPositionModal'
import EditPositionModal from '@/components/EditPositionModal'
import AddLotModal from '@/components/AddLotModal'
import LogDividendModal from '@/components/LogDividendModal'
import DripCheckModal from '@/components/DripCheckModal'
import MarketStatus from '@/components/MarketStatus'
import { supabase, Holding } from '@/lib/supabase'
import { fmtCZK } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useAppData } from '@/hooks/useAppData'
import { positionsMetrics, portfolioTotals } from '@/lib/portfolio'
import { tdR, btnStyle, actionBtn } from '@/lib/ui'

export default function HoldingsPage() {
  const { holdings, projections, loading, reload, error } = useAppData()
  const [showAdd, setShowAdd]   = useState(false)
  const [showLog, setShowLog]   = useState(false)
  const [showDrip, setShowDrip] = useState(false)
  const [editHolding, setEditHolding] = useState<Holding | null>(null)
  const [lotHolding, setLotHolding]   = useState<Holding | null>(null)

  const { fx, fxLive, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const market = useMarketData()

  // Fetch prices from an effect, never during render: calling refresh() inline
  // mutated shared state mid-render, which React may run twice or discard.
  const symbolKey = holdings.map(h => h.symbol).join(',')
  useEffect(() => {
    if (symbolKey) market.refresh(symbolKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])

  const refreshAll = useCallback(async () => {
    await reload()
  }, [reload])

  const deleteHolding = async (h: Holding) => {
    if (!confirm(`Delete ${h.symbol} — ${h.name}? This cannot be undone.`)) return
    const { error: delErr } = await supabase.from('holdings').delete().eq('id', h.id)
    if (delErr) { alert(`Could not delete ${h.symbol}: ${delErr.message}`); return }
    reload()
  }

  const rows    = positionsMetrics(holdings, market, fx, projections)
  const totals  = portfolioTotals(rows)
  const unrealizedPLCZK = totals.plCZK
  const divPayers = holdings.filter(h => h.is_dividend_payer).length

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>Loading holdings…</main>
    </div>
  )

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      {showAdd      && <AddPositionModal onClose={() => setShowAdd(false)}      onSaved={refreshAll} />}
      {showLog      && <LogDividendModal onClose={() => setShowLog(false)}      onSaved={reload} />}
      {showDrip     && <DripCheckModal   holdings={holdings} onClose={() => setShowDrip(false)} onSaved={reload} />}
      {editHolding  && <EditPositionModal holding={editHolding}  onClose={() => setEditHolding(null)} onSaved={refreshAll} />}
      {lotHolding   && <AddLotModal       holding={lotHolding}   onClose={() => setLotHolding(null)}  onSaved={refreshAll} />}

      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 1200 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 26 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>Holdings</h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
              {holdings.length} positions · All values in CZK
              {fxTs && <span style={{ color: 'var(--green)' }}>· FX {fxTs}</span>}
              {!fxLive && <span style={{ color: 'var(--amber)' }}>· FX fallback rates</span>}
              <MarketStatus state={market.state} fetchedAt={market.fetchedAt} errorMsg={market.errorMsg} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refreshFx} disabled={fxLoading} style={btnStyle('secondary')}>{fxLoading ? '⟳ FX…' : '↻ FX rates'}</button>
            <button onClick={() => market.refresh(holdings.map(h => h.symbol), true)} disabled={market.state === 'loading'} style={btnStyle('secondary')}>
              {market.state === 'loading' ? '⟳ Loading…' : '↻ Refresh prices'}
            </button>
            <button onClick={() => setShowAdd(true)}  style={btnStyle('secondary')}>+ Add position</button>
            <button onClick={() => setShowLog(true)}  style={btnStyle('secondary')}>+ Log dividend</button>
            <button onClick={() => setShowDrip(true)} style={btnStyle('primary')}>⟳ Check dividends</button>
          </div>
        </div>

        {(error || totals.fxProblems.length > 0) && (
          <div style={{
            background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)',
            color: 'var(--amber)', borderRadius: 8, padding: '9px 14px',
            marginBottom: 14, fontSize: 11, lineHeight: 1.6,
          }}>
            {error && <div>⚠ Some holdings could not be loaded: {error}</div>}
            {totals.fxProblems.length > 0 && (
              <div>⚠ No FX rate for {totals.fxProblems.join(', ')} — those rows are not converted to CZK.</div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
          {[
            { label: 'Portfolio value',    value: fmtCZK(totals.marketCZK),            sub: <Badge variant={unrealizedPLCZK >= 0 ? 'green' : 'red'}>{unrealizedPLCZK >= 0 ? '+' : ''}{fmtCZK(unrealizedPLCZK)} P&L</Badge>, accent: 'var(--green)' },
            { label: 'Total cost basis',   value: fmtCZK(totals.costCZK),              sub: <Badge variant="gray">{holdings.length} positions</Badge>, accent: 'var(--blue)' },
            { label: 'Est. annual income', value: fmtCZK(totals.annualDivCZK),         sub: <Badge variant="amber">{rows.some(r => r.isLiveIncome) ? 'live data' : 'projected'}</Badge>, accent: 'var(--amber)' },
            { label: 'Portfolio yield',    value: `${totals.yieldPct.toFixed(2)}%`,     sub: <Badge variant="blue">on market value</Badge>, accent: 'var(--blue)' },
            { label: 'Yield on cost',      value: `${totals.yieldOnCostPct.toFixed(2)}%`, sub: <Badge variant="blue">on cost basis</Badge>, accent: 'var(--blue)' },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.8 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 7, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400, lineHeight: 1, marginBottom: 7 }}>{m.value}</div>
              {m.sub}
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500 }}>All positions</span>
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
                  {['Company', 'Shares', 'Avg price', 'Last price', 'Chg%', 'Mkt value (CZK)', 'Unr. P&L (CZK)', 'Div yield', 'Annual div (CZK)', ''].map((h, i) => (
                    <th key={i} style={{ fontSize: 9, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', padding: '8px 14px', textAlign: i === 0 ? 'left' : i === 9 ? 'center' : 'right', borderBottom: '1px solid var(--border)', fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const { holding: h, price, priceCurrency, isLivePrice,
                          marketCZK: mktCZK, plCZK, changePercent: chgPct,
                          annualDivCZK: annualCZK, divYield: displayY,
                          isLiveIncome } = row

                  return (
                    <tr key={h.id} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 500 }}>{h.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                          {h.symbol} · {h.exchange ?? '—'} · {h.currency}
                          {h.is_dividend_payer && <span style={{ marginLeft: 6, color: 'var(--green)' }}>●</span>}
                        </div>
                      </td>
                      <td style={tdR}>{h.shares.toFixed(4)}</td>
                      <td style={tdR}>{h.avg_price.toLocaleString()} <span style={{ fontSize: 10, color: 'var(--text3)' }}>{h.currency}</span></td>
                      <td style={tdR}>
                        {market.state === 'loading' ? <span style={{ color: 'var(--text4)' }}>…</span>
                          : <>
                              {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              {/* The quote's own currency, which is not always the one the position is booked in */}
                              <span style={{ fontSize: 10, color: 'var(--text3)' }}> {priceCurrency}</span>
                              {!isLivePrice && <span style={{ fontSize: 9, color: 'var(--text4)' }} title="No live quote — showing average cost"> at cost</span>}
                            </>}
                      </td>
                      <td style={{ ...tdR, color: chgPct == null ? 'var(--text4)' : chgPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {chgPct != null ? `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%` : '—'}
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(mktCZK)}</td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: plCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {plCZK >= 0 ? '+' : ''}{fmtCZK(plCZK)}
                      </td>
                      <td style={tdR}>
                        {displayY != null ? (
                          <span style={{ color: displayY >= 0.04 ? 'var(--green)' : displayY >= 0.02 ? 'var(--amber)' : 'var(--text3)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                            {(displayY * 100).toFixed(2)}%
                            {isLiveIncome && <span style={{ marginLeft: 4 }}><Badge variant="live">LIVE</Badge></span>}
                          </span>
                        ) : <span style={{ color: 'var(--text4)' }}>—</span>}
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: annualCZK ? 'var(--green)' : 'var(--text4)' }}>
                        {annualCZK ? `~${fmtCZK(annualCZK)}` : '—'}
                      </td>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button title="Add lot"        onClick={() => setLotHolding(h)}  style={actionBtn}>+</button>
                        <button title="Edit position"  onClick={() => setEditHolding(h)} style={{ ...actionBtn, marginLeft: 4 }}>✎</button>
                        <button title="Delete position" onClick={() => deleteHolding(h)} style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}>✕</button>
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
