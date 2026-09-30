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
import { deleteScoped, updateScoped } from '@/lib/db'
import { fetchHistoricalFx, normalizeCurrencyCode } from '@/lib/fx'
import { purchaseFxPlan, datesNeeded, SKIP_LABEL } from '@/lib/purchasefx'

type RowFilter = 'all' | 'at-cost' | 'fx-unknown'
const FILTERS: { key: RowFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'at-cost', label: 'No live price' }, { key: 'fx-unknown', label: 'No purchase FX' },
]
import { btnStyle, actionBtn, signColor } from '@/lib/ui'

export default function HoldingsPage() {
  const { holdings, holdingLots, projections, assetMetadata, loading, reload, error } = useAppData()
  const { activeProfile } = useProfile()
  const [record, setRecord]     = useState<RecordPreset | null>(null)
  const [showDrip, setShowDrip] = useState(false)
  const [editHolding, setEditHolding] = useState<Holding | null>(null)
  const { schedule, pendingIds, toast } = useUndoableDelete()
  const [filter, setFilter] = useState<RowFilter>('all')
  const [filling, setFilling] = useState(false)
  const [fillNotice, setFillNotice] = useState<string | null>(null)

  // Dashboard alerts link here with ?filter=… so only the rows to fix show.
  // Read once from the URL (useSearchParams would force a Suspense boundary).
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('filter')
    if (f === 'at-cost' || f === 'fx-unknown') setFilter(f)
  }, [])

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
  const costFxMissing = (r: PositionMetrics) =>
    !r.costFxFrozen && r.holding.currency.toUpperCase() !== 'CZK' && r.holding.avg_price * r.holding.shares > 0
  const shownRows = filter === 'at-cost'
    ? rows.filter(r => !r.isLivePrice && !r.isManualPrice)
    : filter === 'fx-unknown' ? rows.filter(costFxMissing) : rows

  /**
   * Fill the purchase rate of every position that lacks one from the ECB rate
   * on its purchase (and lot) dates, cost-weighted. 1 January dates are
   * treated as placeholders and skipped rather than guessed.
   */
  const fillPurchaseFx = async () => {
    if (!activeProfile) return
    setFilling(true)
    setFillNotice(null)
    try {
      const tables: Record<string, Record<string, number> | null> = {}
      const dates = datesNeeded(visible, holdingLots)
      for (let i = 0; i < dates.length; i += 6) {
        await Promise.all(dates.slice(i, i + 6).map(async d => { tables[d] = (await fetchHistoricalFx(d))?.rates ?? null }))
      }
      const plan = purchaseFxPlan({
        holdings: visible, lots: holdingLots,
        // Only the day's actual ECB rate — never fxRate()'s built-in fallback,
        // which would be stored permanently as if it were the rate paid.
        rateOn: (ccy, d) => tables[d]?.[normalizeCurrencyCode(ccy)] ?? null,
      })
      const failures: string[] = []
      let filled = 0
      for (const l of plan.lots) {
        const { error: e } = await updateScoped('holding_lots', l.id, activeProfile.id, { fx_rate_czk: l.fx })
        if (e) failures.push(`lot: ${e}`)
      }
      for (const h of plan.holdings) {
        const { error: e } = await updateScoped('holdings', h.id, activeProfile.id, { avg_fx_czk: h.avgFx, updated_at: new Date().toISOString() })
        if (e) failures.push(`${h.symbol}: ${e}`); else filled++
      }
      const skipped = plan.skipped.map(sk => `${sk.symbol} (${SKIP_LABEL[sk.reason]})`)
      setFillNotice(
        `Filled ${filled} position${filled === 1 ? '' : 's'}.` +
        (skipped.length ? ` Not filled: ${skipped.join('; ')}.` : '') +
        (failures.length ? ` Errors: ${failures.join('; ')}` : ''))
      reload()
    } finally {
      setFilling(false)
    }
  }

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
        {r.isManualPrice
          ? <> <span title={`Entered by hand${r.holding.manual_price_date ? ` on ${r.holding.manual_price_date}` : ''} — no quote source has this ticker`}><Badge variant="gray" style={{ marginLeft: 4 }}>manual</Badge></span></>
          : !r.isLivePrice && <> <Badge variant="amber" style={{ marginLeft: 4 }}>at cost</Badge></>}
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
        <span style={{ color: signColor(r.plCZK) }} title={costFxMissing(r) ? 'Purchase FX rate unknown — cost converted at today\'s rate, so the currency effect is not included' : undefined}>
          {fmtSignedCZK(r.plCZK)}
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>
            {fmtPct(r.plPct, 1)}
            {r.fxPLCZK != null && Math.abs(r.fxPLCZK) >= 1 && ` · FX ${fmtSignedCZK(r.fxPLCZK)}`}
            {costFxMissing(r) && ' · FX ?'}
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
            P&amp;L includes the currency effect. Bond ETFs can be tagged as fixed income on the Allocation page.</>}
          action={<button type="button" onClick={() => setRecord({ kind: 'buy', asset: 'stock' })} style={btnStyle('primary')}>+ Record a purchase</button>}
        />
      ) : <>
        <MarketStatusCards totals={totals} rowsLive={rows.some(r => r.isLiveIncome)} count={visible.length} />
        {totals.atCost.length > 0 && (
          <div id="at-cost" style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, lineHeight: 1.6 }}>
            ⚠ No live price for {Array.from(new Set(totals.atCost)).join(', ')} — valued at cost, and today&apos;s history point
            is held back until every position is priced. With ✎, check the exchange (it decides which listing is quoted), or
            enter a manual price for a delisted ticker.
          </div>
        )}
        {(totals.costFxUnknown.length > 0 || fillNotice) && (
          <div id="fx" style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.6 }}>
            {totals.costFxUnknown.length > 0 && <>
              ⓘ The purchase exchange rate is unknown for {totals.costFxUnknown.join(', ')} (“FX ?”) — their cost is converted at
              today&apos;s rate, so their P&amp;L leaves out what the currency did.{' '}
              <button type="button" onClick={fillPurchaseFx} disabled={filling} style={{
                background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', padding: 0, fontSize: 11, textDecoration: 'underline',
              }}>{filling ? 'Filling…' : 'Fill from ECB rates on the purchase dates'}</button>
              {' '}or add a rate with ✎.
            </>}
            {fillNotice && <div role="status" style={{ marginTop: 4, color: 'var(--text2)' }}>{fillNotice}</div>}
          </div>
        )}
        <Panel
          title="All positions"
          padded={false}
          right={<span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span role="group" aria-label="Show" style={{ display: 'flex', gap: 4 }}>
              {FILTERS.map(f => (
                <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} style={{
                  ...btnStyle(filter === f.key ? 'primary' : 'secondary'), padding: '2px 8px', fontSize: 10,
                }}>{f.label}</button>
              ))}
            </span>
            <Badge variant="green">{divPayers} dividend payers</Badge>
            {totals.atCost.length > 0 && <Badge variant="amber">{totals.atCost.length} at cost</Badge>}
          </span>}
        >
          <DataTable
            caption="Stock and ETF positions"
            columns={columns}
            rows={shownRows}
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
