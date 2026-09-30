'use client'
import { useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useAppData } from '@/hooks/useAppData'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel } from '@/components/PageShell'
import Badge from '@/components/Badge'
import DataTable, { type Column } from '@/components/DataTable'
import { toCZK, fmtCZK, fmtNum, fmtShare } from '@/lib/fx'
import { computeProjectedTotal } from '@/lib/projections'
import { buildPositions, type Position } from '@/lib/portfolio'
import { ASSET_CLASS_LABELS, ASSET_CLASS_COLORS } from '@/lib/risk'
import { whtRateFor, CZ_INTEREST_TAX, CZ_COUPON_TAX } from '@/lib/tax'
import { tdR } from '@/lib/ui'

/**
 * Forecast income. The top section is the forward 12 months from what you
 * hold today, across every income stream; the lower one is the per-year
 * dividend projections you saved, recomputed against today's share counts.
 */
export default function ProjectedPage() {
  const app = useAppData()
  const { projections, holdings, assetMetadata, loading } = app
  const { fx, fxLive, fxTs } = useFx()
  const market = useMarketData()
  const crypto = useCryptoPrices()

  const symbolKey = holdings.map(h => h.symbol).join(',')
  useEffect(() => {
    if (symbolKey) market.refresh(symbolKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])
  const coinKey = app.cryptoHoldings.map(c => c.coin_id).join(',')
  useEffect(() => {
    if (coinKey) crypto.refresh(coinKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinKey])

  const positions = useMemo(() => buildPositions(app, fx, market, crypto), [app, fx, market, crypto])
  const metaBy = new Map(assetMetadata.map(m => [m.symbol.toUpperCase(), m]))

  /** Estimated tax on each stream: treaty WHT for dividends, 15 % CZ final tax on interest/coupons. */
  const taxRate = (p: Position): number => {
    if (p.assetClass === 'stock' || p.assetClass === 'etf' || (p.assetClass === 'bond' && p.isFund)) {
      return whtRateFor(metaBy.get(p.label.toUpperCase())).rate
    }
    if (p.assetClass === 'cash') return p.currency === 'CZK' ? CZ_INTEREST_TAX : 0
    if (p.assetClass === 'bond') return p.currency === 'CZK' ? CZ_COUPON_TAX : 0
    return 0
  }
  const incomeRows = positions
    .filter(p => p.annualIncomeCZK > 0)
    .map(p => ({ p, gross: p.annualIncomeCZK, net: p.annualIncomeCZK * (1 - taxRate(p)) }))
  const gross = incomeRows.reduce((s, r) => s + r.gross, 0)
  const net = incomeRows.reduce((s, r) => s + r.net, 0)

  const years = Array.from(new Set(projections.map(p => p.year))).sort((a, b) => a - b)

  if (loading) return <LoadingShell />

  const columns: Column<typeof incomeRows[number]>[] = [
    { key: 'name', label: 'Source', sortValue: r => r.p.label, render: r => <>
      <div style={{ fontWeight: 500 }}>{r.p.label}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.p.name}</div>
    </> },
    { key: 'class', label: 'Class', sortValue: r => r.p.assetClass, render: r => (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: ASSET_CLASS_COLORS[r.p.assetClass] }} />
        {ASSET_CLASS_LABELS[r.p.assetClass]}
      </span>
    ) },
    { key: 'yield', label: 'Yield', numeric: true, sortValue: r => r.p.valueCZK > 0 ? r.gross / r.p.valueCZK : null,
      render: r => r.p.valueCZK > 0 ? fmtShare((r.gross / r.p.valueCZK) * 100, 2) : '—' },
    { key: 'gross', label: 'Gross / year', numeric: true, sortValue: r => r.gross, render: r => fmtCZK(r.gross) },
    { key: 'tax', label: 'Est. tax', numeric: true, sortValue: r => taxRate(r.p), render: r => fmtShare(taxRate(r.p) * 100, 0) },
    { key: 'net', label: 'Net / year', numeric: true, sortValue: r => r.net, render: r => <strong>{fmtCZK(r.net)}</strong> },
  ]

  return (
    <PageShell>
      <PageHeader
        eyebrow="Income"
        title="Forecast"
        subtitle={<>Forward income from what you hold now{fxTs && <> · FX {fxTs}</>}
          {!fxLive && <span style={{ color: 'var(--amber)' }}> · fallback rates</span>}</>}
      />

      {incomeRows.length === 0 && years.length === 0 ? (
        <EmptyState
          icon="↗"
          title="No income to forecast yet"
          body={<>Dividends are forecast from live dividend data for the stocks you hold; interest from each account&apos;s
            rate; coupons from each bond&apos;s terms. Add positions on <Link href="/holdings">Stocks &amp; ETFs</Link>,{' '}
            <Link href="/cash">Cash</Link> or <Link href="/bonds">Bonds</Link>.</>}
        />
      ) : <>
        <MetricCards cards={[
          { label: 'Next 12 months, gross', value: fmtCZK(gross), accent: 'var(--c-income)', note: `${fmtCZK(gross / 12)} a month` },
          { label: 'After withholding (est.)', value: fmtCZK(net), accent: 'var(--green)', note: 'treaty WHT on dividends, 15 % on CZ interest & coupons' },
          { label: 'Sources', value: String(incomeRows.length), accent: 'var(--border3)' },
        ]} />
        <Panel title="Forward 12 months" padded={false}>
          <DataTable caption="Forward income by source" columns={columns} rows={incomeRows} rowKey={r => r.p.id}
            initialSort={{ key: 'gross', dir: 'desc' }} />
        </Panel>

        {years.length > 0 && (
          <>
            <h2 style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', margin: '22px 0 10px' }}>
              Saved dividend projections by year
            </h2>
            {years.map(year => {
              const rows = projections.filter(p => p.year === year)
                .map(p => ({ p, native: computeProjectedTotal(p, holdings), shares: holdings.find(h => h.symbol === p.symbol)?.shares ?? null }))
              const yearTotalCZK = rows.reduce((s, r) => s + toCZK(r.native, r.p.currency, fx), 0)
              return (
                <Panel key={year} title={String(year)} padded={false}
                  right={<Badge variant="gray">~{fmtCZK(yearTotalCZK)} gross</Badge>}>
                  <div className="table-wrap">
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Symbol', 'Div/share', 'Shares', 'Growth', 'Projected', 'CZK'].map((h, i) => (
                            <th key={h} scope="col" style={{
                              fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)',
                              padding: '8px 14px', textAlign: i === 0 ? 'left' : 'right', borderBottom: '1px solid var(--border)', fontWeight: 500,
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ p, native, shares }) => (
                          <tr key={p.id} style={shares == null ? { opacity: 0.6 } : undefined}>
                            <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500 }}>
                              {p.symbol}
                              {shares == null && <Badge variant="gray" style={{ marginLeft: 6 }}>not held — excluded</Badge>}
                            </td>
                            <td className="num" style={tdR}>{p.projected_div_per_share != null ? fmtNum(p.projected_div_per_share, 4) : '—'}</td>
                            <td className="num" style={tdR}>{shares != null ? fmtNum(shares, 4) : '—'}</td>
                            <td className="num" style={tdR}>{fmtShare(p.growth_rate * 100, 1)}</td>
                            <td className="num" style={tdR}>{native > 0 ? `${fmtNum(native, 2)} ${p.currency}` : '—'}</td>
                            <td className="num" style={tdR}>{native > 0 ? fmtCZK(toCZK(native, p.currency, fx)) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )
            })}
          </>
        )}
      </>}
    </PageShell>
  )
}
