'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import AddPositionModal from '@/components/AddPositionModal'
import EditPositionModal from '@/components/EditPositionModal'
import { supabase, Holding, DividendProjection } from '@/lib/supabase'

const PRICES: Record<string, number> = {
  AAPL: 251.40, AMZN: 206.99, BYND: 0.69, CSG1: 27.99,
  ERBAG: 2222, ICL: 5.17, JPM: 292.21, KO: 74.81,
  KPLT: 7.29, MCD: 308.54, MONET: 186.40, O: 60.58,
  OPEN: 5.17, PEP: 150.62, PG: 143.08, PSNY: 17.50,
  RIO: 86.71, SKLZ: 2.57, SPY5: 657.43, SPYW: 27.20,
  T: 28.93, VZ: 50.90,
}

// FX rates to CZK (base currency)
const FX_TO_CZK: Record<string, number> = { USD: 23.50, EUR: 25.60, CZK: 1 }
const toCZK = (amount: number, ccy: string) => amount * (FX_TO_CZK[ccy] ?? 23.50)
const fmtCZK = (n: number) => `Kč ${Math.round(n).toLocaleString('cs-CZ')}`

export default function HoldingsPage() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [projections, setProjections] = useState<DividendProjection[]>([])
  const [filter, setFilter] = useState<'all' | 'div' | 'nondiv'>('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editHolding, setEditHolding] = useState<Holding | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Live dividend yields fetched via AI
  const [liveYields, setLiveYields] = useState<Record<string, number | null>>({})
  const [yieldLoading, setYieldLoading] = useState(false)
  const [yieldError, setYieldError] = useState('')

  const load = useCallback(async () => {
    const [h, p] = await Promise.all([
      supabase.from('holdings').select('*').order('symbol'),
      supabase.from('dividend_projections').select('*').eq('year', 2027),
    ])
    if (h.data) setHoldings(h.data)
    if (p.data) setProjections(p.data)
  }, [])

  useEffect(() => { load() }, [load])

  // Fetch live dividend yields using Claude API with web search
  const fetchLiveYields = useCallback(async (symbols: string[]) => {
    const divSymbols = symbols.filter(s => {
      const h = holdings.find(h => h.symbol === s)
      return h?.is_dividend_payer
    })
    if (divSymbols.length === 0) return

    setYieldLoading(true)
    setYieldError('')
    try {
      const prompt = `For each of these stock tickers, find the current annual dividend yield percentage.
Tickers: ${divSymbols.join(', ')}

Return ONLY a JSON object with ticker symbols as keys and dividend yield as a number (e.g. 3.5 means 3.5%).
If a yield is not available or the stock doesn't pay dividends, use null.
Example: {"KO": 3.1, "T": 5.2, "AMZN": null}
Return ONLY the JSON, no other text.`

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = await response.json()
      // Find the final text response
      const textBlock = [...data.content].reverse().find((b: { type: string }) => b.type === 'text')
      if (textBlock?.text) {
        const clean = textBlock.text.replace(/```json|```/g, '').trim()
        const parsed = JSON.parse(clean)
        setLiveYields(parsed)
      }
    } catch (e) {
      console.error('Failed to fetch live yields', e)
      setYieldError('Could not fetch live yields')
    } finally {
      setYieldLoading(false)
    }
  }, [holdings])

  // Trigger yield fetch once holdings are loaded
  useEffect(() => {
    if (holdings.length > 0 && Object.keys(liveYields).length === 0) {
      fetchLiveYields(holdings.map(h => h.symbol))
    }
  }, [holdings, liveYields, fetchLiveYields])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this position? This cannot be undone.')) return
    setDeletingId(id)
    await supabase.from('holdings').delete().eq('id', id)
    setDeletingId(null)
    load()
  }

  const filtered = holdings.filter(h => {
    if (filter === 'div') return h.is_dividend_payer
    if (filter === 'nondiv') return !h.is_dividend_payer
    return true
  })

  const totalMktValueCZK = holdings.reduce((sum, h) => {
    const price = PRICES[h.symbol] ?? h.avg_price
    return sum + toCZK(price * h.shares, h.currency)
  }, 0)

  const totalCostCZK = holdings.reduce((sum, h) => sum + toCZK(h.avg_price * h.shares, h.currency), 0)
  const totalProjDivCZK = projections.reduce((sum, p) => sum + toCZK(p.projected_total ?? 0, p.currency), 0)

  const portfolioYield = totalMktValueCZK > 0 ? (totalProjDivCZK / totalMktValueCZK) * 100 : 0
  const portfolioYieldOnCost = totalCostCZK > 0 ? (totalProjDivCZK / totalCostCZK) * 100 : 0

  const iconBtn = (onClick: () => void, icon: string, color: string, title: string, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        color, fontSize: 14, padding: '3px 5px', borderRadius: 4,
        opacity: disabled ? 0.4 : 0.7, transition: 'opacity 0.15s',
        lineHeight: 1,
      }}
      onMouseEnter={e => { if (!disabled) (e.target as HTMLElement).style.opacity = '1' }}
      onMouseLeave={e => { if (!disabled) (e.target as HTMLElement).style.opacity = '0.7' }}
    >
      {icon}
    </button>
  )

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      {showAddModal && <AddPositionModal onClose={() => setShowAddModal(false)} onSaved={load} />}
      {editHolding && <EditPositionModal holding={editHolding} onClose={() => setEditHolding(null)} onSaved={load} />}
      <main style={{ marginLeft: 220, flex: 1, padding: '32px 36px', maxWidth: 1260 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 300, letterSpacing: -0.5 }}>Holdings</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              All values in CZK · {yieldLoading && <span style={{ color: 'var(--amber)' }}>⟳ Fetching live yields…</span>}
              {yieldError && <span style={{ color: 'var(--red)' }}>{yieldError}</span>}
              {!yieldLoading && !yieldError && Object.keys(liveYields).length > 0 && (
                <span style={{ color: 'var(--green)' }}>✓ Live yields loaded
                  <button
                    onClick={() => { setLiveYields({}); fetchLiveYields(holdings.map(h => h.symbol)) }}
                    style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 10, textDecoration: 'underline' }}
                  >
                    Refresh
                  </button>
                </span>
              )}
            </div>
          </div>
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

        {/* Portfolio summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Portfolio yield', value: `${portfolioYield.toFixed(2)}%`, sub: 'Annual div / market value', accent: 'var(--green)' },
            { label: 'Yield on cost', value: `${portfolioYieldOnCost.toFixed(2)}%`, sub: 'Annual div / cost basis', accent: 'var(--blue)' },
            { label: '2027 projected income', value: fmtCZK(totalProjDivCZK), sub: `on ${fmtCZK(totalMktValueCZK)} market value`, accent: 'var(--amber)' },
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
                {['Symbol', 'Name', 'Shares', 'Avg price', 'Last price', 'Mkt value (CZK)', 'Unr. P&L (CZK)', 'Div yield', 'CCY', 'Exchange', 'Type', ''].map((h, i) => (
                  <th key={i} style={{
                    fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: 'var(--text3)', padding: '10px 14px',
                    textAlign: i < 2 ? 'left' : i === 11 ? 'center' : 'right',
                    borderBottom: '1px solid var(--border)', fontWeight: 400,
                    background: 'var(--bg3)',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(h => {
                const price = PRICES[h.symbol] ?? h.avg_price
                const mktValNative = price * h.shares
                const costValNative = h.avg_price * h.shares
                const plNative = mktValNative - costValNative

                const mktValCZK = toCZK(mktValNative, h.currency)
                const costValCZK = toCZK(costValNative, h.currency)
                const plCZK = mktValCZK - costValCZK
                const plPct = (plNative / costValNative) * 100

                // Prefer live yield, fall back to projected
                const proj = projections.find(p => p.symbol === h.symbol)
                const liveYield = liveYields[h.symbol]
                const projYield = proj?.projected_div_per_share != null && price > 0
                  ? (proj.projected_div_per_share / price) * 100
                  : null

                const displayYield = liveYield !== undefined ? liveYield : projYield
                const isLive = liveYield !== undefined && liveYield !== null

                return (
                  <tr key={h.id} style={{ transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500, color: 'var(--text)' }}>{h.symbol}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', fontSize: 12 }}>{h.name}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{h.shares}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>
                      {h.avg_price.toLocaleString()} <span style={{ fontSize: 10, color: 'var(--text3)' }}>{h.currency}</span>
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text)' }}>
                      {price.toLocaleString()} <span style={{ fontSize: 10, color: 'var(--text3)' }}>{h.currency}</span>
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)', fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
                      {fmtCZK(mktValCZK)}
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: plCZK >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
                      {plCZK >= 0 ? '+' : ''}{fmtCZK(plCZK)} <span style={{ fontSize: 10, opacity: 0.7 }}>({plPct.toFixed(1)}%)</span>
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                      {displayYield != null ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{
                            color: displayYield >= 4 ? 'var(--green)' : displayYield >= 2 ? 'var(--amber)' : 'var(--text3)',
                            fontFamily: 'DM Mono, monospace', fontSize: 12,
                          }}>
                            {displayYield.toFixed(2)}%
                          </span>
                          {isLive && (
                            <span title="Live data" style={{ fontSize: 8, color: 'var(--green)', letterSpacing: '0.05em', background: 'var(--green-bg)', border: '1px solid var(--green-bd)', borderRadius: 3, padding: '0 3px' }}>LIVE</span>
                          )}
                        </span>
                      ) : yieldLoading ? (
                        <span style={{ color: 'var(--text3)', fontSize: 11 }}>…</span>
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
                    <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {iconBtn(() => setEditHolding(h), '✎', 'var(--blue)', 'Edit position')}
                      {iconBtn(
                        () => handleDelete(h.id),
                        deletingId === h.id ? '…' : '✕',
                        'var(--red)',
                        'Delete position',
                        deletingId === h.id
                      )}
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
