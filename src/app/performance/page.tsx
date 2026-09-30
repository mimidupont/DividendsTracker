'use client'
import { useEffect, useMemo } from 'react'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel } from '@/components/PageShell'
import { RouteTabs, STOCK_TABS } from '@/components/Sidebar'
import Badge from '@/components/Badge'
import MarketStatus from '@/components/MarketStatus'
import DataTable, { type Column } from '@/components/DataTable'
import { fmtCZK, fmtSignedCZK, fmtNum, fmtPct, fmtAxisCZK } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { btnStyle, signColor } from '@/lib/ui'
import { useAppData } from '@/hooks/useAppData'
import { positionsMetrics, portfolioTotals, type PositionMetrics } from '@/lib/portfolio'
import { paymentCZK } from '@/lib/dividends'
import { summarise } from '@/lib/transactions'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'

type Row = PositionMetrics & { divIncome: number; totalReturn: number; totalReturnPct: number | null }

export default function PerformancePage() {
  const { holdings, projections, dividendsReceived, transactions, loading, error } = useAppData()
  const { fx, fxLive, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const market = useMarketData()

  const symbolKey = holdings.map(h => h.symbol).join(',')
  useEffect(() => {
    if (symbolKey) market.refresh(symbolKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])

  // Dividends count net of withholding (the withheld part never arrived), at
  // the payment-date rate when it was recorded.
  const divCZK = useMemo(
    () => dividendsReceived.map(d => ({ d, ...paymentCZK(d, fx, 'net') })),
    [dividendsReceived, fx]
  )
  const anyUnfrozen = divCZK.some(x => !x.frozen)

  const rows: Row[] = positionsMetrics(holdings, market, fx, projections).map(m => {
    const divIncome = divCZK.filter(x => x.d.symbol === m.holding.symbol).reduce((s, x) => s + x.czk, 0)
    const totalReturn = m.plCZK + divIncome
    return { ...m, divIncome, totalReturn, totalReturnPct: m.costCZK > 0 ? (totalReturn / m.costCZK) * 100 : null }
  })

  const totals = portfolioTotals(rows)
  const heldSymbols = new Set(holdings.map(h => h.symbol))
  const divOnHeld = divCZK.filter(x => heldSymbols.has(x.d.symbol)).reduce((s, x) => s + x.czk, 0)
  const divAll = divCZK.reduce((s, x) => s + x.czk, 0)
  // Realised P&L from the ledger (FIFO, each leg at its own rate). Counting
  // dividends from positions already sold without their realised gain or loss
  // overstated total return whenever the sale was at a loss.
  const realised = useMemo(() => summarise(transactions.filter(t => t.asset_class === 'stock')).realizedPLCZK, [transactions])
  const hasLedger = transactions.some(t => t.type === 'sell' && t.asset_class === 'stock')
  const totalReturnCZK = totals.plCZK + realised + divAll
  const winners = rows.filter(r => r.plCZK > 0).length
  const losers  = rows.filter(r => r.plCZK < 0).length

  // Monthly net dividends, last 12 months
  const monthly: Record<string, number> = {}
  for (const x of divCZK) {
    const key = x.d.payment_date.slice(0, 7)
    monthly[key] = (monthly[key] ?? 0) + x.czk
  }
  const monthlyChart = Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, amount]) => {
      const [y, m] = month.split('-').map(Number)
      return { month: new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), amount: Math.round(amount) }
    })

  const plChartData = [...rows]
    .sort((a, b) => b.plCZK - a.plCZK)
    .slice(0, 12)
    .map(r => ({ symbol: r.holding.symbol, pl: Math.round(r.plCZK) }))

  if (loading) return <LoadingShell />

  const columns: Column<Row>[] = [
    { key: 'name', label: 'Company', sortValue: r => r.holding.name, render: r => <>
      <div style={{ fontWeight: 500 }}>{r.holding.name}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.holding.symbol} · {r.holding.currency}</div>
    </> },
    { key: 'shares', label: 'Shares', numeric: true, sortValue: r => r.holding.shares, render: r => fmtNum(r.holding.shares, 4) },
    { key: 'avg', label: 'Avg cost', numeric: true, sortValue: r => r.holding.avg_price,
      render: r => <>{fmtNum(r.holding.avg_price, 2)} <span style={{ fontSize: 10, color: 'var(--text3)' }}>{r.holding.currency}</span></> },
    { key: 'last', label: 'Last price', numeric: true, sortValue: r => r.price,
      render: r => <>{fmtNum(r.price, 2)} <span style={{ fontSize: 10, color: 'var(--text3)' }}>{r.priceCurrency}</span>
        {r.isManualPrice ? <> <Badge variant="gray">manual</Badge></> : !r.isLivePrice && <> <Badge variant="amber">at cost</Badge></>}</> },
    { key: 'value', label: 'Value (CZK)', numeric: true, sortValue: r => r.marketCZK, render: r => fmtCZK(r.marketCZK) },
    { key: 'pl', label: 'Unrealised', numeric: true, sortValue: r => r.plCZK,
      render: r => <span style={{ color: signColor(r.plCZK) }}>{fmtSignedCZK(r.plCZK)}</span> },
    { key: 'plpct', label: 'P&L %', numeric: true, sortValue: r => r.plPct,
      render: r => <span style={{ color: signColor(r.plPct) }}>{fmtPct(r.plPct)}</span> },
    { key: 'fx', label: 'of which FX', numeric: true, sortValue: r => r.fxPLCZK,
      render: r => r.fxPLCZK == null ? <span title="Purchase rate unknown">—</span> : <span style={{ color: signColor(r.fxPLCZK) }}>{fmtSignedCZK(r.fxPLCZK)}</span> },
    { key: 'div', label: 'Dividends (net)', numeric: true, sortValue: r => r.divIncome, render: r => r.divIncome > 0 ? fmtCZK(r.divIncome) : '—' },
    { key: 'tr', label: 'Total return', numeric: true, sortValue: r => r.totalReturn, render: r => (
      <span style={{ color: signColor(r.totalReturn), fontWeight: 500 }}>
        {fmtSignedCZK(r.totalReturn)}
        <div style={{ fontSize: 10 }}>{fmtPct(r.totalReturnPct, 1)}</div>
      </span>
    ) },
  ]

  return (
    <PageShell>
      <PageHeader
        eyebrow="Stocks & ETFs"
        accent="var(--c-stocks)"
        title="Performance"
        subtitle={<span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
          {holdings.length} positions · values in CZK
          {fxTs && <span>· FX {fxTs}</span>}
          {!fxLive && <span style={{ color: 'var(--amber)' }}>· FX fallback rates</span>}
          <MarketStatus state={market.state} fetchedAt={market.fetchedAt} errorMsg={market.errorMsg} />
          {error && <span style={{ color: 'var(--amber)' }}>⚠ {error}</span>}
        </span>}
        actions={<>
          <button type="button" onClick={refreshFx} disabled={fxLoading} style={btnStyle('secondary')}>{fxLoading ? '⟳ FX…' : '↻ FX'}</button>
          <button type="button" onClick={() => market.refresh(holdings.map(h => h.symbol), true)} disabled={market.state === 'loading'} style={btnStyle('secondary')}>
            {market.state === 'loading' ? '⟳ Loading…' : '↻ Prices'}
          </button>
        </>}
      />
      <RouteTabs tabs={STOCK_TABS} />

      {holdings.length === 0 && dividendsReceived.length === 0 ? (
        <EmptyState icon="◉" title="No positions to measure yet" body="Record a purchase on Positions; performance, dividends and total return appear here." />
      ) : <>
        <MetricCards cards={[
          { label: 'Unrealised P&L', value: fmtSignedCZK(totals.plCZK), color: signColor(totals.plCZK), accent: signColor(totals.plCZK),
            note: <>{fmtPct(totals.plPct)} on cost{totals.fxPLCZK !== 0 && <> · FX {fmtSignedCZK(totals.fxPLCZK)}</>}</> },
          { label: 'Realised P&L', value: hasLedger ? fmtSignedCZK(realised) : '—', color: signColor(hasLedger ? realised : null), accent: 'var(--border3)',
            note: hasLedger ? 'from recorded sales (FIFO)' : 'no sales recorded' },
          { label: 'Dividends received', value: fmtCZK(divAll), accent: 'var(--c-income)',
            note: <>net of withholding · {dividendsReceived.length} payments{divAll !== divOnHeld && <> · {fmtCZK(divAll - divOnHeld)} from sold positions</>}</> },
          { label: 'Total return', value: fmtSignedCZK(totalReturnCZK), color: signColor(totalReturnCZK), accent: signColor(totalReturnCZK),
            note: 'unrealised + realised + dividends' },
          { label: 'Winners / losers', value: `${winners} / ${losers}`, accent: 'var(--border3)', note: `${rows.filter(r => r.plCZK === 0).length} flat` },
        ]} />
        {anyUnfrozen && (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
            ⓘ Some older dividends have no recorded payment-date rate and are converted at today&apos;s rate.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
          <Panel title="Unrealised P&L by position (top 12)">
            <div role="img" aria-label={`Unrealised P&L by position: ${plChartData.map(d => `${d.symbol} ${fmtSignedCZK(d.pl)}`).join(', ')}`}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={plChartData} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="symbol" tick={{ fontSize: 11, fill: 'var(--text3)' }} />
                  <YAxis tickFormatter={fmtAxisCZK} tick={{ fontSize: 11, fill: 'var(--text3)' }} width={72} />
                  <Tooltip formatter={(v: number) => [fmtSignedCZK(v), 'P&L']} />
                  <ReferenceLine y={0} stroke="var(--text3)" label={{ value: '0', position: 'left', fontSize: 10, fill: 'var(--text3)' }} />
                  <Bar dataKey="pl" name="P&L" radius={[3, 3, 0, 0]}>
                    {plChartData.map((e, i) => <Cell key={i} fill={e.pl >= 0 ? 'var(--green)' : 'var(--red)'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Dividends received, net (last 12 months)">
            {monthlyChart.length === 0 ? (
              <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 12 }}>
                No dividends logged yet
              </div>
            ) : (
              <div role="img" aria-label="Net dividends per month">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyChart} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text3)' }} />
                    <YAxis tickFormatter={fmtAxisCZK} tick={{ fontSize: 11, fill: 'var(--text3)' }} width={72} />
                    <Tooltip formatter={(v: number) => [fmtCZK(v), 'Net dividends']} />
                    <Bar dataKey="amount" name="Net dividends" fill="var(--c-income)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Position performance" padded={false}>
          <DataTable caption="Position performance" columns={columns} rows={rows} rowKey={r => r.holding.id}
            initialSort={{ key: 'pl', dir: 'desc' }} />
        </Panel>
      </>}
    </PageShell>
  )
}
