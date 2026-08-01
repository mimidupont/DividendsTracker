'use client'
import { useEffect, useMemo, useState } from 'react'
import Badge from '@/components/Badge'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import { useAppData } from '@/hooks/useAppData'
import { usePortfolioSnapshots } from '@/hooks/usePortfolioSnapshots'
import { supabase, type BenchmarkPrice } from '@/lib/supabase'
import {
  shadowPortfolio, fxByDateFromSnapshots, commonWindow, clipSeries,
  trackingDifference, windowStart, BENCHMARK_OPTIONS, type BenchmarkWindow,
} from '@/lib/benchmark'
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
  const { transactions, loading } = useAppData()
  const { snapshots } = usePortfolioSnapshots()

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
  const fxByDate = useMemo(
    () => fxByDateFromSnapshots(snapshots, currency),
    [snapshots, currency]
  )

  const shadow = useMemo(
    () => shadowPortfolio(flows, prices, fxByDate),
    [flows, prices, fxByDate]
  )

  // Compare only where both series have data, and say so.
  const overlap = useMemo(
    () => commonWindow(mySeries, shadow.map(s => ({ date: s.date }))),
    [mySeries, shadow]
  )

  const start = windowStart(window, todayISO())
  const from = overlap ? (start && start > overlap.from ? start : overlap.from) : null
  const to = overlap?.to ?? null

  const clippedMine = from && to ? clipSeries(mySeries, from, to) : []
  const clippedBench = from && to
    ? clipSeries(shadow.map(s => ({ date: s.date, value: s.valueCZK })), from, to)
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

  const shadowToday = shadow.length > 0 ? shadow[shadow.length - 1].valueCZK : null
  const mineToday = mySeries.length > 0 ? mySeries[mySeries.length - 1].value : null

  if (loading) return <LoadingShell label="Loading benchmark…" />

  const noPrices = prices.length === 0
  const noHistory = mySeries.length < 2
  const noFlows = flows.length === 0

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

      {(noPrices || noHistory || noFlows) && !loadingPrices && (
        <EmptyState
          icon="⚖"
          title="Not enough data to compare yet"
          body={
            <>
              An honest comparison needs three things:
              <br /><br />
              <span style={{ color: noPrices ? 'var(--amber)' : 'var(--green)' }}>
                {noPrices ? '○' : '●'} benchmark price history
              </span>{noPrices && ' — press “Sync prices”'}
              <br />
              <span style={{ color: noHistory ? 'var(--amber)' : 'var(--green)' }}>
                {noHistory ? '○' : '●'} at least two daily snapshots of your own portfolio
              </span>{noHistory && ' — these accrue automatically'}
              <br />
              <span style={{ color: noFlows ? 'var(--amber)' : 'var(--green)' }}>
                {noFlows ? '○' : '●'} external cash flows in the ledger
              </span>{noFlows && ' — add deposits on /transactions'}
              <br /><br />
              Without the flows, the index would be compared on a buy-and-hold basis that you
              never actually followed.
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

          {/* Window selector */}
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
                  Same money in {symbol}
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
              Every external contribution you made was bought into {symbol} on the same day, at
              that day&rsquo;s price and exchange rate. A Czech investor&rsquo;s index return
              includes the currency move, and it is included here.
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
