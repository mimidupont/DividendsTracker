'use client'
import { useEffect, useMemo, useState } from 'react'
import Badge from '@/components/Badge'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import { useAppData } from '@/hooks/useAppData'
import { usePortfolioSnapshots } from '@/hooks/usePortfolioSnapshots'
import { useBenchmarkPrices } from '@/hooks/useBenchmarkPrices'
import { RouteTabs, RETURNS_TABS } from '@/components/Sidebar'
import {
  shadowPortfolio, buyAndHold, fxByDateFromSnapshots, commonWindow, clipSeries,
  trackingDifference, windowStart, benchmarkReturn, BENCHMARK_OPTIONS, type BenchmarkWindow,
} from '@/lib/benchmark'
import SetupNotice from '@/components/SetupNotice'
import { useFx } from '@/hooks/useFx'
import { fxRate } from '@/lib/fx'
import { twr, twrIndex, xirr, maxDrawdown, type ValuePoint } from '@/lib/returns'
import { externalFlows } from '@/lib/transactions'
import { fmtCZK, fmtSignedCZK, fmtPct } from '@/lib/fx'
import { signColor } from '@/lib/ui'
import { todayISO, fmtISODate, fmtISODateShort } from '@/lib/date'
import { tdR, tdL, th, btnStyle } from '@/lib/ui'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'

const WINDOWS: BenchmarkWindow[] = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL']

export default function BenchmarkPage() {
  const { transactions, loading, missingTables } = useAppData()
  const { snapshots } = usePortfolioSnapshots()
  const { fx } = useFx()

  const [symbol, setSymbol] = useState('SPY')
  // Named `range`, not `window`: a state variable called `window` shadows the
  // global inside this component, so any future `typeof window` guard here would
  // silently read React state instead.
  const [range, setRange] = useState<BenchmarkWindow>('ALL')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  // Paged: a five-year daily history is more than PostgREST's 1 000-row cap,
  // and a single select silently dropped the most recent years.
  const { prices, loading: loadingPrices, error: priceError, missingTable: priceTableMissing, reload: reloadPrices } =
    useBenchmarkPrices(symbol)

  const sync = async () => {
    setSyncing(true)
    setSyncError('')
    try {
      const res = await fetch('/api/benchmark/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
      const json = await res.json()
      const result = json?.results?.[symbol]
      if (!res.ok || result?.error) {
        setSyncError(result?.error ?? json?.error ?? 'Sync failed')
        return
      }
      await reloadPrices()
    } catch (e) {
      setSyncError(String(e))
    } finally {
      setSyncing(false)
    }
  }

  const currency = BENCHMARK_OPTIONS.find(b => b.symbol === symbol)?.currency ?? 'USD'

  const mySeries: ValuePoint[] = useMemo(
    () => snapshots.map(s => ({ date: s.snapshot_date, value: s.total_value_czk })),
    [snapshots]
  )

  const flows = useMemo(() => externalFlows(transactions), [transactions])
  // Snapshots carry the rate each value was struck at. When none do — an older
  // install, or one that has only just started recording — fall back to today's
  // rate so the page still works, and say so below.
  const liveRate = fxRate(currency, fx)
  const fxByDate = useMemo(
    () => fxByDateFromSnapshots(snapshots, currency, liveRate),
    [snapshots, currency, liveRate]
  )
  const usingFallbackFx = snapshots.length > 0 &&
    !snapshots.some(s => (currency === 'USD' ? s.fx_usd : currency === 'EUR' ? s.fx_eur : 1) != null)

  // Two comparison modes. The shadow portfolio replays your real cash flows and
  // is the honest answer; buy-and-hold needs no ledger at all and is what makes
  // this page usable before any transactions have been entered.
  const hasFlows = flows.length > 0

  // Seeded with what you already owned at your first snapshot, then your
  // flows replayed on top — otherwise the shadow started at the first logged
  // deposit while your side started at your whole net worth.
  const shadow = useMemo(
    () => hasFlows && mySeries.length > 0
      ? shadowPortfolio(flows, prices, fxByDate, { openingValueCZK: mySeries[0].value, from: mySeries[0].date })
      : [],
    [hasFlows, flows, prices, fxByDate, mySeries]
  )

  const lumpSum = useMemo(() => {
    if (hasFlows || snapshots.length === 0) return []
    const first = snapshots[0]
    return buyAndHold(first.total_value_czk, prices, fxByDate, first.snapshot_date)
      .map(p => ({ date: p.date, valueCZK: p.valueCZK, units: 0 }))
  }, [hasFlows, snapshots, prices, fxByDate])

  const benchSeries = hasFlows ? shadow : lumpSum

  // Compare only where both series have data, and say so.
  const overlap = useMemo(
    () => commonWindow(mySeries, benchSeries.map(s => ({ date: s.date }))),
    [mySeries, benchSeries]
  )

  const start = windowStart(range, todayISO())
  const from = overlap ? (start && start > overlap.from ? start : overlap.from) : null
  const to = overlap?.to ?? null

  const clippedMine = useMemo(
    () => (from && to ? clipSeries(mySeries, from, to) : []),
    [mySeries, from, to]
  )
  const clippedBench = useMemo(
    () => (from && to
      ? clipSeries(benchSeries.map(s => ({ date: s.date, value: s.valueCZK })), from, to)
      : []),
    [benchSeries, from, to]
  )

  // Both lines are performance, not balances: your time-weighted return (so a
  // deposit is not a jump) against the index's own price-and-FX return.
  const indexedMine = useMemo(() => twrIndex(clippedMine, flows), [clippedMine, flows])
  const indexedBench = useMemo(() => {
    if (!from || !to) return []
    const px = prices.filter(p => p.price_date >= from && p.price_date <= to)
      .map(p => {
        const r = benchmarkReturn(prices, fxByDate, from, p.price_date)
        return r == null ? null : { date: p.price_date, value: 100 * (1 + r) }
      })
      .filter((p): p is ValuePoint => p != null)
    return px.length ? [{ date: from, value: 100 }, ...px.filter(p => p.date > from)] : []
  }, [prices, fxByDate, from, to])

  const chartData = useMemo(() => {
    const benchByDate: Record<string, number> = {}
    for (const b of indexedBench) benchByDate[b.date] = b.value
    return indexedMine
      .filter(m => benchByDate[m.date] != null)
      .map(m => ({ date: m.date, mine: m.value, bench: benchByDate[m.date] }))
  }, [indexedMine, indexedBench])

  const myTwr = twr(clippedMine, flows)
  const benchTwr = from && to ? benchmarkReturn(prices, fxByDate, from, to) : null
  const myDd = maxDrawdown(clippedMine)
  const benchDd = maxDrawdown(clippedBench)
  const diff = trackingDifference(indexedMine, indexedBench)

  // XIRR over the *same* window as every neighbouring metric. Reporting an
  // all-time money-weighted return beside a windowed TWR gave two numbers that
  // could not be reconciled.
  //
  // The opening balance enters as a negative flow on the first day: money
  // already invested at the window start is capital employed, and omitting it
  // treats the starting balance as free and inflates the rate.
  const myXirr = useMemo(() => {
    if (clippedMine.length < 2) return null
    const opening = clippedMine[0]
    const terminal = clippedMine[clippedMine.length - 1]
    return xirr([
      { date: new Date(opening.date), amount: -opening.value },
      ...flows
        .filter(f => f.date > opening.date && f.date <= terminal.date)
        .map(f => ({ date: new Date(f.date), amount: -f.amountCZK })),
      { date: new Date(terminal.date), amount: terminal.value },
    ])
  }, [flows, clippedMine])

  const shadowToday = benchSeries.length > 0 ? benchSeries[benchSeries.length - 1].valueCZK : null
  const mineToday = mySeries.length > 0 ? mySeries[mySeries.length - 1].value : null

  if (loading) return <LoadingShell label="Loading benchmark…" />

  const noPrices = prices.length === 0
  const noHistory = mySeries.length < 2

  return (
    <PageShell maxWidth={1100}>
      <PageHeader
        eyebrow="Analysis"
        title="Returns vs benchmark"
        subtitle="Your time-weighted return against an index, and your cash flows replayed into it"
        actions={
          <>
            <select aria-label="Benchmark" value={symbol} onChange={e => setSymbol(e.target.value)} style={{
              padding: '7px 12px', borderRadius: 6, background: 'var(--bg2)',
              border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 12,
            }}>
              {BENCHMARK_OPTIONS.map(b => <option key={b.symbol} value={b.symbol}>{b.label}</option>)}
            </select>
            <button type="button" onClick={sync} disabled={syncing} style={btnStyle('secondary')}>
              {syncing ? 'Syncing…' : '↻ Sync prices'}
            </button>
          </>
        }
      />

      <RouteTabs tabs={RETURNS_TABS} />

      <SetupNotice
        tables={[
          ...missingTables.filter(t => t === 'transactions'),
          ...(priceTableMissing ? ['benchmark_prices'] : []),
        ]}
      />

      {priceError && (
        <div style={{
          background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)', color: 'var(--amber)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 11, lineHeight: 1.6,
        }}>
          ⚠ Could not read stored benchmark prices: {priceError}
        </div>
      )}

      {!noPrices && !noHistory && (
        <div style={{
          background: hasFlows ? 'var(--green-bg)' : 'var(--bg3)',
          border: `1px solid ${hasFlows ? 'var(--green-bd)' : 'var(--border)'}`,
          borderRadius: 8, padding: '10px 14px', marginBottom: 14,
          fontSize: 11, color: hasFlows ? 'var(--green)' : 'var(--text3)', lineHeight: 1.7,
        }}>
          {hasFlows
            ? <>Comparing with <strong>your actual cash flows</strong> replayed into {symbol} — {flows.length} external movements from the ledger.</>
            : <>No deposits or withdrawals in the ledger, so the “what if” below is <strong>buy-and-hold</strong>: your first snapshot invested in {symbol} on that date. Record deposits (Record → Deposit) for a flow-adjusted comparison.</>}
          {' '}Index prices include reinvested dividends (adjusted close).
          {usingFallbackFx && <> · Historical FX rates are missing from your snapshots, so today&rsquo;s rate is used throughout — the currency component of the comparison is approximate.</>}
        </div>
      )}

      {syncError && (
        <div style={{
          background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)', color: 'var(--amber)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 11, lineHeight: 1.6,
        }}>
          ⚠ Could not sync benchmark prices: {syncError}. Yahoo&rsquo;s history endpoint is
          scraped rather than an official API, so it fails from time to time — the comparison
          below uses whatever history is already stored.
        </div>
      )}

      {(noPrices || noHistory) && !loadingPrices && (
        <EmptyState
          icon="⚖"
          title="Not enough data to compare yet"
          body={
            <>
              <span style={{ color: noPrices ? 'var(--amber)' : 'var(--green)' }}>
                {noPrices ? '○' : '●'} benchmark price history
              </span>{noPrices && ' — press “Sync prices” above'}
              <br />
              <span style={{ color: noHistory ? 'var(--amber)' : 'var(--green)' }}>
                {noHistory ? '○' : '●'} at least two daily snapshots of your own portfolio
              </span>{noHistory && ' — one is written each day by the scheduled job, or whenever you open the dashboard'}
              <br /><br />
              A transaction ledger is <em>not</em> required. With one, your real cash flows are
              replayed into the index; without one, the comparison falls back to buy-and-hold
              from your first snapshot.
            </>
          }
        />
      )}

      {/* Window selector sits outside the chart block on purpose: when a narrow
          window empties the comparison, the control that got you there has to
          stay on screen. */}
      {!noPrices && !noHistory && (
        <div style={{ display: 'flex', border: '1px solid var(--border2)', borderRadius: 6, overflow: 'hidden', marginBottom: 14, width: 'fit-content' }}>
          {WINDOWS.map(w => (
            <button key={w} type="button" aria-pressed={range === w} onClick={() => setRange(w)} style={{
              padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 11,
              background: range === w ? 'var(--bg4)' : 'var(--bg2)',
              color: range === w ? 'var(--text)' : 'var(--text3)',
              borderRight: w !== 'ALL' ? '1px solid var(--border2)' : 'none',
            }}>{w}</button>
          ))}
        </div>
      )}

      {/* Both series exist but never on the same dates — a stale price sync, or
          snapshots that all predate the stored history. Without this the page
          rendered a header and nothing else, with no hint why. */}
      {!noPrices && !noHistory && chartData.length < 2 && (
        <EmptyState
          icon="⚖"
          title="No overlapping dates to compare"
          body={
            <>
              You have {mySeries.length} portfolio snapshots ({fmtISODate(mySeries[0].date)} –{' '}
              {fmtISODate(mySeries[mySeries.length - 1].date)}) and {prices.length} price rows for{' '}
              {symbol}
              {benchSeries.length > 0
                ? <> ({fmtISODate(benchSeries[0].date)} – {fmtISODate(benchSeries[benchSeries.length - 1].date)})</>
                : null}
              , but the two ranges do not overlap on at least two days.
              <br /><br />
              Press “Sync prices” to pull fresh history
              {range !== 'ALL' && <>, or switch the window back to <strong>ALL</strong></>}.
            </>
          }
        />
      )}

      {!noPrices && !noHistory && chartData.length >= 2 && (
        <>
          <MetricCards
            columns={5}
            cards={[
              {
                label: 'Your return (TWR)',
                value: fmtPct(myTwr != null ? myTwr * 100 : null),
                accent: signColor(myTwr),
                color: signColor(myTwr),
                note: 'time-weighted — deposits excluded',
              },
              {
                label: 'Index return',
                value: fmtPct(benchTwr != null ? benchTwr * 100 : null),
                accent: 'var(--blue)',
                note: `${symbol} in CZK, same window`,
              },
              {
                label: 'Difference',
                value: orDash(diff, n => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)} pts`),
                accent: signColor(diff),
                color: signColor(diff),
                note: 'you minus index, indexed to 100',
              },
              {
                label: 'Your XIRR',
                value: orDash(myXirr, n => `${(n * 100).toFixed(2)}%`),
                accent: 'var(--amber)',
                note: 'money-weighted',
              },
              {
                label: 'Max drawdown',
                value: orDash(myDd?.pct, n => `${(n * 100).toFixed(1)}%`),
                accent: 'var(--red)',
                color: 'var(--red)',
                note: benchDd ? `index ${(benchDd.pct * 100).toFixed(1)}%` : undefined,
              },
            ]}
          />

          <Panel title={`You vs ${symbol}, performance indexed to 100`}>
            <div role="img" aria-label={`Indexed performance: you ${chartData[chartData.length - 1].mine.toFixed(1)}, ${symbol} ${chartData[chartData.length - 1].bench.toFixed(1)}`}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text3)' }}
                  tickFormatter={fmtISODateShort} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text3)' }} width={44} domain={['auto', 'auto']} />
                <Tooltip
                  formatter={(v: number) => v.toFixed(1)}
                  labelFormatter={fmtISODate}
                  contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="mine" name="You (time-weighted)" stroke="var(--green)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="bench" name={symbol} stroke="var(--blue)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
            </div>
            {from && to && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)' }}>
                Comparing {fmtISODate(from)} – {fmtISODate(to)}, the period where both series have data.
              </div>
            )}
          </Panel>

          {/* Shadow portfolio */}
          <Panel title="What if you had just bought the index?">
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Your portfolio today
                </div>
                <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 24, color: 'var(--green)' }}>
                  {orDash(mineToday, fmtCZK)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  {hasFlows ? `Same money in ${symbol}` : `Buy-and-hold ${symbol}`}
                </div>
                <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 24, color: 'var(--blue)' }}>
                  {orDash(shadowToday, fmtCZK)}
                </div>
              </div>
              {mineToday != null && shadowToday != null && (
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                    Difference
                  </div>
                  <div style={{
                    fontFamily: "'Instrument Serif', serif", fontSize: 24,
                    color: signColor(mineToday - shadowToday),
                  }}>
                    {fmtSignedCZK(mineToday - shadowToday)}
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text3)', lineHeight: 1.7 }}>
              {hasFlows
                ? <>What you owned at your first snapshot, plus every deposit since, bought into {symbol} on the same day at that day&rsquo;s price and exchange rate (withdrawals sold).</>
                : <>Your portfolio&rsquo;s value at the first snapshot, invested in {symbol} on that date and held. This ignores anything you paid in since — add transactions for a flow-adjusted comparison.</>}
              {' '}A Czech investor&rsquo;s index return includes the currency move, and it is
              included here.
            </div>
          </Panel>
        </>
      )}

      {!noPrices && (
        <div style={{
          background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '10px 14px', fontSize: 11, color: 'var(--text3)', lineHeight: 1.7,
        }}>
          ⓘ This comparison is only as good as the transaction history behind it. Missing or
          mis-dated flows move the shadow portfolio, and a ledger that starts part-way through
          will understate how long your money has been invested.
          {' '}{prices.length} price rows stored for {symbol}.
        </div>
      )}
    </PageShell>
  )
}
