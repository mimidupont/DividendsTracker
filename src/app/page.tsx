'use client'
import { useEffect, useMemo, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { toCZK, fmtCZK } from '@/lib/fx'
import { todayISO, addDays, fmtISODateShort, yearOf } from '@/lib/date'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import { usePortfolioSnapshots } from '@/hooks/usePortfolioSnapshots'
import { positionsMetrics, portfolioTotals, buildPositions, unconvertibleCurrencies } from '@/lib/portfolio'
import { currencyExposure } from '@/lib/exposure'
import { contributionsVsGrowth, externalFlows } from '@/lib/transactions'
import RunwayCard from '@/components/RunwayCard'
import { DEFAULT_PLAN, effectiveAnnualExpenses } from '@/lib/fire'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

interface AssetBlock {
  label: string
  value: number
  color: string
  href: string
}

type PLWindow = '7d' | '30d' | 'ytd'

const PL_WINDOWS: { key: PLWindow; label: string; days: number | 'ytd' }[] = [
  { key: '7d',  label: '7 days',  days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: 'ytd', label: 'YTD',     days: 'ytd' },
]

export default function Dashboard() {
  const appData = useAppData()
  const {
    holdings, projections, dividendsReceived,
    bankAccounts, cryptoHoldings, realEstate, transactions, loading, error,
  } = appData

  const { activeProfile } = useProfile()
  const { fx, fxLive, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const market = useMarketData()
  const cryptoPrices = useCryptoPrices()
  const { snapshots, saveSnapshot, getPLSummary, error: snapshotError } = usePortfolioSnapshots()

  const [plWindow, setPlWindow] = useState<PLWindow>('30d')

  // Kick off market + crypto fetches when data arrives.
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

  // ── Asset values ──────────────────────────────────────────────────────────
  const positions = useMemo(
    () => positionsMetrics(holdings, market, fx, projections),
    [holdings, market, fx, projections]
  )
  const stockTotals   = portfolioTotals(positions)
  const stockValueCZK = stockTotals.marketCZK
  const stockCostCZK  = stockTotals.costCZK

  const cashValueCZK = bankAccounts.reduce((s, a) =>
    s + toCZK(a.balance, a.currency, fx), 0)

  const cryptoValueCZK = cryptoHoldings.reduce((s, c) => {
    const priceUSD = cryptoPrices.getPrice(c.coin_id, c.avg_cost_usd)
    return s + toCZK(priceUSD * c.amount, 'USD', fx)
  }, 0)
  const cryptoCostCZK = cryptoHoldings.reduce((s, c) =>
    s + toCZK(c.avg_cost_usd * c.amount, 'USD', fx), 0)

  // Ownership share applies to the debt as well as the asset — counting 100% of
  // a mortgage against a 50%-owned property understated equity by half the loan.
  const realEstateGrossCZK = realEstate.reduce((s, p) =>
    s + toCZK(p.current_value * (p.ownership_pct / 100), p.currency, fx), 0)
  const mortgageCZK = realEstate.reduce((s, p) =>
    s + toCZK(p.mortgage_balance * (p.ownership_pct / 100), p.currency, fx), 0)
  const realEstateEquityCZK = realEstateGrossCZK - mortgageCZK
  const realEstateCostCZK = realEstate.reduce((s, p) =>
    s + toCZK(p.purchase_price * (p.ownership_pct / 100), p.currency, fx), 0)

  const totalNetWorth = stockValueCZK + cashValueCZK + cryptoValueCZK + realEstateEquityCZK
  // Cash is excluded from both sides: it has no cost basis, and including it
  // dilutes the return percentage without contributing any gain.
  const investedCZK = stockCostCZK + cryptoCostCZK + realEstateCostCZK
  const investedValueCZK = stockValueCZK + cryptoValueCZK + realEstateGrossCZK
  const totalGainCZK = investedValueCZK - investedCZK

  // ── Save today's snapshot once every asset class has priced ───────────────
  // Waiting for crypto too: saving as soon as equities landed recorded a net
  // worth with crypto still valued at cost.
  const cryptoReady = cryptoHoldings.length === 0 || cryptoPrices.state === 'done'
  const pricesReady = holdings.length === 0 || market.state === 'done'

  // Every position, normalised — also the basis for the per-currency exposure
  // recorded on the snapshot, which is what makes FX attribution possible later.
  const allPositions = useMemo(
    () => buildPositions(appData, fx, market, cryptoPrices),
    [appData, fx, market, cryptoPrices]
  )
  const exposure = useMemo(() => currencyExposure(allPositions, fx), [allPositions, fx])

  // Cash, crypto and property go through bare toCZK calls, which leave an
  // unknown currency unconverted. Collect them across every class so the banner
  // above can say the total is wrong rather than showing it as if it were fine.
  const fxProblems = useMemo(
    () => unconvertibleCurrencies(allPositions, fx),
    [allPositions, fx]
  )

  useEffect(() => {
    if (!loading && !error && fxLive && pricesReady && cryptoReady && totalNetWorth > 0) {
      saveSnapshot({
        total_value_czk: totalNetWorth,
        stocks_czk:      stockValueCZK,
        cash_czk:        cashValueCZK,
        crypto_czk:      cryptoValueCZK,
        realestate_czk:  realEstateEquityCZK,
        fx_usd: fx['USD'],
        fx_eur: fx['EUR'],
        fx_gbp: fx['GBP'],
        exposure_usd_local: exposure.usdLocal,
        exposure_eur_local: exposure.eurLocal,
        exposure_czk_local: exposure.czkLocal,
        exposure_other_czk: exposure.otherCZK,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, fxLive, pricesReady, cryptoReady, totalNetWorth, exposure])

  // ── Income ─────────────────────────────────────────────────────────────────
  const divIncomeCZK = stockTotals.annualDivCZK
  const interestIncomeCZK = bankAccounts.reduce((s, a) =>
    s + toCZK(a.balance * a.interest_rate, a.currency, fx), 0)
  const rentalIncomeCZK = realEstate.reduce((s, p) =>
    s + toCZK(p.monthly_rent * 12 * (p.ownership_pct / 100), p.currency, fx), 0)
  const stakingIncomeCZK = cryptoHoldings.reduce((s, c) => {
    const priceUSD = cryptoPrices.getPrice(c.coin_id, c.avg_cost_usd)
    return s + toCZK(priceUSD * c.amount * c.staking_apy, 'USD', fx)
  }, 0)
  const totalAnnualIncome = divIncomeCZK + interestIncomeCZK + rentalIncomeCZK + stakingIncomeCZK

  const assetBlocks: AssetBlock[] = [
    { label: 'Stocks & ETFs',  value: stockValueCZK,       color: 'var(--green)',  href: '/holdings' },
    { label: 'Cash & Savings', value: cashValueCZK,         color: 'var(--blue)',   href: '/cash' },
    { label: 'Crypto',         value: cryptoValueCZK,       color: 'var(--purple)', href: '/crypto' },
    { label: 'Real Estate',    value: realEstateEquityCZK,  color: 'var(--teal)',   href: '/realestate' },
  ]

  // Splits the net-worth curve into money added and money earned. Needs a
  // transaction ledger — without one it stays empty rather than guessing.
  const growthSplit = useMemo(
    () => contributionsVsGrowth(transactions, snapshots),
    [transactions, snapshots]
  )
  const latestSplit = growthSplit.length > 0
    ? growthSplit[growthSplit.length - 1]
    : { contributed: 0, growth: 0, date: '', value: 0 }

  const dashboardExpenses = effectiveAnnualExpenses(
    { ...DEFAULT_PLAN, ...(appData.financialPlan ?? {}) }, appData.expenseLog)

  const today = todayISO()
  const CURRENT_YEAR = yearOf(today)
  const ytdDivCZK = dividendsReceived
    .filter(d => yearOf(d.payment_date) === CURRENT_YEAR)
    .reduce((s, d) => s + toCZK(d.gross_amount, d.currency, fx), 0)

  // ── P&L chart data ─────────────────────────────────────────────────────────
  const selectedWindow = PL_WINDOWS.find(w => w.key === plWindow)!
  const plSummary = totalNetWorth > 0
    ? getPLSummary(totalNetWorth, selectedWindow.days)
    : { pl: 0, plPct: null, label: '', fromDate: null, fromValue: null }

  // Build chart data: historical snapshots + today
  const cutoff = selectedWindow.days === 'ytd'
    ? `${CURRENT_YEAR}-01-01`
    : addDays(today, -(selectedWindow.days as number))

  const chartSnapshots = snapshots.filter(s => s.snapshot_date >= cutoff)

  // Add today's live value if not already in snapshots
  const todayInSnapshots = chartSnapshots.some(s => s.snapshot_date === today)
  const chartData = [
    ...chartSnapshots.map(s => ({
      date: s.snapshot_date,
      value: s.total_value_czk,
      isToday: s.snapshot_date === today,
    })),
    ...(!todayInSnapshots && totalNetWorth > 0 ? [{
      date: today,
      value: totalNetWorth,
      isToday: true,
    }] : []),
  ].sort((a, b) => a.date.localeCompare(b.date))

  // Reference line = first value in the window
  const referenceValue = chartData.length > 0 ? chartData[0].value : null

  const plPositive = plSummary.pl >= 0
  const plColor = plPositive ? 'var(--green)' : 'var(--red)'

  const fmtAxisDate = fmtISODateShort

  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const val: number = payload[0].value
    const ref = referenceValue ?? val
    const diff = val - ref
    const diffPct = ref > 0 ? (diff / ref) * 100 : 0
    return (
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border2)',
        borderRadius: 8, padding: '10px 14px', fontSize: 11,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      }}>
        <div style={{ color: 'var(--text3)', marginBottom: 4 }}>{fmtAxisDate(label)}</div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600 }}>{fmtCZK(val)}</div>
        <div style={{ color: diff >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 2 }}>
          {diff >= 0 ? '+' : ''}{fmtCZK(diff)} ({diffPct >= 0 ? '+' : ''}{diffPct.toFixed(2)}%)
        </div>
      </div>
    )
  }

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>
        Loading wealth data…
      </main>
    </div>
  )

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '32px 40px', maxWidth: 1200 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {greeting()}
              {activeProfile && <>, <span style={{ color: 'var(--green)' }}>{activeProfile.display_name}</span></>}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refreshFx} disabled={fxLoading} style={btnSecondary}>
              {fxLoading ? '⟳' : '↻'} FX rates
              {fxTs && <span style={{ color: 'var(--green)', marginLeft: 6 }}>{fxTs}</span>}
              {!fxLoading && !fxLive && <span style={{ color: 'var(--amber)', marginLeft: 6 }}>fallback</span>}
            </button>
            <button
              onClick={() => market.refresh(holdings.map(h => h.symbol), true)}
              disabled={market.state === 'loading'}
              style={btnSecondary}
            >
              {market.state === 'loading' ? '⟳ Fetching…' : '↻ Prices'}
            </button>
          </div>
        </div>

        {/* Anything that would make the totals below wrong is stated, not hidden */}
        {(error || !fxLive || market.state === 'error' || fxProblems.length > 0 || snapshotError) && (
          <div style={{
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
                ⚠ No CZK rate for {fxProblems.join(', ')} — holdings in{' '}
                {fxProblems.length === 1 ? 'that currency is' : 'those currencies are'} counted
                into net worth <strong>unconverted</strong>, so the total below is wrong by
                whatever the real rate is.
              </div>
            )}
          </div>
        )}

        {/* Net Worth Hero */}
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 16, padding: '32px 36px', marginBottom: 20,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, var(--green) 0%, var(--blue) 40%, var(--purple) 70%, var(--teal) 100%)', opacity: 0.6 }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8, fontWeight: 500 }}>Total Net Worth</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 42, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>
                {fmtCZK(totalNetWorth)}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 16 }}>
                <div style={{ fontSize: 11, color: totalGainCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {totalGainCZK >= 0 ? '▲' : '▼'} {totalGainCZK >= 0 ? '+' : ''}{fmtCZK(totalGainCZK)} total gain
                </div>
                <div style={{ fontSize: 11, color: 'var(--text4)' }}>
                  {investedCZK > 0 ? `${((totalGainCZK / investedCZK) * 100).toFixed(1)}% on invested` : ''}
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8, fontWeight: 500 }}>Est. Annual Income</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 42, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--amber)' }}>
                {fmtCZK(totalAnnualIncome)}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--green)' }}>Dividends {fmtCZK(divIncomeCZK)}</span>
                <span style={{ fontSize: 11, color: 'var(--blue)' }}>Interest {fmtCZK(interestIncomeCZK)}</span>
                {rentalIncomeCZK > 0 && <span style={{ fontSize: 11, color: 'var(--teal)' }}>Rent {fmtCZK(rentalIncomeCZK)}</span>}
                {stakingIncomeCZK > 0 && <span style={{ fontSize: 11, color: 'var(--purple)' }}>Staking {fmtCZK(stakingIncomeCZK)}</span>}
              </div>
            </div>
          </div>

          {/* Asset allocation bar */}
          <div style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', gap: 2, height: 6, borderRadius: 4, overflow: 'hidden' }}>
              {assetBlocks.filter(a => a.value > 0).map(a => (
                <div key={a.label} style={{ flex: a.value, background: a.color, opacity: 0.8, transition: 'flex 0.6s ease' }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
              {assetBlocks.filter(a => a.value > 0).map(a => (
                <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: a.color }} />
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>{a.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text4)', fontFamily: "'DM Mono', monospace" }}>
                    {totalNetWorth > 0 ? ((a.value / totalNetWorth) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── P&L Evolution Chart ─────────────────────────────────────────── */}
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 16, padding: '24px 28px', marginBottom: 20,
        }}>
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 500, marginBottom: 6 }}>
                Portfolio P&amp;L
              </div>
              {/* P&L summary for selected window */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{
                  fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 700,
                  letterSpacing: '-0.02em', color: plColor,
                }}>
                  {plSummary.pl >= 0 ? '+' : ''}{fmtCZK(plSummary.pl)}
                </span>
                {plSummary.plPct !== null && (
                  <span style={{ fontSize: 14, color: plColor, fontFamily: "'DM Mono', monospace" }}>
                    {plSummary.plPct >= 0 ? '+' : ''}{plSummary.plPct.toFixed(2)}%
                  </span>
                )}
              </div>
              {plSummary.fromDate && (
                <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 2 }}>
                  vs {fmtAxisDate(plSummary.fromDate)}
                  {plSummary.fromValue && (
                    <span style={{ marginLeft: 6 }}>({fmtCZK(plSummary.fromValue)})</span>
                  )}
                </div>
              )}
              {snapshots.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
                  ⓘ History builds daily — check back tomorrow for trend data
                </div>
              )}
            </div>

            {/* Window selector */}
            <div style={{ display: 'flex', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden' }}>
              {PL_WINDOWS.map(w => (
                <button key={w.key} onClick={() => setPlWindow(w.key)} style={{
                  padding: '6px 16px', border: 'none', cursor: 'pointer',
                  fontSize: 12, fontFamily: "'Inter', sans-serif",
                  background: plWindow === w.key ? (plPositive ? 'var(--green-bg)' : 'var(--red-bg)') : 'var(--bg)',
                  color: plWindow === w.key ? plColor : 'var(--text3)',
                  borderRight: w.key !== 'ytd' ? '1px solid var(--border2)' : 'none',
                  fontWeight: plWindow === w.key ? 500 : 400,
                  transition: 'background 0.15s',
                }}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {/* P&L period cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
            {PL_WINDOWS.map(w => {
              const summary = totalNetWorth > 0 ? getPLSummary(totalNetWorth, w.days) : { pl: 0, plPct: null }
              const positive = summary.pl >= 0
              const color = positive ? 'var(--green)' : 'var(--red)'
              const bg    = positive ? 'var(--green-bg)' : 'var(--red-bg)'
              const bd    = positive ? 'var(--green-bd)' : 'var(--red-bd)'
              const isActive = plWindow === w.key
              return (
                <button
                  key={w.key}
                  onClick={() => setPlWindow(w.key)}
                  style={{
                    padding: '12px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                    background: isActive ? bg : 'var(--bg3)',
                    border: `1px solid ${isActive ? bd : 'var(--border)'}`,
                    transition: 'all 0.15s',
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text4)', marginBottom: 5, fontWeight: 500 }}>
                    {w.label}
                  </div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 600, color: isActive ? color : (positive ? 'var(--green)' : 'var(--red)') }}>
                    {summary.pl >= 0 ? '+' : ''}{fmtCZK(summary.pl, 0)}
                  </div>
                  {summary.plPct !== null && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                      {summary.plPct >= 0 ? '+' : ''}{summary.plPct.toFixed(2)}%
                    </div>
                  )}
                  {summary.plPct === null && (
                    <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 2 }}>no data yet</div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Area chart */}
          {chartData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="plGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={plPositive ? '#1a7a3a' : '#dc2626'} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={plPositive ? '#1a7a3a' : '#dc2626'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtAxisDate}
                  tick={{ fontSize: 10, fill: 'var(--text4)' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={n => `${(n / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 10, fill: 'var(--text4)' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<ChartTooltip />} />
                {referenceValue != null && (
                  <ReferenceLine
                    y={referenceValue}
                    stroke="var(--border2)"
                    strokeDasharray="4 4"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={plPositive ? 'var(--green)' : 'var(--red)'}
                  strokeWidth={2}
                  fill="url(#plGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: plPositive ? 'var(--green)' : 'var(--red)', strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{
              height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text4)', fontSize: 12, flexDirection: 'column', gap: 6,
              background: 'var(--bg3)', borderRadius: 10,
            }}>
              <div style={{ fontSize: 20, opacity: 0.4 }}>◎</div>
              <div>Chart builds as daily snapshots accumulate</div>
              <div style={{ fontSize: 11, color: 'var(--text4)' }}>
                {snapshots.length === 0
                  ? 'First snapshot saved today — come back tomorrow'
                  : `${snapshots.length} snapshot${snapshots.length > 1 ? 's' : ''} saved — need at least 2 to show a trend`}
              </div>
            </div>
          )}
        </div>

        {/* Asset class cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
          {assetBlocks.map((a, i) => {
            const pct = totalNetWorth > 0 ? (a.value / totalNetWorth) * 100 : 0
            const gains = i === 0 ? stockValueCZK - stockCostCZK : null
            return (
              <a key={a.label} href={a.href} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
                  padding: '18px 20px', cursor: 'pointer', position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, height: 3, width: `${pct}%`, background: a.color, opacity: 0.7, borderRadius: '0 2px 0 0', transition: 'width 0.6s ease' }} />
                  <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: a.color, marginBottom: 10, fontWeight: 600, opacity: 0.9 }}>{a.label}</div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 4 }}>{fmtCZK(a.value)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text4)' }}>
                    {pct.toFixed(1)}% of portfolio
                    {gains !== null && gains !== 0 && (
                      <span style={{ marginLeft: 8, color: gains >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {gains >= 0 ? '+' : ''}{fmtCZK(gains)} P&L
                      </span>
                    )}
                  </div>
                </div>
              </a>
            )
          })}
        </div>

        {/* Contributions vs growth — answers "did I earn this, or did I pay it in?" */}
        {growthSplit.length >= 2 && (
          <div style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '20px 22px', marginBottom: 20,
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600, marginBottom: 14 }}>
              Since {fmtISODateShort(growthSplit[0].date)}
            </div>
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 4 }}>Total change</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700, color: latestSplit.contributed + latestSplit.growth >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmtCZK(latestSplit.contributed + latestSplit.growth)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 4 }}>You contributed</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--blue)' }}>
                  {fmtCZK(latestSplit.contributed)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 4 }}>The market earned</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700, color: latestSplit.growth >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmtCZK(latestSplit.growth)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg4)' }}>
              <div style={{ flex: Math.max(0, latestSplit.contributed), background: 'var(--blue)', opacity: 0.8 }} />
              <div style={{ flex: Math.max(0, latestSplit.growth), background: 'var(--green)', opacity: 0.8 }} />
            </div>
          </div>
        )}

        {/* Bottom row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Income breakdown */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600, marginBottom: 16 }}>Income streams</div>
            {[
              { label: 'Stock dividends', value: divIncomeCZK,      sub: `YTD received: ${fmtCZK(ytdDivCZK)}`, color: 'var(--green)',  pct: totalAnnualIncome > 0 ? divIncomeCZK / totalAnnualIncome : 0 },
              { label: 'Bank interest',   value: interestIncomeCZK, sub: `${bankAccounts.length} accounts`,       color: 'var(--blue)',   pct: totalAnnualIncome > 0 ? interestIncomeCZK / totalAnnualIncome : 0 },
              { label: 'Rental income',   value: rentalIncomeCZK,   sub: `${realEstate.filter(p => p.monthly_rent > 0).length} properties`, color: 'var(--teal)', pct: totalAnnualIncome > 0 ? rentalIncomeCZK / totalAnnualIncome : 0 },
              { label: 'Crypto staking',  value: stakingIncomeCZK,  sub: `${cryptoHoldings.filter(c => c.staking_apy > 0).length} assets`, color: 'var(--purple)', pct: totalAnnualIncome > 0 ? stakingIncomeCZK / totalAnnualIncome : 0 },
            ].map(s => (
              <div key={s.label} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>{s.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--text4)', marginLeft: 8 }}>{s.sub}</span>
                  </div>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: s.value > 0 ? s.color : 'var(--text4)' }}>
                    {s.value > 0 ? fmtCZK(s.value) : '—'}
                  </span>
                </div>
                <div style={{ height: 3, background: 'var(--bg4)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${s.pct * 100}%`, background: s.color, borderRadius: 2, opacity: 0.7, transition: 'width 0.5s ease' }} />
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Total annual</span>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--amber)' }}>{fmtCZK(totalAnnualIncome)}</span>
            </div>
          </div>

          {/* Emergency runway tile */}
          <div style={{ display: 'grid', gap: 14 }}>
            <RunwayCard
              positions={allPositions}
              monthlyExpenses={dashboardExpenses.annualCZK / 12}
              accounts={bankAccounts}
              compact
            />
          </div>

          {/* Quick stats */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600, marginBottom: 16 }}>Portfolio snapshot</div>
            {[
              { label: 'Yield on net worth',     value: totalNetWorth > 0 ? `${((totalAnnualIncome / totalNetWorth) * 100).toFixed(2)}%` : '—', accent: 'var(--amber)' },
              { label: 'Monthly passive income', value: fmtCZK(totalAnnualIncome / 12, 0), accent: 'var(--amber)' },
              { label: 'Stock P&L',              value: `${stockCostCZK > 0 ? ((stockValueCZK - stockCostCZK) / stockCostCZK * 100).toFixed(1) : 0}%`, accent: (stockValueCZK - stockCostCZK) >= 0 ? 'var(--green)' : 'var(--red)' },
              { label: 'Real estate equity',     value: `${realEstateGrossCZK > 0 ? ((realEstateEquityCZK / realEstateGrossCZK) * 100).toFixed(0) : 0}% equity`, accent: 'var(--teal)' },
              { label: 'Holdings', value: `${holdings.length} stocks · ${bankAccounts.length} accounts · ${cryptoHoldings.length} coins · ${realEstate.length} properties`, accent: 'var(--text3)' },
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{s.label}</span>
                <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: s.accent }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  )
}

const btnSecondary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg3)', border: '1px solid var(--border2)',
  color: 'var(--text2)', fontFamily: "'Inter', sans-serif", fontSize: 12,
  display: 'flex', alignItems: 'center', gap: 4,
}
