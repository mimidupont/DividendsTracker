'use client'
import { useAppData } from '@/hooks/useAppData'
import { useFx } from '@/hooks/useFx'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { toCZK, fmtCZK } from '@/lib/fx'
import { computeProjectedTotal } from '@/lib/projections'
import { tdR } from '@/lib/ui'

/**
 * Withholding tax assumed on gross dividends when showing a net figure.
 * 15% is the Czech rate and the treaty rate on US dividends with a W-8BEN on
 * file; other domiciles differ, so the net column is explicitly an estimate.
 */
const ASSUMED_WHT = 0.15

export default function ProjectedPage() {
  const { projections, holdings, loading } = useAppData()
  const { fx, fxLive, fxTs } = useFx()

  const years = Array.from(new Set(projections.map(p => p.year))).sort((a, b) => a - b)

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>Loading…</main>
    </div>
  )

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 1060 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>
            Dividend projections
          </h1>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
            Estimated future income, recalculated against your current share counts
            {fxTs && <span style={{ color: 'var(--green)', marginLeft: 8 }}>· FX {fxTs}</span>}
            {!fxLive && <span style={{ color: 'var(--amber)', marginLeft: 8 }}>· fallback rates</span>}
          </div>
        </div>

        {years.length === 0 && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
            No projections saved yet.
          </div>
        )}

        {years.map(year => {
          const rows = projections.filter(p => p.year === year)

          // Projected totals are recomputed from div/share × the shares you
          // hold now. The stored projected_total was frozen at whatever share
          // count existed when the row was written, so it went stale on every
          // buy, sale and DRIP.
          const withTotals = rows.map(p => ({
            p,
            native: computeProjectedTotal(p, holdings),
          }))
          const yearTotalCZK = withTotals.reduce(
            (s, { p, native }) => s + toCZK(native, p.currency, fx), 0)
          const yearNetCZK = yearTotalCZK * (1 - ASSUMED_WHT)

          return (
            <div key={year} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 18 }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
                <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 17, fontWeight: 400, fontStyle: 'italic', color: 'var(--text2)' }}>
                  {year}
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge variant="amber">~{fmtCZK(yearTotalCZK)} gross</Badge>
                  <Badge variant="green">~{fmtCZK(yearNetCZK)} net</Badge>
                  <span style={{ fontSize: 9, color: 'var(--text4)' }}>
                    net assumes {(ASSUMED_WHT * 100).toFixed(0)}% WHT
                  </span>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Symbol', 'Div/share', 'Shares', 'Yield', 'Growth', 'Projected total', 'CZK equiv.', 'CCY'].map((h, i) => (
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
                  {withTotals.map(({ p, native }) => {
                    const shares = holdings.find(h => h.symbol === p.symbol)?.shares ?? null
                    return (
                      <tr key={p.id}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500 }}>
                          {p.symbol}
                          {shares === null && (
                            <span style={{ fontSize: 9, color: 'var(--text4)', marginLeft: 6 }} title="No matching holding — using the stored total">
                              not held
                            </span>
                          )}
                        </td>
                        <td style={tdR}>{p.projected_div_per_share ?? '—'}</td>
                        <td style={tdR}>{shares !== null ? shares.toFixed(4) : '—'}</td>
                        <td style={tdR}>{p.projected_yield ? `${(p.projected_yield * 100).toFixed(1)}%` : '—'}</td>
                        <td style={tdR}>{(p.growth_rate * 100).toFixed(1)}%</td>
                        <td style={{ ...tdR, color: 'var(--green)' }}>
                          ~{native.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--green)' }}>
                          ~{fmtCZK(toCZK(native, p.currency, fx))}
                        </td>
                        <td style={tdR}>
                          <Badge variant={p.currency === 'USD' ? 'gray' : p.currency === 'EUR' ? 'blue' : 'amber'}>
                            {p.currency}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </main>
    </div>
  )
}
