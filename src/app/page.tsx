'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageShell, PageHeader, LoadingShell, EmptyState, Panel } from '@/components/PageShell'
import { fmtCZK, fmtSignedCZK, fmtShare, fmtPct, trendGlyph, fmtAxisCZK } from '@/lib/fx'
import { todayISO, addDays, fmtISODateShort, yearOf } from '@/lib/date'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import { usePortfolioSnapshots } from '@/hooks/usePortfolioSnapshots'
import {
  positionsMetrics, portfolioTotals, buildPositions, unconvertibleCurrencies,
  totalsByClass, netWorthCZK, incomeByClass, investedCostAndValue, type AssetClass,
} from '@/lib/portfolio'
import { snapshotValues, snapshotBlockers, isValuedAtCost } from '@/lib/snapshot'
import { contributionsVsGrowth, externalFlows } from '@/lib/transactions'
import { attentionItems } from '@/lib/alerts'
import { ASSET_CLASS_LABELS, ASSET_CLASS_COLORS } from '@/lib/risk'
import { signColor, btnSecondary } from '@/lib/ui'
import RunwayCard from '@/components/RunwayCard'
import RecordModal from '@/components/RecordModal'
import { DEFAULT_PLAN, effectiveAnnualExpenses } from '@/lib/fire'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

type PLWindow = '7d' | '30d' | 'ytd'

const PL_WINDOWS: { key: PLWindow; label: string; days: number | 'ytd' }[] = [
  { key: '7d',  label: '7 days',  days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: 'ytd', label: 'YTD',     days: 'ytd' },
]

const CLASS_HREF: Record<AssetClass, string> = {
  stock: '/holdings', etf: '/holdings', bond: '/bonds', cash: '/cash', crypto: '/crypto', realestate: '/realestate',
}
/** Order and grouping of the class cards (stocks and ETFs shown together). */
const CARD_CLASSES: { key: string; label: string; classes: AssetClass[]; color: string; href: string }[] = [
  { key: 'equity', label: 'Stocks & ETFs', classes: ['stock', 'etf'], color: ASSET_CLASS_COLORS.stock, href: '/holdings' },
  { key: 'bond', label: 'Bonds', classes: ['bond'], color: ASSET_CLASS_COLORS.bond, href: '/bonds' },
  { key: 'cash', label: 'Cash & savings', classes: ['cash'], color: ASSET_CLASS_COLORS.cash, href: '/cash' },
  { key: 'crypto', label: 'Crypto', classes: ['crypto'], color: ASSET_CLASS_COLORS.crypto, href: '/crypto' },
  { key: 'realestate', label: 'Real estate (equity)', classes: ['realestate'], color: ASSET_CLASS_COLORS.realestate, href: '/realestate' },
]

export default function Dashboard() {
  const appData = useAppData()
  const {
    holdings, projections, bankAccounts, cryptoHoldings, realEstate, bondHoldings,
    transactions, dividendsReceived, loading, error,
  } = appData

  const { activeProfile } = useProfile()
  const { fx, fxLive, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const market = useMarketData()
  const cryptoPrices = useCryptoPrices()
  const { snapshots, saveSnapshot, getPLSummary, error: snapshotError } = usePortfolioSnapshots()

  const [plWindow, setPlWindow] = useState<PLWindow>('30d')
  const [recording, setRecording] = useState(false)

  // Keyed on the symbol list, not its length: swapping profiles can keep the
  // count identical while every ticker changes.
  const symbolKey = holdings.map(h => h.symbol).join(',')
  const coinKey   = cryptoHoldings.map(c => c.coin_id).join(',')

  useEffect(() => {
    if (symbolKey) market.refresh(symbolKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])

  useEffect(() => {
    if (coinKey) cryptoPrices.refresh(coinKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinKey])

  const today = todayISO()

  // ── One position model for every figure on this page ─────────────────────
  const positions = useMemo(
    () => buildPositions(appData, fx, market, cryptoPrices, today),
    [appData, fx, market, cryptoPrices, today]
  )
  const stockMetrics = useMemo(
    () => positionsMetrics(holdings, market, fx, projections),
    [holdings, market, fx, projections]
  )
  const stockTotals = portfolioTotals(stockMetrics)
  const byClass = totalsByClass(positions)
  const incomeClass = incomeByClass(positions)
  const totalNetWorth = netWorthCZK(positions)
  const invested = investedCostAndValue(positions)
  const totalGainCZK = invested.valueCZK - invested.costCZK
  const totalIncome = Object.values(incomeClass).reduce((a, b) => a + b, 0)
  const fxProblems = useMemo(() => unconvertibleCurrencies(positions, fx), [positions, fx])
  const blockers = useMemo(() => snapshotBlockers(positions), [positions])

  // ── Save today's snapshot once every priced position has a live price ────
  // Readiness is by coverage, not a shared "done" flag: after a profile switch
  // the flag could still say "done" for the previous profile's tickers while
  // the new ones were valued at cost.
  const hasAnything = positions.length > 0
  const ready = !loading && !error && fxLive && !fxLoading &&
    market.state !== 'loading' && cryptoPrices.state !== 'loading' &&
    blockers.length === 0 && hasAnything && appData.profileId === activeProfile?.id
  const values = useMemo(() => snapshotValues(positions, fx), [positions, fx])
  useEffect(() => {
    if (ready) saveSnapshot(values, appData.profileId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, values.total_value_czk])

  // ── P&L windows: deposits and withdrawals taken out ──────────────────────
  const flows = useMemo(() => externalFlows(transactions), [transactions])
  const selectedWindow = PL_WINDOWS.find(w => w.key === plWindow)!
  const summaries = useMemo(
    () => Object.fromEntries(PL_WINDOWS.map(w => [w.key, getPLSummary(totalNetWorth, w.days, flows)])),
    [getPLSummary, totalNetWorth, flows]
  )
  const plSummary = summaries[plWindow]
  const flowAware = flows.length > 0

  const cutoff = selectedWindow.days === 'ytd'
    ? `${today.slice(0, 4)}-01-01`
    : addDays(today, -(selectedWindow.days as number))
  const chartData = [
    ...snapshots.filter(s => s.snapshot_date >= cutoff && s.snapshot_date < today)
      .map(s => ({ date: s.snapshot_date, value: s.total_value_czk })),
    ...(hasAnything ? [{ date: today, value: totalNetWorth }] : []),
  ]
  const referenceValue = chartData.length > 0 ? chartData[0].value : null
  const chartStroke = (plSummary.pl ?? 0) < 0 ? 'var(--red)' : 'var(--green)'

  const growthSplit = useMemo(() => contributionsVsGrowth(transactions, snapshots), [transactions, snapshots])
  const latestSplit = growthSplit.length > 0 ? growthSplit[growthSplit.length - 1] : null

  const dashboardExpenses = effectiveAnnualExpenses(
    { ...DEFAULT_PLAN, ...(appData.financialPlan ?? {}) }, appData.expenseLog)

  const ytdDivCZK = dividendsReceived
    .filter(d => yearOf(d.payment_date) === yearOf(today))
    .reduce((s, d) => s + (d.gross_amount - (d.withholding_tax ?? 0)) * (d.fx_rate_czk ?? fx[d.currency.toUpperCase()] ?? 1), 0)

  const alerts = useMemo(() => attentionItems({
    positions, accounts: bankAccounts, bonds: bondHoldings, holdings,
    metadata: appData.assetMetadata, targets: appData.allocationTargets,
    costFxUnknown: stockTotals.costFxUnknown, snapshotBlockedBy: hasAnything ? blockers : [], today,
  }), [positions, bankAccounts, bondHoldings, holdings, appData.assetMetadata, appData.allocationTargets, stockTotals.costFxUnknown, blockers, hasAnything, today])

  const cards = CARD_CLASSES.map(c => {
    const ps = positions.filter(p => c.classes.includes(p.assetClass))
    const value = ps.reduce((s, p) => s + p.valueCZK, 0)
    const withCost = ps.filter(p => !p.isLiability && p.assetClass !== 'cash')
    const cost = withCost.reduce((s, p) => s + p.costCZK, 0)
    const gross = withCost.reduce((s, p) => s + p.valueCZK, 0)
    return {
      ...c, value, count: ps.filter(p => !p.isLiability).length,
      pl: c.key === 'cash' || cost <= 0 ? null : gross - cost,
      plPct: c.key === 'cash' || cost <= 0 ? null : ((gross - cost) / cost) * 100,
      atCost: ps.filter(isValuedAtCost).length,
    }
  }).filter(c => c.count > 0 || c.key === 'equity' || c.key === 'cash')

  const mix = (Object.keys(byClass) as AssetClass[])
    .map(k => ({ key: k, value: byClass[k] }))
    .filter(m => m.value > 0)
  const mixTotal = mix.reduce((s, m) => s + m.value, 0)

  if (loading) return <LoadingShell label="Loading wealth data…" />

  const header = (
    <PageHeader
      eyebrow={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      title={`${greeting()}${activeProfile ? `, ${activeProfile.display_name}` : ''}`}
      actions={<>
        <button type="button" onClick={refreshFx} disabled={fxLoading} style={btnSecondary}>
          {fxLoading ? '⟳' : '↻'} FX
        </button>
        <button type="button"
          onClick={() => market.refresh(holdings.map(h => h.symbol), true)}
          disabled={market.state === 'loading'}
          style={btnSecondary}
        >
          {market.state === 'loading' ? '⟳ Fetching…' : '↻ Prices'}
        </button>
      </>}
    />
  )

  if (!hasAnything && !error) {
    return (
      <PageShell>
        {header}
        <EmptyState
          icon="◈"
          title="Nothing tracked yet"
          body={<>Record your first purchase, or add a bank account, bond, coin or property. Everything
            you add is valued in CZK and shows up here as net worth.</>}
          action={<button type="button" onClick={() => setRecording(true)} style={{ ...btnSecondary, background: 'var(--green-bg)', borderColor: 'var(--green-bd)', color: 'var(--green)' }}>+ Record a transaction</button>}
        />
        {recording && <RecordModal onClose={() => setRecording(false)} />}
      </PageShell>
    )
  }

  return (
    <PageShell>
      {header}

      {/* Anything that would make the totals below wrong is stated, not hidden */}
      {(error || !fxLive || market.state === 'error' || fxProblems.length > 0 || snapshotError) && (
        <div role="alert" style={{
          background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)',
          color: 'var(--amber)', borderRadius: 10, padding: '10px 14px',
          marginBottom: 16, fontSize: 11, lineHeight: 1.6,
        }}>
          {error && <div>⚠ Some data could not be loaded — totals are incomplete: {error}</div>}
          {snapshotError && <div>⚠ Snapshot history unavailable, so the P&amp;L windows below have nothing to compare against: {snapshotError}</div>}
          {!fxLive && <div>⚠ Live FX unavailable — CZK values use fallback rates and are approximate.</div>}
          {market.state === 'error' && <div>⚠ Live prices unavailable — positions are valued at cost. {market.errorMsg}</div>}
          {fxProblems.length > 0 && (
            <div>
              ⚠ No CZK rate for {fxProblems.join(', ')} — those holdings are counted into net worth
              <strong> unconverted</strong>, so the total below is wrong by whatever the real rate is.
            </div>
          )}
        </div>
      )}

      {/* ── Hero + attention ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 14 }}>
        <section aria-label="Net worth" style={{
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '26px 28px',
          gridColumn: alerts.length > 0 ? undefined : '1 / -1',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 28 }}>
            <div>
              <div style={labelCaps}>Net worth</div>
              <div className="num" style={{ fontFamily: "'Instrument Serif', serif", fontSize: 40, lineHeight: 1.05 }}>
                {fmtCZK(totalNetWorth)}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: signColor(totalGainCZK) }}>
                {trendGlyph(totalGainCZK)} {fmtSignedCZK(totalGainCZK)} unrealised
                <span style={{ color: 'var(--text3)', marginLeft: 6 }}>
                  {invested.costCZK > 0 ? `${fmtPct((totalGainCZK / invested.costCZK) * 100, 1)} on invested` : ''}
                </span>
              </div>
              {stockTotals.fxPLCZK !== 0 && (
                <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text3)' }}>
                  of which currency: <span style={{ color: signColor(stockTotals.fxPLCZK) }}>{fmtSignedCZK(stockTotals.fxPLCZK)}</span>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text3)' }}>
                Prices {market.fetchedAt ? new Date(market.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}
                {' · '}FX {fxLive ? (fxTs ?? '—') : <span style={{ color: 'var(--amber)' }}>fallback</span>}
                {blockers.length > 0 && <> · <span style={{ color: 'var(--amber)' }}>{blockers.length} at cost</span></>}
              </div>
            </div>
            <div>
              <div style={labelCaps}>Est. annual income <span style={{ textTransform: 'none', letterSpacing: 0 }}>(gross)</span></div>
              <div className="num" style={{ fontFamily: "'Instrument Serif', serif", fontSize: 40, lineHeight: 1.05, color: 'var(--c-income)' }}>
                {fmtCZK(totalIncome)}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)' }}>
                {fmtCZK(totalIncome / 12)} a month
                {stockTotals.incomeUnknown.length > 0 && (
                  <span style={{ color: 'var(--amber)' }}> · excludes {stockTotals.incomeUnknown.join(', ')} (unknown)</span>
                )}
              </div>
            </div>
          </div>

          {/* Asset mix */}
          {mixTotal > 0 && (
            <div style={{ marginTop: 22 }}>
              <div role="img" aria-label={`Asset mix: ${mix.map(m => `${ASSET_CLASS_LABELS[m.key]} ${((m.value / mixTotal) * 100).toFixed(0)}%`).join(', ')}`}
                style={{ display: 'flex', gap: 2, height: 6, borderRadius: 4, overflow: 'hidden' }}>
                {mix.map(m => <div key={m.key} style={{ flex: m.value, background: ASSET_CLASS_COLORS[m.key] }} />)}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                {mix.map(m => (
                  <Link key={m.key} href={CLASS_HREF[m.key]} style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: ASSET_CLASS_COLORS[m.key] }} />
                    <span style={{ fontSize: 11, color: 'var(--text2)' }}>{ASSET_CLASS_LABELS[m.key]}</span>
                    <span className="num" style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtShare((m.value / mixTotal) * 100, 0)}</span>
                  </Link>
                ))}
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>of gross assets</span>
              </div>
            </div>
          )}
        </section>

        {alerts.length > 0 && (
          <Panel title={`Needs attention (${alerts.length})`}>
            <ul style={{ listStyle: 'none', display: 'grid', gap: 8 }}>
              {alerts.map(a => (
                <li key={a.id} style={{ fontSize: 12, lineHeight: 1.5, display: 'flex', gap: 8 }}>
                  <span aria-hidden="true" style={{ color: a.level === 'warn' ? 'var(--amber)' : 'var(--blue)' }}>{a.level === 'warn' ? '⚠' : 'ⓘ'}</span>
                  <span style={{ color: 'var(--text2)' }}>
                    {a.text}{' '}
                    <Link href={a.href} style={{ color: 'var(--blue)', whiteSpace: 'nowrap' }}>{a.action ?? 'Open'} →</Link>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      {/* ── Performance ──────────────────────────────────────────────────── */}
      <Panel
        title={flowAware ? 'Performance · deposits excluded' : 'Change in net worth'}
        right={
          <div role="group" aria-label="Window" style={{ display: 'flex', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden' }}>
            {PL_WINDOWS.map(w => (
              <button key={w.key} type="button" aria-pressed={plWindow === w.key} onClick={() => setPlWindow(w.key)} style={{
                padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 12,
                background: plWindow === w.key ? 'var(--bg4)' : 'var(--bg2)',
                color: plWindow === w.key ? 'var(--text)' : 'var(--text3)',
                borderRight: w.key !== 'ytd' ? '1px solid var(--border2)' : 'none',
                fontWeight: plWindow === w.key ? 500 : 400,
              }}>{w.label}</button>
            ))}
          </div>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
          {PL_WINDOWS.map(w => {
            const s = summaries[w.key]
            const active = plWindow === w.key
            return (
              <button key={w.key} type="button" aria-pressed={active} onClick={() => setPlWindow(w.key)} style={{
                padding: '12px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                background: active ? 'var(--bg3)' : 'var(--bg2)',
                border: `1px solid ${active ? 'var(--border3)' : 'var(--border)'}`,
              }}>
                <div style={{ ...labelCaps, marginBottom: 5 }}>{w.label}</div>
                <div className="num" style={{ fontSize: 15, fontWeight: 600, color: signColor(s.pl) }}>
                  {s.pl == null ? '—' : `${trendGlyph(s.pl)} ${fmtSignedCZK(s.pl)}`}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                  {s.pl == null ? 'no history yet' : `${fmtPct(s.plPct)}${flowAware && s.flowsCZK !== 0 ? ` · ${fmtSignedCZK(s.flowsCZK)} paid in` : ''}`}
                </div>
              </button>
            )
          })}
        </div>

        {plSummary.fromDate && (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>
            vs {fmtISODateShort(plSummary.fromDate)} ({fmtCZK(plSummary.fromValue)})
            {!flowAware && ' · includes any money you paid in — record deposits to separate them'}
          </div>
        )}

        {chartData.length >= 2 ? (
          <div role="img" aria-label={`Net worth over ${selectedWindow.label}: from ${fmtCZK(chartData[0].value)} to ${fmtCZK(chartData[chartData.length - 1].value)}`}>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="plGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartStroke} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={chartStroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtISODateShort} tick={{ fontSize: 11, fill: 'var(--text3)' }}
                  axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={fmtAxisCZK} tick={{ fontSize: 11, fill: 'var(--text3)' }}
                  axisLine={false} tickLine={false} width={70} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip reference={referenceValue} />} />
                {referenceValue != null && <ReferenceLine y={referenceValue} stroke="var(--border3)" strokeDasharray="4 4" />}
                <Area type="monotone" dataKey="value" stroke={chartStroke} strokeWidth={2}
                  fill="url(#plGradient)" dot={false} activeDot={{ r: 4, fill: chartStroke, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{
            height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text3)', fontSize: 12, flexDirection: 'column', gap: 6,
            background: 'var(--bg3)', borderRadius: 10,
          }}>
            <div>History builds one point a day</div>
            <div style={{ fontSize: 11 }}>
              {snapshots.length === 0 ? 'The first point is saved once every price has loaded' : `${snapshots.length} day${snapshots.length > 1 ? 's' : ''} so far — two are needed for a line`}
            </div>
          </div>
        )}
      </Panel>

      {/* ── Asset class cards ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
        {cards.map(c => {
          const pct = mixTotal > 0 && c.value > 0 ? (c.value / totalNetWorth) * 100 : null
          return (
            <Link key={c.key} href={c.href} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{
                background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
                padding: '16px 18px', position: 'relative', overflow: 'hidden', height: '100%',
              }}>
                <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: c.color }} />
                <div style={{ ...labelCaps, color: c.color }}>{c.label}</div>
                <div className="num" style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, marginBottom: 4 }}>
                  {c.count === 0 ? '—' : fmtCZK(c.value)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
                  {c.count === 0 ? 'Nothing yet — add one' : <>
                    {pct != null && `${fmtShare(pct)} of net worth`}
                    {c.pl != null && (
                      <div style={{ color: signColor(c.pl) }}>{fmtSignedCZK(c.pl)} ({fmtPct(c.plPct, 1)})</div>
                    )}
                    {c.atCost > 0 && <div style={{ color: 'var(--amber)' }}>{c.atCost} at cost</div>}
                  </>}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Contributions vs growth — "did I earn this, or did I pay it in?" */}
      {latestSplit && growthSplit.length >= 2 && (
        <Panel title={`Since ${fmtISODateShort(growthSplit[0].date)}`}>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 14 }}>
            {[
              { label: 'Total change', value: latestSplit.contributed + latestSplit.growth, color: signColor(latestSplit.contributed + latestSplit.growth), signed: true },
              { label: 'You paid in', value: latestSplit.contributed, color: 'var(--c-cash)', signed: true },
              { label: 'Markets earned', value: latestSplit.growth, color: signColor(latestSplit.growth), signed: true },
            ].map(x => (
              <div key={x.label}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{x.label}</div>
                <div className="num" style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, color: x.color }}>{fmtSignedCZK(x.value)}</div>
              </div>
            ))}
          </div>
          <div aria-hidden="true" style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg4)' }}>
            <div style={{ flex: Math.max(0, latestSplit.contributed), background: 'var(--c-cash)' }} />
            <div style={{ flex: Math.max(0, latestSplit.growth), background: 'var(--green)' }} />
          </div>
        </Panel>
      )}

      {/* ── Bottom row ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <Panel title="Income streams (gross, forward)">
          {([
            { key: 'equity', label: 'Dividends', value: incomeClass.stock + incomeClass.etf, sub: `YTD received ${fmtCZK(ytdDivCZK)} net`, color: ASSET_CLASS_COLORS.stock },
            { key: 'bond', label: 'Coupons', value: incomeClass.bond, sub: `${bondHoldings.length} bonds`, color: ASSET_CLASS_COLORS.bond },
            { key: 'cash', label: 'Interest', value: incomeClass.cash, sub: `${bankAccounts.length} accounts · before 15 % tax`, color: ASSET_CLASS_COLORS.cash },
            { key: 'realestate', label: 'Rent', value: incomeClass.realestate, sub: 'before costs', color: ASSET_CLASS_COLORS.realestate },
            { key: 'crypto', label: 'Staking', value: incomeClass.crypto, sub: `${cryptoHoldings.filter(c => c.staking_apy > 0).length} assets`, color: ASSET_CLASS_COLORS.crypto },
          ]).filter(s => s.value > 0 || s.key === 'equity' || s.key === 'cash').map(s => (
            <div key={s.key} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
                <div>
                  <span style={{ fontSize: 12 }}>{s.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 8 }}>{s.sub}</span>
                </div>
                <span className="num" style={{ fontSize: 12 }}>{s.value > 0 ? fmtCZK(s.value) : '—'}</span>
              </div>
              <div aria-hidden="true" style={{ height: 3, background: 'var(--bg4)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${totalIncome > 0 ? (s.value / totalIncome) * 100 : 0}%`, background: s.color }} />
              </div>
            </div>
          ))}
          <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Total a year</span>
            <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>{fmtCZK(totalIncome)}</span>
          </div>
        </Panel>

        <div>
          <RunwayCard
            positions={positions}
            monthlyExpenses={dashboardExpenses.annualCZK / 12}
            accounts={bankAccounts}
            compact
          />
        </div>

        <Panel title="At a glance">
          {[
            { label: 'Yield on net worth', value: totalNetWorth > 0 ? fmtShare((totalIncome / totalNetWorth) * 100, 2) : '—' },
            { label: 'Stock & ETF P&L', value: fmtPct(stockTotals.plPct, 1), color: signColor(stockTotals.plPct) },
            { label: 'Property equity', value: byClass.realestate !== 0 && realEstate.length > 0 ? fmtCZK(byClass.realestate) : '—' },
            { label: 'Positions', value: `${holdings.length} stocks · ${bondHoldings.length} bonds · ${bankAccounts.length} accounts · ${cryptoHoldings.length} coins · ${realEstate.length} properties` },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{s.label}</span>
              <span className="num" style={{ fontSize: 12, textAlign: 'right', color: s.color ?? 'var(--text)' }}>{s.value}</span>
            </div>
          ))}
        </Panel>
      </div>
      {recording && <RecordModal onClose={() => setRecording(false)} />}
    </PageShell>
  )
}

const labelCaps: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8, fontWeight: 500,
}

function ChartTooltip({ active, payload, label, reference }: {
  active?: boolean; payload?: { value: number }[]; label?: string; reference: number | null
}) {
  if (!active || !payload?.length || !label) return null
  const val = payload[0].value
  const diff = reference != null ? val - reference : null
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border2)',
      borderRadius: 8, padding: '10px 14px', fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    }}>
      <div style={{ color: 'var(--text3)', marginBottom: 4 }}>{fmtISODateShort(label)}</div>
      <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>{fmtCZK(val)}</div>
      {diff != null && <div style={{ color: signColor(diff), marginTop: 2 }}>{fmtSignedCZK(diff)} vs start</div>}
    </div>
  )
}
