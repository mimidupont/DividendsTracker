'use client'
import { useAppData } from '@/hooks/useAppData'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, Holding, DividendProjection } from '@/lib/supabase'
import { toCZK, fmtCZK } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { computeProjectedTotal } from '@/lib/projections'

const CURRENT_YEAR = new Date().getFullYear()

const CCY_COLORS: Record<string, string> = {
  USD: '#4a9448', EUR: '#185fa5', CZK: '#7a5810', GBP: '#8a2b22',
}

export default function CurrencyPage() {
  const { holdings, projections, loading } = useAppData()
  const { fx, fxTs, fxLoading, refresh: refreshFx } = useFx()
  const market = useMarketData()

  if (holdings.length > 0 && market.state === 'idle') {
    market.refresh(holdings.map(h => h.symbol))
  }

  // Per-holding metrics
  const enriched = holdings.map(h => {
    const mktCZK    = toCZK(market.getPrice(h.symbol, h.avg_price) * h.shares, h.currency, fx)
    const liveAnnual = market.getAnnualDiv(h.symbol)
    const proj      = projections.find(p => p.symbol === h.symbol)
    const divCZK    = liveAnnual != null
      ? toCZK(liveAnnual * h.shares, h.currency, fx)
      : proj ? toCZK(computeProjectedTotal(proj, holdings), proj.currency, fx) : 0
    return { h, mktCZK, divCZK }
  })

  const totalMktCZK = enriched.reduce((s, r) => s + r.mktCZK, 0)
  const totalDivCZK = enriched.reduce((s, r) => s + r.divCZK, 0)

  // Group by currency
  const ccyMap: Record<string, { mktCZK: number; divCZK: number; holdings: typeof enriched }> = {}
  for (const r of enriched) {
    const c = r.h.currency
    if (!ccyMap[c]) ccyMap[c] = { mktCZK: 0, divCZK: 0, holdings: [] }
    ccyMap[c].mktCZK += r.mktCZK
    ccyMap[c].divCZK += r.divCZK
    ccyMap[c].holdings.push(r)
  }

  const ccyList = Object.entries(ccyMap)
    .map(([ccy, d]) => ({ ccy, ...d, valuePct: totalMktCZK > 0 ? (d.mktCZK / totalMktCZK) * 100 : 0, divPct: totalDivCZK > 0 ? (d.divCZK / totalDivCZK) * 100 : 0 }))
    .sort((a, b) => b.mktCZK - a.mktCZK)

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>Loading…</main>
    </div>
  )

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 26 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>Currency mix</h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Portfolio exposure by currency · All values in CZK
              {fxTs && <span style={{ color: 'var(--green)', marginLeft: 8 }}>· FX {fxTs}</span>}
            </div>
          </div>
          <button onClick={refreshFx} disabled={fxLoading} style={{ padding: '7px 15px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: "'Geist', sans-serif", fontSize: 12 }}>
            {fxLoading ? '⟳ FX…' : '↻ FX rates'}
          </button>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total value', value: fmtCZK(totalMktCZK), accent: 'var(--green)', note: `${holdings.length} positions` },
            { label: 'Est. annual income', value: fmtCZK(totalDivCZK), accent: 'var(--amber)', note: `${holdings.filter(h => h.is_dividend_payer).length} dividend payers` },
            { label: 'Currencies', value: String(ccyList.length), accent: 'var(--blue)', note: ccyList.map(c => c.ccy).join(' · ') },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.8 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400, marginBottom: 4 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        {/* Currency breakdown */}
        {ccyList.map(({ ccy, mktCZK, divCZK, valuePct, divPct, holdings: ccyHoldings }) => {
          const color = CCY_COLORS[ccy] ?? '#888'
          return (
            <div key={ccy} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{ccy}</span>
                  <Badge variant={ccy === 'USD' ? 'gray' : ccy === 'EUR' ? 'blue' : 'amber'}>{ccyHoldings.length} positions</Badge>
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                  <span>Value: <strong style={{ color: 'var(--green)' }}>{fmtCZK(mktCZK)}</strong> <span style={{ color: 'var(--text3)' }}>({valuePct.toFixed(1)}%)</span></span>
                  {divCZK > 0 && <span>Income: <strong style={{ color: 'var(--amber)' }}>{fmtCZK(divCZK)}</strong> <span style={{ color: 'var(--text3)' }}>({divPct.toFixed(1)}%)</span></span>}
                </div>
              </div>
              {/* Bar */}
              <div style={{ padding: '10px 18px 4px' }}>
                <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
                  <div style={{ height: '100%', width: `${valuePct}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
                </div>
              </div>
              {/* Holdings list */}
              <div style={{ padding: '0 18px 12px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ccyHoldings.sort((a, b) => b.mktCZK - a.mktCZK).map(({ h, mktCZK: hMkt }) => (
                  <div key={h.symbol} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontSize: 11 }}>
                    <span style={{ fontWeight: 600 }}>{h.symbol}</span>
                    <span style={{ color: 'var(--text3)', marginLeft: 8 }}>{fmtCZK(hMkt)}</span>
                    <span style={{ color: 'var(--text4)', marginLeft: 4 }}>({totalMktCZK > 0 ? ((hMkt / totalMktCZK) * 100).toFixed(1) : 0}%)</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </main>
    </div>
  )
}
