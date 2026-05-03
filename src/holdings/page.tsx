'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import AddPositionModal from '@/components/AddPositionModal'
import EditPositionModal from '@/components/EditPositionModal'
import AddLotModal from '@/components/AddLotModal'
import { supabase, Holding, DividendProjection } from '@/lib/supabase'
import { toCZK, fmtCZK, DEFAULT_FX } from '@/lib/fx'
import { getPrice } from '@/lib/prices'

type Filter = 'all' | 'div' | 'nondiv'

export default function HoldingsPage() {
  const [holdings, setHoldings]     = useState<Holding[]>([])
  const [projections, setProjections] = useState<DividendProjection[]>([])
  const [filter, setFilter]         = useState<Filter>('all')
  const [showAdd, setShowAdd]       = useState(false)
  const [editH, setEditH]           = useState<Holding | null>(null)
  const [addLotH, setAddLotH]       = useState<Holding | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [liveYields, setLiveYields] = useState<Record<string, number | null>>({})
  const [yieldState, setYieldState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const fx = DEFAULT_FX

  const load = useCallback(async () => {
    const [h, p] = await Promise.all([
      supabase.from('holdings').select('*').order('symbol'),
      supabase.from('dividend_projections').select('*').eq('year', new Date().getFullYear() + 1),
    ])
    if (h.data) setHoldings(h.data)
    if (p.data) setProjections(p.data)
  }, [])

  useEffect(() => { load() }, [load])

  const fetchLiveYields = useCallback(async () => {
    const divSymbols = holdings.filter(h => h.is_dividend_payer).map(h => h.symbol)
    if (divSymbols.length === 0) return
    setYieldState('loading')
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: `For each ticker, find the current annual dividend yield percentage. Tickers: ${divSymbols.join(', ')}. Return ONLY a JSON object, e.g. {"KO":3.1,"T":5.2}. Use null if unavailable.` }],
        }),
      })
      const data = await res.json()
      const textBlock = [...data.content].reverse().find((b: { type: string }) => b.type === 'text')
      if (textBlock?.text) {
        const parsed = JSON.parse(textBlock.text.replace(/```json|```/g, '').trim())
        setLiveYields(parsed)
        setYieldState('done')
      }
    } catch {
      setYieldState('error')
    }
  }, [holdings])

  useEffect(() => {
    if (holdings.length > 0 && yieldState === 'idle') fetchLiveYields()
  }, [holdings, yieldState, fetchLiveYields])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this position? This cannot be undone.')) return
    setDeletingId(id)
    await supabase.from('holdings').delete().eq('id', id)
    setDeletingId(null)
    load()
  }

  const filtered = holdings.filter(h =>
    filter === 'div' ? h.is_dividend_payer :
    filter === 'nondiv' ? !h.is_dividend_payer : true
  )

  const totalMktCZK  = holdings.reduce((s, h) => s + toCZK(getPrice(h.symbol, h.avg_price) * h.shares, h.currency, fx), 0)
  const totalCostCZK = holdings.reduce((s, h) => s + toCZK(h.avg_price * h.shares, h.currency, fx), 0)
  const totalProjCZK = projections.reduce((s, p) => s + toCZK(p.projected_total ?? 0, p.currency, fx), 0)
  const portYield    = totalMktCZK > 0 ? (totalProjCZK / totalMktCZK) * 100 : 0
  const yieldOnCost  = totalCostCZK > 0 ? (totalProjCZK / totalCostCZK) * 100 : 0

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      {showAdd   && <AddPositionModal onClose={() => setShowAdd(false)} onSaved={load} />}
      {editH     && <EditPositionModal holding={editH} onClose={() => setEditH(null)} onSaved={load} />}
      {addLotH   && <AddLotModal holding={addLotH} onClose={() => setAddLotH(null)} onSaved={load} />}

      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 1300 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>
              Holdings
            </h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
              {holdings.length} positions · All values in CZK
              {yieldState === 'loading' && <span style={{ color: 'var(--amber)', marginLeft: 8 }}>⟳ Fetching live yields…</span>}
              {yieldState === 'done'    && (
                <span style={{ color: 'var(--green)', marginLeft: 8 }}>
                  ✓ Live yields loaded
                  <button
                    onClick={() => { setLiveYields({}); setYieldState('idle') }}
                    style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 10, textDecoration: 'underline' }}
                  >
                    Refresh
                  </button>
                </span>
              )}
              {yieldState === 'error' && <span style={{ color: 'var(--red)', marginLeft: 8 }}>Could not fetch yields</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 3, background: 'var(--bg3)', padding: '3px', borderRadius: 8 }}>
              {(['all', 'div', 'nondiv'] as Filter[]).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  fontFamily: "'Geist', sans-serif",
                  background: filter === f ? 'var(--bg2)' : 'transparent',
                  color: filter === f ? 'var(--text)' : 'var(--text3)',
                  border: filter === f ? '1px solid var(--border)' : '1px solid transparent',
                }}>
                  {f === 'all' ? 'All' : f === 'div' ? 'Dividend payers' : 'Non-dividend'}
                </button>
              ))}
            </div>
            <button onClick={() => setShowAdd(true)} style={{
              padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
              background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
              color: 'var(--green)', fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500,
            }}>
              + Add position
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Portfolio yield', value: `${portYield.toFixed(2)}%`, sub: 'Annual div / market value', accent: 'var(--green)' },
            { label: 'Yield on cost',   value: `${yieldOnCost.toFixed(2)}%`, sub: 'Annual div / cost basis', accent: 'var(--blue)' },
            { label: 'Projected income', value: fmtCZK(totalProjCZK), sub: `on ${fmtCZK(totalMktCZK)} market value`, accent: 'var(--amber)' },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.8 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400, lineHeight: 1, marginBottom: 4 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                {['Company', 'Shares', 'Avg price', 'Last price', 'Mkt value (CZK)', 'Unr. P&L (CZK)', 'Div yield', 'Est. annual (CZK)', 'CCY', ''].map((h, i) => (
                  <th key={i} style={{
                    fontSize: 9, letterSpacing: '0.09em', textTransform: 'uppercase',
                    color: 'var(--text3)', padding: '9px 13px',
                    textAlign: i === 0 ? 'left' : i === 9 ? 'center' : 'right',
                    borderBottom: '1px solid var(--border)', fontWeight: 400,
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(h => {
                const price     = getPrice(h.symbol, h.avg_price)
                const mktCZK    = toCZK(price * h.shares, h.currency, fx)
                const costCZK   = toCZK(h.avg_price * h.shares, h.currency, fx)
                const plCZK     = mktCZK - costCZK
                const plPct     = ((price - h.avg_price) / h.avg_price) * 100
                const proj      = projections.find(p => p.symbol === h.symbol)
                const annualCZK = proj ? toCZK(proj.projected_total ?? 0, proj.currency, fx) : null
                const liveY     = liveYields[h.symbol]
                const projY     = proj?.projected_yield ? proj.projected_yield * 100 : null
                const displayY  = liveY !== undefined ? liveY : projY

                return (
                  <tr key={h.id}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '9px 13px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontWeight: 500 }}>{h.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                        {h.symbol}
                        {h.exchange && ` · ${h.exchange}`}
                        {h.is_dividend_payer && <span style={{ marginLeft: 5, color: 'var(--green)' }}>●</span>}
                      </div>
                    </td>
                    <td style={tdR}>{h.shares.toFixed(4)}</td>
                    <td style={tdR}>{h.avg_price.toLocaleString()}</td>
                    <td style={tdR}>{price.toLocaleString()}</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{fmtCZK(mktCZK)}</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12, color: plCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {plCZK >= 0 ? '+' : ''}{fmtCZK(plCZK)}
                      <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>({plPct.toFixed(1)}%)</span>
                    </td>
                    <td style={tdR}>
                      {displayY != null ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{
                            color: displayY >= 4 ? 'var(--green)' : displayY >= 2 ? 'var(--amber)' : 'var(--text3)',
                            fontFamily: "'DM Mono', monospace", fontSize: 12,
                          }}>
                            {displayY.toFixed(2)}%
                          </span>
                          {liveY !== undefined && liveY !== null && (
                            <Badge variant="live">LIVE</Badge>
                          )}
                        </span>
                      ) : yieldState === 'loading' ? (
                        <span style={{ color: 'var(--text4)', fontSize: 11 }}>…</span>
                      ) : (
                        <span style={{ color: 'var(--text4)' }}>—</span>
                      )}
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12, color: annualCZK ? 'var(--green)' : 'var(--text4)' }}>
                      {annualCZK ? `~${fmtCZK(annualCZK)}` : '—'}
                    </td>
                    <td style={tdR}>
                      <Badge variant={h.currency === 'USD' ? 'gray' : h.currency === 'EUR' ? 'blue' : 'amber'}>
                        {h.currency}
                      </Badge>
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setEditH(h)} style={iconBtn} title="Edit position">✎</button>
                      <button onClick={() => setAddLotH(h)} style={{ ...iconBtn, color: 'var(--blue)' }} title="Add lot">+</button>
                      <button
                        onClick={() => handleDelete(h.id)}
                        disabled={deletingId === h.id}
                        style={{ ...iconBtn, color: 'var(--red)', opacity: deletingId === h.id ? 0.4 : 0.65 }}
                        title="Delete position"
                      >
                        {deletingId === h.id ? '…' : '✕'}
                      </button>
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
  padding: '9px 13px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'right',
  color: 'var(--text2)',
  fontSize: 12,
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text3)', fontSize: 14, padding: '2px 5px',
  borderRadius: 4, opacity: 0.65,
  lineHeight: 1, transition: 'opacity 0.12s',
}
