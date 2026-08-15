'use client'
import { useEffect, useMemo, useState } from 'react'
import Badge from '@/components/Badge'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import { useAppData } from '@/hooks/useAppData'
import { usePortfolioSnapshots } from '@/hooks/usePortfolioSnapshots'
import { supabase, type BenchmarkPrice } from '@/lib/supabase'
import {
  shadowPortfolio, buyAndHold, fxByDateFromSnapshots, commonWindow, clipSeries,
  trackingDifference, windowStart, BENCHMARK_OPTIONS, type BenchmarkWindow,
} from '@/lib/benchmark'
import SetupNotice from '@/components/SetupNotice'
import { useFx } from '@/hooks/useFx'
import { fxRate } from '@/lib/fx'
import { indexTo100, twr, xirr, maxDrawdown, type ValuePoint } from '@/lib/returns'
import { externalFlows } from '@/lib/transactions'
import { fmtCZK } from '@/lib/fx'
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
  const [window, setWindow] = useState<BenchmarkWindow>('ALL')
  const [prices, setPrices] = useState<BenchmarkPrice[]>([])
  const [syncing, setSyncing] = useState(false)
  const [loadingPrices, setLoadingPrices] = useState(true)
  const [syncError, setSyncError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoadingPrices(true)
    supabase.from('benchmark_prices').select('*').eq('symbol', symbol).order('price_date')
      .then(({ data }) => {
        if (cancelled) return
        setPrices((data ?? []) as BenchmarkPrice[])
        setLoadingPrices(false)
      })
    return () => { cancelled = true }
  }, [symbol])

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
      const { data } = await supabase.from('benchmark_prices').select('*')
        .eq('symbol', symbol).order('price_date')
      setPrices((data ?? []) as BenchmarkPrice[])
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

  const shadow = useMemo(
    () => hasFlows ? shadowPortfolio(flows, prices, fxByDate) : [],
    [hasFlows, flows, prices, fxByDate]
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

  const start = windowStart(window, todayISO())
  const from = overlap ? (start && start > overlap.from ? start : overlap.from) : null
  const to = overlap?.to ?? null

  const clippedMine = from && to ? clipSeries(mySeries, from, to) : []
  const clippedBench = from && to
    ? clipSeries(benchSeries.map(s => ({ date: s.date, value: s.valueCZK })), from, to)
    : []

  const indexedMine = indexTo100(clippedMine)
  const indexedBench = indexTo100(clippedBench)

  const chartData = useMemo(() => {
    const benchByDate: Record<string, number> = {}
    for (const b of indexedBench) benchByDate[b.date] = b.value
    return indexedMine
      .filter(m => benchByDate[m.date] != null)
      .map(m => ({ date: m.date, mine: m.value, bench: benchByDate[m.date] }))
  }, [indexedMine, indexedBench])

  const myTwr = twr(clippedMine, flows)
  const benchTwr = clippedBench.length >= 2 && clippedBench[0].value > 0
    ? clippedBench[clippedBench.length - 1].value / clippedBench[0].value - 1
    : null
  const myDd = maxDrawdown(clippedMine)
  const benchDd = maxDrawdown(clippedBench)
  const diff = trackingDifference(indexedMine, indexedBench)

  // XIRR needs contributions negative and the terminal value positive
  const myXirr = useMemo(() => {
    if (mySeries.length === 0) return null
    const terminal = mySeries[mySeries.length - 1]
    return xirr([
      ...flows.map(f => ({ date: new Date(f.date), amount: -f.amountCZK })),
      { date: new Date(terminal.date), amount: terminal.value },
    ])
  }, [flows, mySeries])

  const shadowToday = benchSeries.length > 0 ? benchSeries[benchSeries.length - 1].valueCZK : null
  const mineToday = mySeries.length > 0 ? mySeries[mySeries.length - 1].value : null

  if (loading) return <LoadingShell label="Loading benchmark…" />

  const noPrices = prices.length === 0
  const noHistory = mySeries.length < 2

  return (
    <PageShell maxWidth={1100}>
      <PageHeader
        title="Benchmark"
        subtitle="Your cash flows replayed into an index — the only comparison that is not rigged by timing"
        actions={
          <>
            <select value={symbol} onChange={e => setSymbol(e.target.value)} style={{
              padding: '7px 12px', borderRadius: 6, background: 'var(--bg2)',
              border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 12,
            }}>
              {BENCHMARK_OPTIONS.map(b => <option key={b.symbol} value={b.symbol}>{b.label}</option>)}
            </select>
            <button onClick={sync} disabled={syncing} style={btnStyle('secondary')}>
              {syncing ? 'Syncing…' : '↻ Sync prices'}
            </button>
          </>
        }
      />

      <SetupNotice tables={missingTables.filter(t => t === 'transactions')} />

      {!noPrices && !noHistory && (
        <div style={{
          background: hasFlows ? 'var(--green-bg)' : 'var(--bg3)',
          border: `1px solid ${hasFlows ? 'var(--green-bd)' : 'var(--border)'}`,
          borderRadius: 8, padding: '10px 14px', marginBottom: 14,
          fontSize: 11, color: hasFlows ? 'var(--green)' : 'var(--text3)', lineHeight: 1.7,
        }}>
          {hasFlows
            ? <>Comparing with <strong>your actual cash flows</strong> replayed into {symbol} — {flows.length} external movements from the ledger.</>
            : <>No external cash flows in the ledger, so this compares <strong>buy-and-hold</strong>: your first snapshot invested in {symbol} on that date. Add deposits and withdrawals on <code>/transactions</code> for a flow-adjusted comparison.</>}
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
            <button key={w} onClick={() => setWindow(w)} style={{
              padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 11,
              background: window === w ? 'var(--green-bg)' : 'var(--bg2)',
              color: window === w ? 'var(--green)' : 'var(--text3)',
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
              {window !== 'ALL' && <>, or switch the window back to <strong>ALL</strong></>}.
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
                value: orDash(myTwr, n => `${(n * 100).toFixed(2)}%`),
                accent: (myTwr ?? 0) >= 0 ? 'var(--green)' : 'var(--red)',
                color: (myTwr ?? 0) >= 0 ? 'var(--green)' : 'var(--red)',
                note: 'time-weighted',
              },
              {
                label: 'Benchmark return',
                value: orDash(benchTwr, n => `${(n * 100).toFixed(2)}%`),
                accent: 'var(--blue)',
                note: symbol,
              },
              {
                label: 'Difference',
                value: orDash(diff, n => `${n >= 0 ? '+' : ''}${n.toFixed(1)} pts`),
                accent: (diff ?? 0) >= 0 ? 'var(--green)' : 'var(--red)',
                color: (diff ?? 0) >= 0 ? 'var(--green)' : 'var(--red)',
                note: 'indexed to 100',
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

          <Panel title={`You vs ${symbol}, indexed to 100`}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text3)' }}
                  tickFormatter={fmtISODateShort} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} width={44} domain={['auto', 'auto']} />
                <Tooltip
                  formatter={(v: number) => v.toFixed(1)}
                  labelFormatter={fmtISODate}
                  contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="mine" name="You" stroke="var(--green)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="bench" name={symbol} stroke="var(--blue)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
            {from && to && (
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text4)' }}>
                Comparing {fmtISODate(from)} – {fmtISODate(to)}, the period where both series have data.
              </div>
            )}
          </Panel>

          {/* Shadow portfolio */}
          <Panel title="What if you had just bought the index?">
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text4)', marginBottom: 6 }}>
                  Your portfolio today
                </div>
                <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 24, color: 'var(--green)' }}>
                  {orDash(mineToday, fmtCZK)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text4)', marginBottom: 6 }}>
                  {hasFlows ? `Same money in ${symbol}` : `Buy-and-hold ${symbol}`}
                </div>
                <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 24, color: 'var(--blue)' }}>
                  {orDash(shadowToday, fmtCZK)}
                </div>
              </div>
              {mineToday != null && shadowToday != null && (
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text4)', marginBottom: 6 }}>
                    Difference
                  </div>
                  <div style={{
                    fontFamily: "'Instrument Serif', serif", fontSize: 24,
                    color: mineToday >= shadowToday ? 'var(--green)' : 'var(--red)',
                  }}>
                    {mineToday >= shadowToday ? '+' : ''}{fmtCZK(mineToday - shadowToday)}
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text3)', lineHeight: 1.7 }}>
              {hasFlows
                ? <>Every external contribution you made was bought into {symbol} on the same day, at that day&rsquo;s price and exchange rate.</>
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
