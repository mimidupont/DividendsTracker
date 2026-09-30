'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, Tabs } from '@/components/PageShell'
import { fmtCZK, fmtShare } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { useAppData } from '@/hooks/useAppData'
import { buildPositions, assetPositions, type Position } from '@/lib/portfolio'
import { effectiveN, effectiveNBand, fundShare, unhedgedFxShare, ASSET_CLASS_LABELS, ASSET_CLASS_COLORS } from '@/lib/risk'
import { btnStyle } from '@/lib/ui'

type View = 'value' | 'income'

/** Neutral palette for categorical buckets (sectors, regions, currencies) — not asset-class colours. */
const CATEGORICAL = ['#3b5b8c', '#6b8e4e', '#9b6b3b', '#7b5b8c', '#3b7b7b', '#8c5b5b', '#5b6b7b', '#8c7b3b', '#4b4b8c', '#7b7b7b']

interface Bucket { key: string; label: string; value: number; pct: number; count: number; color: string }

function bucketsBy(ps: Position[], keyOf: (p: Position) => string, view: View, color?: (k: string, i: number) => string, label?: (k: string) => string): Bucket[] {
  const map = new Map<string, { value: number; count: number }>()
  for (const p of ps) {
    const k = keyOf(p)
    const cur = map.get(k) ?? { value: 0, count: 0 }
    cur.value += view === 'value' ? p.valueCZK : p.annualIncomeCZK
    cur.count += 1
    map.set(k, cur)
  }
  const total = Array.from(map.values()).reduce((s, v) => s + v.value, 0)
  return Array.from(map, ([key, v]) => ({ key, ...v }))
    .filter(b => b.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((b, i) => ({
      key: b.key, label: label ? label(b.key) : b.key, value: b.value, count: b.count,
      pct: total > 0 ? (b.value / total) * 100 : 0,
      color: color ? color(b.key, i) : CATEGORICAL[i % CATEGORICAL.length],
    }))
}

function BucketBars({ buckets, caption }: { buckets: Bucket[]; caption: string }) {
  if (buckets.length === 0) return <div style={{ fontSize: 12, color: 'var(--text3)' }}>Nothing to show.</div>
  return (
    <ul aria-label={caption} style={{ listStyle: 'none', display: 'grid', gap: 10 }}>
      {buckets.map(b => (
        <li key={b.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: b.color }} />
              {b.label}
              <span style={{ color: 'var(--text3)', fontSize: 11 }}>· {b.count}</span>
            </span>
            <span className="num">{fmtCZK(b.value)} <span style={{ color: 'var(--text3)' }}>{fmtShare(b.pct)}</span></span>
          </div>
          <div aria-hidden="true" style={{ height: 6, background: 'var(--bg4)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${b.pct}%`, height: '100%', background: b.color }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Where the money is, across every asset class: by class, currency, sector
 * and region. Sector/region come from asset_metadata (edit them on Risk);
 * there is no second hard-coded sector list any more.
 */
export default function AllocationPage() {
  const app = useAppData()
  const { holdings, cryptoHoldings, loading } = app
  const { fx, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const market = useMarketData()
  const crypto = useCryptoPrices()
  const [view, setView] = useState<View>('value')

  const symbolKey = holdings.map(h => h.symbol).join(',')
  useEffect(() => {
    if (symbolKey) market.refresh(symbolKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])
  const coinKey = cryptoHoldings.map(c => c.coin_id).join(',')
  useEffect(() => {
    if (coinKey) crypto.refresh(coinKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinKey])

  const positions = useMemo(() => buildPositions(app, fx, market, crypto), [app, fx, market, crypto])
  // Weights are over assets only: a mortgage as a negative weight would make
  // shares sum to something other than 100 %.
  const assets = assetPositions(positions)
  const equity = assets.filter(p => p.assetClass === 'stock' || p.assetClass === 'etf')

  const byClass = bucketsBy(assets, p => p.assetClass, view, k => ASSET_CLASS_COLORS[k as Position['assetClass']], k => ASSET_CLASS_LABELS[k as Position['assetClass']])
  const byCurrency = bucketsBy(assets, p => p.currency, view)
  const bySector = bucketsBy(equity, p => p.isFund && !p.sector ? 'Funds (not looked through)' : p.sector ?? 'Unclassified', view)
  const byRegion = bucketsBy(assets, p => p.region ?? 'Unclassified', view)
  const total = assets.reduce((s, p) => s + (view === 'value' ? p.valueCZK : p.annualIncomeCZK), 0)
  const top = [...assets]
    .sort((a, b) => view === 'value' ? b.valueCZK - a.valueCZK : b.annualIncomeCZK - a.annualIncomeCZK)
    .slice(0, 10)

  const effN = effectiveN(positions)
  const funds = fundShare(positions)
  const foreign = unhedgedFxShare(positions)
  const unclassified = equity.filter(p => !p.sector && !p.isFund).length

  // Scroll to #currency when arriving from the old /currency page.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#currency' && !loading) {
      document.getElementById('currency')?.scrollIntoView()
    }
  }, [loading])

  if (loading) return <LoadingShell />

  return (
    <PageShell>
      <PageHeader
        eyebrow="Analysis"
        title="Allocation & exposure"
        subtitle={<>Every asset you own, by class, currency, sector and region{fxTs && <> · FX {fxTs}</>}</>}
        actions={<button type="button" onClick={refreshFx} disabled={fxLoading} style={btnStyle('secondary')}>{fxLoading ? '⟳ FX…' : '↻ FX'}</button>}
      />

      {assets.length === 0 ? (
        <EmptyState icon="◔" title="Nothing to allocate yet" body="Add positions, accounts, bonds, coins or property and their split appears here." />
      ) : <>
        <Tabs label="Measure" value={view} onChange={setView} tabs={[{ key: 'value', label: 'By value' }, { key: 'income', label: 'By income' }]} />

        <MetricCards cards={[
          { label: view === 'value' ? 'Gross assets' : 'Annual income', value: fmtCZK(total), accent: 'var(--border3)',
            note: view === 'value' ? 'before mortgages' : 'gross, forward' },
          { label: 'Effective positions', value: effN > 0 ? effN.toFixed(1) : '—', accent: `var(--${effectiveNBand(effN) === 'red' ? 'red' : effectiveNBand(effN) === 'amber' ? 'amber' : 'green'})`,
            note: funds > 0.2 ? `${fmtShare(funds * 100, 0)} is in funds, each counted as one position` : '1 / Σ weight² — see Risk' },
          { label: 'Outside CZK', value: fmtShare(foreign * 100, 0), accent: 'var(--border3)', note: 'share of assets in foreign currencies' },
          { label: 'Asset classes', value: String(byClass.length), accent: 'var(--border3)' },
        ]} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
          <Panel title="Asset class"><BucketBars caption="By asset class" buckets={byClass} /></Panel>
          <Panel title="Currency" id="currency"><BucketBars caption="By currency" buckets={byCurrency} /></Panel>
          <Panel title="Sector (stocks & ETFs)" right={unclassified > 0 && <Link href="/risk" style={{ fontSize: 11 }}>{unclassified} unclassified — fix on Risk →</Link>}>
            <BucketBars caption="By sector" buckets={bySector} />
          </Panel>
          <Panel title="Region"><BucketBars caption="By region" buckets={byRegion} /></Panel>
        </div>

        <Panel title={`Top 10 by ${view === 'value' ? 'value' : 'income'}`}>
          <ol style={{ listStyle: 'none', display: 'grid', gap: 8 }}>
            {top.map((p, i) => {
              const v = view === 'value' ? p.valueCZK : p.annualIncomeCZK
              return (
                <li key={p.id} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 8, alignItems: 'center', fontSize: 12 }}>
                  <span className="num" style={{ color: 'var(--text3)' }}>{i + 1}</span>
                  <span>
                    <span aria-hidden="true" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: ASSET_CLASS_COLORS[p.assetClass], marginRight: 6 }} />
                    <strong>{p.label}</strong> <span style={{ color: 'var(--text3)' }}>{p.name !== p.label ? p.name : ''}</span>
                  </span>
                  <span className="num">{fmtCZK(v)} <span style={{ color: 'var(--text3)' }}>{total > 0 ? fmtShare((v / total) * 100) : '—'}</span></span>
                </li>
              )
            })}
          </ol>
        </Panel>
      </>}
    </PageShell>
  )
}
