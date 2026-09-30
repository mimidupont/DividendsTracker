'use client'
import { useEffect, useState } from 'react'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel } from '@/components/PageShell'
import { RouteTabs, STOCK_TABS } from '@/components/Sidebar'
import Badge from '@/components/Badge'
import DataTable, { type Column } from '@/components/DataTable'
import { fmtCZK, fmtShare } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'
import { useAppData } from '@/hooks/useAppData'
import { useMarketData } from '@/hooks/useMarketData'
import { positionsMetrics, holdingAssetClass } from '@/lib/portfolio'
import { btnStyle, tdR } from '@/lib/ui'
import type { Holding } from '@/lib/supabase'

/**
 * Known total expense ratios for funds (decimal). Individual stocks have none;
 * a fund missing from this list is flagged rather than silently scored 0 %.
 */
const EXPENSE_RATIOS: Record<string, { ter: number; label: string }> = {
  SPY5: { ter: 0.0003, label: 'SPDR S&P 500 UCITS' },
  SPYW: { ter: 0.0030, label: 'SPDR Euro Dividend Aristocrats' },
  IWDA: { ter: 0.0020, label: 'iShares Core MSCI World' },
  CSPX: { ter: 0.0007, label: 'iShares Core S&P 500' },
  VWCE: { ter: 0.0019, label: 'Vanguard FTSE All-World Acc' },
  VWRL: { ter: 0.0019, label: 'Vanguard FTSE All-World Dist' },
  EUNA: { ter: 0.0010, label: 'iShares Core Global Aggregate Bond' },
  AGGH: { ter: 0.0010, label: 'iShares Core Global Aggregate Bond (hedged)' },
  IBTA: { ter: 0.0007, label: 'iShares $ Treasury 1-3yr' },
}

/** Brokerage commission estimates (IBKR tiered, as an assumption — change here). */
const COMMISSION_RATE: Record<string, number> = { USD: 0.0005, EUR: 0.0010, CZK: 0.0010 }
const DEFAULT_COMMISSION_RATE = 0.0010

/** Assumed annual turnover for the trading-cost estimate. */
const ASSUMED_TURNOVER = 0.10

interface Row {
  h: Holding
  mktCZK: number
  kind: 'fund' | 'stock' | 'unknown'
  ter: number | null
  annualTerCZK: number
  annualTradingCZK: number
  totalAnnualCZK: number
  feeDragCZK: number
  effectiveCostPct: number | null
}

const feeRating = (pct: number | null) => {
  if (pct == null) return { label: 'Unknown', variant: 'gray' as const }
  if (pct < 0.05) return { label: 'Excellent', variant: 'green' as const }
  if (pct < 0.15) return { label: 'Good', variant: 'green' as const }
  if (pct < 0.30) return { label: 'Moderate', variant: 'amber' as const }
  return { label: 'High', variant: 'red' as const }
}

export default function FeeScannerPage() {
  const { holdings, projections, assetMetadata, loading } = useAppData()
  const { fx, fxLive, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const [horizon, setHorizon] = useState(10)
  const [growth, setGrowth]   = useState(7)
  const market = useMarketData()

  const symbolKey = holdings.map(h => h.symbol).join(',')
  useEffect(() => {
    if (symbolKey) market.refresh(symbolKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])

  const metaBy = new Map(assetMetadata.map(m => [m.symbol.toUpperCase(), m]))
  const rows: Row[] = positionsMetrics(holdings, market, fx, projections).map(m => {
    const h = m.holding
    const meta = metaBy.get(h.symbol.toUpperCase())
    const cls = meta ? holdingAssetClass(meta) : null
    const known = EXPENSE_RATIOS[h.symbol.toUpperCase()]
    const kind: Row['kind'] = known || cls === 'etf' || cls === 'bond' ? 'fund' : cls === 'stock' ? 'stock' : 'unknown'
    const ter = known ? known.ter : kind === 'stock' ? 0 : null
    const annualTerCZK = m.marketCZK * (ter ?? 0)
    const commRate = COMMISSION_RATE[h.currency.toUpperCase()] ?? DEFAULT_COMMISSION_RATE
    const annualTradingCZK = m.marketCZK * ASSUMED_TURNOVER * commRate
    const totalAnnualCZK = annualTerCZK + annualTradingCZK
    const g = growth / 100
    const feeDragCZK = m.marketCZK * (Math.pow(1 + g, horizon) - Math.pow(1 + g - (ter ?? 0), horizon))
    return {
      h, mktCZK: m.marketCZK, kind, ter, annualTerCZK, annualTradingCZK, totalAnnualCZK, feeDragCZK,
      effectiveCostPct: ter == null || m.marketCZK <= 0 ? null : (totalAnnualCZK / m.marketCZK) * 100,
    }
  })

  const totalValueCZK      = rows.reduce((s, r) => s + r.mktCZK, 0)
  const totalAnnualFeesCZK = rows.reduce((s, r) => s + r.totalAnnualCZK, 0)
  const totalFeeDragCZK    = rows.reduce((s, r) => s + r.feeDragCZK, 0)
  const known = rows.filter(r => r.ter != null)
  const knownValue = known.reduce((s, r) => s + r.mktCZK, 0)
  const wtdTer = knownValue > 0 ? known.reduce((s, r) => s + (r.ter ?? 0) * r.mktCZK, 0) / knownValue : null
  const funds = rows.filter(r => r.kind === 'fund')
  const fundPct = totalValueCZK > 0 ? (funds.reduce((s, r) => s + r.mktCZK, 0) / totalValueCZK) * 100 : 0
  const feePctOfPortfolio = totalValueCZK > 0 ? (totalAnnualFeesCZK / totalValueCZK) * 100 : null
  const unknownTer = rows.filter(r => r.ter == null)
  const portfolioRating = feeRating(unknownTer.length > 0 ? null : feePctOfPortfolio)
  const fundList = funds.filter(r => r.ter != null)
    .sort((a, b) => (b.ter ?? 0) - (a.ter ?? 0))
    .map(r => `${r.h.symbol} (${((r.ter ?? 0) * 100).toFixed(2)} %)`)

  if (loading) return <LoadingShell />

  const columns: Column<Row>[] = [
    { key: 'name', label: 'Company', sortValue: r => r.h.name, render: r => <>
      <div style={{ fontWeight: 500 }}>{r.h.name}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.h.symbol} · {r.h.currency}</div>
    </> },
    { key: 'type', label: 'Type', render: r => <Badge variant={r.kind === 'fund' ? 'blue' : r.kind === 'stock' ? 'gray' : 'amber'}>
      {r.kind === 'fund' ? 'Fund' : r.kind === 'stock' ? 'Stock' : 'Unclassified'}</Badge> },
    { key: 'value', label: 'Value (CZK)', numeric: true, sortValue: r => r.mktCZK, render: r => fmtCZK(r.mktCZK) },
    { key: 'ter', label: 'TER', numeric: true, sortValue: r => r.ter, render: r =>
      r.kind === 'stock' ? <span style={{ color: 'var(--text3)' }}>n/a</span>
        : r.ter == null ? <span style={{ color: 'var(--amber)' }}>unknown</span>
        : fmtShare(r.ter * 100, 2) },
    { key: 'terCost', label: 'Annual TER', numeric: true, sortValue: r => r.annualTerCZK, render: r => r.annualTerCZK > 0.5 ? `−${fmtCZK(r.annualTerCZK)}` : '—' },
    { key: 'trade', label: 'Trading est.', numeric: true, sortValue: r => r.annualTradingCZK, render: r => `~${fmtCZK(r.annualTradingCZK)}` },
    { key: 'total', label: 'Total annual', numeric: true, sortValue: r => r.totalAnnualCZK, render: r => `~${fmtCZK(r.totalAnnualCZK)}` },
    { key: 'eff', label: 'Effective', numeric: true, sortValue: r => r.effectiveCostPct, render: r => {
      const rating = feeRating(r.effectiveCostPct)
      return <Badge variant={rating.variant}>{r.effectiveCostPct == null ? '—' : `${r.effectiveCostPct.toFixed(3)} %`}</Badge>
    } },
    { key: 'drag', label: `${horizon}y drag`, numeric: true, sortValue: r => r.feeDragCZK, render: r => r.feeDragCZK > 100 ? `−${fmtCZK(r.feeDragCZK)}` : '—' },
  ]

  return (
    <PageShell>
      <PageHeader
        eyebrow="Stocks & ETFs"
        accent="var(--c-stocks)"
        title="Fees"
        subtitle={<>Expense ratios, brokerage costs and long-run fee drag
          {fxTs && <> · FX {fxTs}</>}{!fxLive && <span style={{ color: 'var(--amber)' }}> · fallback rates</span>}</>}
        actions={<button type="button" onClick={refreshFx} disabled={fxLoading} style={btnStyle('secondary')}>{fxLoading ? '⟳ FX…' : '↻ FX'}</button>}
      />
      <RouteTabs tabs={STOCK_TABS} />

      {rows.length === 0 ? (
        <EmptyState icon="%" title="No positions to analyse" body="Fees are estimated for each stock and fund you hold. Record a purchase on Positions first." />
      ) : <>
        {unknownTer.length > 0 && (
          <div role="alert" style={{
            background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)', color: 'var(--amber)',
            borderRadius: 8, padding: '9px 14px', marginBottom: 14, fontSize: 11, lineHeight: 1.6,
          }}>
            ⚠ No expense ratio known for {unknownTer.map(r => r.h.symbol).join(', ')} — they are left out of the TER
            figures (not counted as free). Classify them as stock or ETF on the Risk page, or add the fund&apos;s TER to
            <code> EXPENSE_RATIOS</code> in <code>src/app/fees/page.tsx</code>.
          </div>
        )}

        <MetricCards cards={[
          { label: 'Est. annual fees', value: fmtCZK(totalAnnualFeesCZK), accent: 'var(--border3)',
            note: feePctOfPortfolio != null ? `${feePctOfPortfolio.toFixed(3)} % of portfolio` : undefined },
          { label: 'Weighted TER', value: wtdTer != null ? `${(wtdTer * 100).toFixed(3)} %` : '—', accent: 'var(--border3)',
            note: `funds are ${fundPct.toFixed(0)} % of the portfolio` },
          { label: `Fee drag (${horizon}y)`, value: totalFeeDragCZK > 0 ? `−${fmtCZK(totalFeeDragCZK)}` : '—', accent: 'var(--red)',
            note: `vs. no fees at ${growth} % growth` },
          { label: 'Fee rating', value: portfolioRating.label, accent: 'var(--border3)',
            note: unknownTer.length > 0 ? 'incomplete — some TERs unknown' : 'overall cost efficiency' },
        ]} />

        <Panel title="Drag calculation assumptions">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, maxWidth: 640 }}>
            {[
              { id: 'horizon', label: 'Time horizon', value: horizon, setter: setHorizon, min: 1, max: 30, step: 1, unit: ' years' },
              { id: 'growth', label: 'Annual return assumption', value: growth, setter: setGrowth, min: 1, max: 15, step: 0.5, unit: ' %' },
            ].map(s => (
              <label key={s.id} htmlFor={`fee-${s.id}`} style={{ display: 'block' }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{s.label}</span>
                  <span className="num" style={{ fontSize: 11, fontWeight: 600 }}>{s.value}{s.unit}</span>
                </span>
                <input id={`fee-${s.id}`} type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                  onChange={e => s.setter(parseFloat(e.target.value))} style={{ width: '100%', accentColor: 'var(--green)' }} />
              </label>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text3)', lineHeight: 1.6, maxWidth: 640 }}>
            Fee drag = what compounding at {growth} % minus the TER leaves you short of {growth} % with no fees, over {horizon} years.
            Trading cost assumes {(ASSUMED_TURNOVER * 100).toFixed(0)} % annual turnover at IBKR-like commission rates.
          </div>
        </Panel>

        <Panel title="Position fee breakdown" padded={false}
          right={<span style={{ display: 'flex', gap: 6 }}>
            <Badge variant="blue">{funds.length} funds</Badge>
            <Badge variant="gray">{rows.filter(r => r.kind === 'stock').length} stocks</Badge>
            {unknownTer.length > 0 && <Badge variant="amber">{unknownTer.length} unknown</Badge>}
          </span>}>
          <DataTable caption="Fees by position" columns={columns} rows={rows} rowKey={r => r.h.id}
            initialSort={{ key: 'total', dir: 'desc' }}
            footer={
              <tr style={{ background: 'var(--bg3)' }}>
                <td colSpan={2} style={{ padding: '10px 14px', fontWeight: 600, fontSize: 12 }}>Total</td>
                <td className="num" style={{ ...tdR, fontWeight: 600 }}>{fmtCZK(totalValueCZK)}</td>
                <td className="num" style={tdR}>{wtdTer != null ? `${(wtdTer * 100).toFixed(3)} % wtd` : '—'}</td>
                <td colSpan={2} />
                <td className="num" style={{ ...tdR, fontWeight: 600 }}>~{fmtCZK(totalAnnualFeesCZK)}</td>
                <td />
                <td className="num" style={{ ...tdR, fontWeight: 600 }}>−{fmtCZK(totalFeeDragCZK)}</td>
              </tr>
            } />
        </Panel>

        <Panel title="Notes">
          <ul style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, paddingLeft: 18 }}>
            <li>
              {fundList.length > 0
                ? <>Your fund costs: {fundList.join(', ')}. Funds are {fundPct.toFixed(0)} % of this portfolio.</>
                : <>You hold no funds with a known TER — costs are brokerage friction only.</>}
            </li>
            <li>At {(ASSUMED_TURNOVER * 100).toFixed(0)} % turnover, trading friction dominates for individual stocks; buy-and-hold reduces it to near zero.</li>
            <li>Small US trades pay a minimum commission, so positions under ~$200 cost disproportionately more.</li>
            <li>Dividend withholding (15 % on US stocks, up to 35 % elsewhere — see Received) is usually a larger drag than fund fees;
              accumulating Irish-domiciled UCITS funds avoid most of it.</li>
          </ul>
        </Panel>
      </>}
    </PageShell>
  )
}
