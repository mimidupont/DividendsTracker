'use client'
import { useState, useEffect, useMemo } from 'react'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel } from '@/components/PageShell'
import { RouteTabs, STOCK_TABS } from '@/components/Sidebar'
import Badge from '@/components/Badge'
import EditPositionModal from '@/components/EditPositionModal'
import RecordModal, { type RecordPreset } from '@/components/RecordModal'
import DripCheckModal from '@/components/DripCheckModal'
import MarketStatus from '@/components/MarketStatus'
import DataTable, { type Column } from '@/components/DataTable'
import { useUndoableDelete } from '@/components/UndoToast'
import type { Holding } from '@/lib/supabase'
import { fmtCZK, fmtSignedCZK, fmtNum, fmtPct, fmtShare } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import { positionsMetrics, portfolioTotals, holdingAssetClass, type PositionMetrics } from '@/lib/portfolio'
import { deleteScoped } from '@/lib/db'
import { btnStyle, actionBtn, signColor } from '@/lib/ui'

export default function HoldingsPage() {
  const { holdings, projections, assetMetadata, loading, reload, error } = useAppData()
  const { activeProfile } = useProfile()
  const [record, setRecord]     = useState<RecordPreset | null>(null)
  const [showDrip, setShowDrip] = useState(false)
  const [editHolding, setEditHolding] = useState<Holding | null>(null)
  const { schedule, pendingIds, toast } = useUndoableDelete()

  const { fx, fxLive, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const market = useMarketData()

  // Fetch prices from an effect, never during render.
  const symbolKey = holdings.map(h => h.symbol).join(',')
  useEffect(() => {
    if (symbolKey) market.refresh(symbolKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])

  const visible = holdings.filter(h => !pendingIds.has(h.id))
  const rows    = useMemo(() => positionsMetrics(visible, market, fx, projections), [visible, market, fx, projections])
  const totals  = portfolioTotals(rows)
  const divPayers = visible.filter(h => h.is_dividend_payer).length
  const metaBy = new Map(assetMetadata.map(m => [m.symbol.toUpperCase(), m]))

  const deleteHolding = (h: Holding) =>
    schedule(h.id, `${h.symbol}`, () => deleteScoped('holdings', h.id, activeProfile?.id), reload)

  if (loading) return <LoadingShell label="Loading holdings…" />

  const columns: Column<PositionMetrics>[] = [
    {
      key: 'name', label: 'Company', sortValue: r => r.holding.name,
      render: r => {
        const h = r.holding
        const cls = holdingAssetClass(metaBy.get(h.symbol.toUpperCase()))
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{h.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{h.symbol} · {h.exchange ?? '—'} · {h.currency}</span>
              {cls === 'etf' && <Badge variant="gray">ETF</Badge>}
              {cls === 'bond' && <Badge variant="gray">Bond ETF</Badge>}
              {h.is_dividend_payer && <span title="Pays dividends" style={{ color: 'var(--green)' }} aria-label="Pays dividends">●</span>}
            </div>
          </div>
        )
      },
    },
    { key: 'shares', label: 'Shares', numeric: true, sortValue: r => r.holding.shares, render: r => fmtNum(r.holding.shares, 4) },
    {
      key: 'avg', label: 'Avg price', numeric: true, sortValue: r => r.holding.avg_price,
      render: r => <>{fmtNum(r.holding.avg_price, 2)} <span style={{ fontSize: 10, color: 'var(--text3)' }}>{r.holding.currency}</span></>,
    },
    {
      key: 'last', label: 'Last price', numeric: true, sortValue: r => r.price,
      render: r => market.state === 'loading' && !r.isLivePrice ? <span style={{ color: 'var(--text3)' }}>…</span> : <>
        {fmtNum(r.price, 2)}
        <span style={{ fontSize: 10, color: 'var(--text3)' }}> {r.priceCurrency}</span>
        {!r.isLivePrice && <> <Badge variant="amber" style={{ marginLeft: 4 }}>at cost</Badge></>}
      </>,
    },
    {
      key: 'chg', label: 'Day', numeric: true, sortValue: r => r.changePercent,
      render: r => <span style={{ color: signColor(r.changePercent) }}>{fmtPct(r.changePercent)}</span>,
    },
    { key: 'mkt', label: 'Value (CZK)', numeric: true, sortValue: r => r.marketCZK, render: r => fmtCZK(r.marketCZK) },
    {
      key: 'pl', label: 'Unrealised P&L', numeric: true, sortValue: r => r.plCZK,
      render: r => (
        <span style={{ color: signColor(r.plCZK) }} title={r.costFxFrozen ? undefined : 'Purchase FX rate unknown — cost converted at today\'s rate, so the currency effect is not included'}>
          {fmtSignedCZK(r.plCZK)}
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>
            {fmtPct(r.plPct, 1)}
            {r.fxPLCZK != null && Math.abs(r.fxPLCZK) >= 1 && ` · FX ${fmtSignedCZK(r.fxPLCZK)}`}
            {!r.costFxFrozen && r.holding.currency.toUpperCase() !== 'CZK' && ' · FX ?'}
          </div>
        </span>
      ),
    },
    {
      key: 'yield', label: 'Yield', numeric: true, sortValue: r => r.divYield,
      render: r => r.divYield != null ? <>
        {fmtShare(r.divYield * 100, 2)}
        {!r.isLiveIncome && <span style={{ fontSize: 10, color: 'var(--text3)' }}> proj.</span>}
      </> : '—',
    },
    { key: 'income', label: 'Annual div (CZK)', numeric: true, sortValue: r => r.annualDivCZK, render: r => r.annualDivCZK ? fmtCZK(r.annualDivCZK) : '—' },
    {
      key: 'actions', label: '', align: 'center',
      render: r => {
        const h = r.holding
        return (
          <span style={{ whiteSpace: 'nowrap' }}>
            <button type="button" aria-label={`Buy more ${h.symbol}`} title="Buy more" onClick={() => setRecord({ kind: 'buy', asset: 'stock', symbol: h.symbol })} style={actionBtn}>+</button>
            <button type="button" aria-label={`Sell ${h.symbol}`} title="Sell" onClick={() => setRecord({ kind: 'sell', asset: 'stock', symbol: h.symbol })} style={{ ...actionBtn, marginLeft: 4 }}>−</button>
            <button type="button" aria-label={`Edit ${h.symbol}`} title="Correct position data" onClick={() => setEditHolding(h)} style={{ ...actionBtn, marginLeft: 4 }}>✎</button>
            <button type="button" aria-label={`Delete ${h.symbol}`} title="Delete (mistake) — to record a sale use −" onClick={() => deleteHolding(h)} style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}>✕</button>
          </span>
        )
      },
    },
  ]

  return (
    <PageShell>
      {record && <RecordModal preset={record} onClose={() => setRecord(null)} onSaved={reload} />}
      {showDrip && <DripCheckModal holdings={visible} metadata={assetMetadata} onClose={() => setShowDrip(false)} onSaved={reload} />}
      {editHolding && <EditPositionModal holding={editHolding} onClose={() => setEditHolding(null)} onSaved={reload} />}
      {toast}

      <PageHeader
        eyebrow="Stocks & ETFs"
        accent="var(--c-stocks)"
        title="Positions"
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {visible.length} positions · values in CZK
            {fxTs && <span>· FX {fxTs}</span>}
            {!fxLive && <span style={{ color: 'var(--amber)' }}>· FX fallback rates</span>}
            <MarketStatus state={market.state} fetchedAt={market.fetchedAt} errorMsg={market.errorMsg} />
          </span>
        }
        actions={<>
          <button type="button" onClick={refreshFx} disabled={fxLoading} style={btnStyle('secondary')}>{fxLoading ? '⟳ FX…' : '↻ FX'}</button>
          <button type="button" onClick={() => market.refresh(holdings.map(h => h.symbol), true)} disabled={market.state === 'loading'} style={btnStyle('secondary')}>
            {market.state === 'loading' ? '⟳ Loading…' : '↻ Prices'}
          </button>
          {divPayers > 0 && <button type="button" onClick={() => setShowDrip(true)} style={btnStyle('secondary')}>⟳ Check dividends</button>}
          <button type="button" onClick={() => setRecord({ kind: 'buy', asset: 'stock' })} style={btnStyle('primary')}>+ Buy</button>
        </>}
      />
      <RouteTabs tabs={STOCK_TABS} />

      {(error || totals.fxProblems.length > 0) && (
        <div role="alert" style={{
          background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)', color: 'var(--amber)',
          borderRadius: 8, padding: '9px 14px', marginBottom: 14, fontSize: 11, lineHeight: 1.6,
        }}>
          {error && <div>⚠ Some holdings could not be loaded: {error}</div>}
          {totals.fxProblems.length > 0 && <div>⚠ No FX rate for {totals.fxProblems.join(', ')} — those rows are not converted to CZK.</div>}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon="▤"
          title="No stock or ETF positions yet"
          body={<>Record your first purchase — with its real date, so the exchange rate you paid is kept and your
            P&amp;L includes the currency effect. Bond ETFs can be tagged as fixed income on the Risk page.</>}
          action={<button type="button" onClick={() => setRecord({ kind: 'buy', asset: 'stock' })} style={btnStyle('primary')}>+ Record a purchase</button>}
        />
      ) : <>
        <MarketStatusCards totals={totals} rowsLive={rows.some(r => r.isLiveIncome)} count={visible.length} />
        {totals.costFxUnknown.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.6 }}>
            ⓘ The purchase exchange rate is unknown for {totals.costFxUnknown.join(', ')} (“FX ?”) — their cost is converted at
            today&apos;s rate, so their P&amp;L leaves out what the currency did. Add the rate with ✎.
          </div>
        )}
        <Panel
          title="All positions"
          padded={false}
          right={<span style={{ display: 'flex', gap: 6 }}>
            <Badge variant="green">{divPayers} dividend payers</Badge>
            {totals.atCost.length > 0 && <Badge variant="amber">{totals.atCost.length} at cost</Badge>}
          </span>}
        >
          <DataTable
            caption="Stock and ETF positions"
            columns={columns}
            rows={rows}
            rowKey={r => r.holding.id}
            initialSort={{ key: 'mkt', dir: 'desc' }}
          />
        </Panel>
      </>}
    </PageShell>
  )
}

function MarketStatusCards({ totals, rowsLive, count }: {
  totals: ReturnType<typeof portfolioTotals>; rowsLive: boolean; count: number
}) {
  return (
    <MetricCards cards={[
      { label: 'Market value', value: fmtCZK(totals.marketCZK), accent: 'var(--c-stocks)',
        note: <span style={{ color: signColor(totals.plCZK) }}>{fmtSignedCZK(totals.plCZK)} unrealised ({fmtPct(totals.plPct, 1)})</span> },
      { label: 'Cost basis', value: fmtCZK(totals.costCZK), accent: 'var(--border3)',
        note: totals.fxPLCZK !== 0 ? <>currency effect {fmtSignedCZK(totals.fxPLCZK)}</> : `${count} positions` },
      { label: 'Est. annual dividends', value: fmtCZK(totals.annualDivCZK), accent: 'var(--c-income)',
        note: <>{rowsLive ? 'live rates' : 'projected'}, gross{totals.incomeUnknown.length > 0 ? ` · ${totals.incomeUnknown.length} unknown` : ''}</> },
      { label: 'Yield', value: totals.yieldPct != null ? fmtShare(totals.yieldPct, 2) : '—', accent: 'var(--c-income)', note: 'on market value' },
      { label: 'Yield on cost', value: totals.yieldOnCostPct != null ? fmtShare(totals.yieldOnCostPct, 2) : '—', accent: 'var(--c-income)', note: 'on cost basis' },
    ]} />
  )
}
