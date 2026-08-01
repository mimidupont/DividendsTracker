'use client'
import { useEffect, useMemo, useState } from 'react'
import Badge from '@/components/Badge'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import { useAppData } from '@/hooks/useAppData'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { buildPositions, totalsByClass, type AssetClass } from '@/lib/portfolio'
import { runMonteCarlo, DEFAULT_ASSUMPTIONS, probabilityByYear, type McResult, type MarketAssumptionInput } from '@/lib/montecarlo'
import { DEFAULT_PLAN, effectiveAnnualExpenses, fiNumber } from '@/lib/fire'
import { ASSET_CLASS_LABELS } from '@/lib/risk'
import { fmtCZK } from '@/lib/fx'
import { tdR, tdL, th, btnStyle, inputStyle } from '@/lib/ui'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

export default function ProjectionPage() {
  const data = useAppData()
  const { fx } = useFx()
  const market = useMarketData()
  const crypto = useCryptoPrices()

  const [years, setYears] = useState(20)
  const [sims, setSims] = useState(2000)
  const [seed, setSeed] = useState(12345)
  const [contribution, setContribution] = useState<number | null>(null)
  const [assumptions, setAssumptions] = useState<MarketAssumptionInput[]>(DEFAULT_ASSUMPTIONS)
  const [result, setResult] = useState<McResult | null>(null)
  const [running, setRunning] = useState(false)

  const symbolKey = data.holdings.map(h => h.symbol).join(',')
  const coinKey = data.cryptoHoldings.map(c => c.coin_id).join(',')
  useEffect(() => { if (symbolKey) market.refresh(symbolKey.split(',')) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbolKey])
  useEffect(() => { if (coinKey) crypto.refresh(coinKey.split(',')) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coinKey])

  const positions = useMemo(
    () => buildPositions(data, fx, market, crypto),
    [data, fx, market, crypto]
  )

  const plan = { ...DEFAULT_PLAN, ...(data.financialPlan ?? {}) }
  const expenses = effectiveAnnualExpenses(plan, data.expenseLog)
  const target = fiNumber(expenses.annualCZK, plan.swr_pct)
  const monthlyContribution = contribution ?? plan.monthly_contribution_czk

  const startByClass = useMemo(() => {
    const totals = totalsByClass(positions)
    const out: Partial<Record<AssetClass, number>> = {}
    for (const k of Object.keys(totals) as AssetClass[]) {
      if (totals[k] > 0) out[k] = totals[k]
    }
    return out
  }, [positions])

  const startTotal = Object.values(startByClass).reduce((s, v) => s + (v ?? 0), 0)

  // Stored assumptions override the defaults when present
  useEffect(() => {
    if (data.marketAssumptions.length === 0) return
    setAssumptions(DEFAULT_ASSUMPTIONS.map(d => {
      const stored = data.marketAssumptions.find(a => a.asset_class === d.assetClass)
      return stored
        ? { assetClass: d.assetClass, expectedRealReturn: stored.expected_real_return, volatility: stored.volatility }
        : d
    }))
  }, [data.marketAssumptions])

  const run = () => {
    if (startTotal <= 0) return
    setRunning(true)
    // Yield to the browser so the button's loading state paints before the
    // simulation blocks. 2000 × 240 months is fast enough not to need a worker,
    // but not so fast that a frozen button looks intentional.
    setTimeout(() => {
      try {
        setResult(runMonteCarlo({
          startValueByClass: startByClass,
          monthlyContributionCZK: monthlyContribution,
          contributionGrowthPct: 0.02,
          years, simulations: sims, assumptions, seed,
          targetCZK: target ?? undefined,
        }))
      } finally {
        setRunning(false)
      }
    }, 20)
  }

  // Run once when positions first become available
  useEffect(() => {
    if (startTotal > 0 && result == null && !running) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTotal])

  if (data.loading) return <LoadingShell label="Loading projection…" />

  if (startTotal <= 0) {
    return (
      <PageShell>
        <PageHeader title="Projection" subtitle="Monte Carlo simulation" />
        <EmptyState icon="◠" title="Nothing to project"
          body="Add holdings, cash, crypto or property first — the simulation starts from what you actually own." />
      </PageShell>
    )
  }

  const chartData = result?.percentiles.map(p => ({
    year: p.year,
    p5: p.p5,
    band25: p.p25 - p.p5,
    band50: p.p50 - p.p25,
    band75: p.p75 - p.p50,
    band95: p.p95 - p.p75,
    median: p.p50,
  })) ?? []

  // Histogram of ending values
  const histogram = useMemo(() => {
    if (!result) return []
    const vals = result.finalDistribution
    if (vals.length === 0) return []
    const min = vals[0]
    const max = vals[vals.length - 1]
    const buckets = 24
    const width = (max - min) / buckets || 1
    const counts = new Array(buckets).fill(0)
    for (const v of vals) {
      const i = Math.min(buckets - 1, Math.floor((v - min) / width))
      counts[i]++
    }
    return counts.map((count, i) => ({
      value: min + width * (i + 0.5),
      count,
      label: fmtCZK(min + width * (i + 0.5), 0),
    }))
  }, [result])

  return (
    <PageShell maxWidth={1100}>
      <PageHeader
        title="Projection"
        subtitle={`Monte Carlo from ${fmtCZK(startTotal)} · real (after-inflation) returns · seed ${seed}`}
        actions={
          <button onClick={run} disabled={running} style={btnStyle('primary')}>
            {running ? 'Simulating…' : '↻ Re-run'}
          </button>
        }
      />

      {result && (
        <>
          <MetricCards
            columns={4}
            cards={[
              { label: `Median in ${years}y`, value: fmtCZK(result.finalValues.p50), accent: 'var(--green)', note: `${result.simulations.toLocaleString()} simulations` },
              { label: '90% range', value: `${fmtCZK(result.finalValues.p5, 0)} – ${fmtCZK(result.finalValues.p95, 0)}`, accent: 'var(--blue)', note: 'p5 to p95' },
              {
                label: 'Chance of FI number',
                value: orDash(result.probabilityOfTarget, n => `${(n * 100).toFixed(0)}%`),
                accent: 'var(--amber)',
                note: target != null ? `target ${fmtCZK(target)}` : 'set expenses on /fire',
              },
              {
                label: 'Median year reaching it',
                value: orDash(result.medianYearReachingTarget, n => `${n.toFixed(1)}y`),
                accent: 'var(--teal)',
                note: result.medianYearReachingTarget == null ? 'not reached in half of runs' : undefined,
              },
            ]}
          />

          <div style={{
            background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
            padding: '16px 20px', marginBottom: 14, fontSize: 13, color: 'var(--text2)', lineHeight: 1.7,
          }}>
            Median outcome in {years} years: <strong style={{ color: 'var(--green)' }}>{fmtCZK(result.finalValues.p50)}</strong>.
            {' '}90% of outcomes fall between <strong>{fmtCZK(result.finalValues.p5)}</strong> and{' '}
            <strong>{fmtCZK(result.finalValues.p95)}</strong>.
          </div>

          {/* Fan chart */}
          <Panel title="Range of outcomes" right={<Badge variant="gray">p5–p95</Badge>}>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 9, fill: 'var(--text3)' }}
                  tickFormatter={y => `${y}y`} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} width={64}
                  tickFormatter={n => `${(n / 1_000_000).toFixed(1)}M`} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: number, name: string) => [fmtCZK(v), name]}
                  labelFormatter={(y: number) => `Year ${y} · ${new Date().getFullYear() + y}`}
                  contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 11 }}
                />
                {target != null && (
                  <ReferenceLine y={target} stroke="var(--green)" strokeDasharray="4 4"
                    label={{ value: 'FI number', fontSize: 9, fill: 'var(--green)', position: 'insideTopRight' }} />
                )}
                {/* Stacked bands produce the fan; the p5 base is transparent */}
                <Area type="monotone" dataKey="p5" stackId="1" stroke="none" fill="transparent" name="p5" />
                <Area type="monotone" dataKey="band25" stackId="1" stroke="none" fill="var(--blue)" fillOpacity={0.12} name="p5–p25" />
                <Area type="monotone" dataKey="band50" stackId="1" stroke="none" fill="var(--green)" fillOpacity={0.18} name="p25–p50" />
                <Area type="monotone" dataKey="band75" stackId="1" stroke="none" fill="var(--green)" fillOpacity={0.18} name="p50–p75" />
                <Area type="monotone" dataKey="band95" stackId="1" stroke="none" fill="var(--blue)" fillOpacity={0.12} name="p75–p95" />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          {/* Probability table */}
          {target != null && (
            <Panel title="Probability of reaching the FI number" padded={false}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Horizon', 'Median value', 'Chance of clearing target'].map((h, i) => (
                    <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {[10, 20, 30].filter(y => y <= years).map(y => {
                    const row = result.percentiles.find(p => p.year === y)
                    const prob = probabilityByYear(result, target, y)
                    return (
                      <tr key={y}>
                        <td style={tdL}>{y} years</td>
                        <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>
                          {row ? fmtCZK(row.p50) : DASH}
                        </td>
                        <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: (prob ?? 0) > 0.5 ? 'var(--green)' : 'var(--amber)' }}>
                          {orDash(prob, n => `${(n * 100).toFixed(0)}%`)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Panel>
          )}

          {/* Histogram */}
          <Panel title="Distribution of final values">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={histogram} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="value" tick={{ fontSize: 9, fill: 'var(--text3)' }}
                  tickFormatter={n => `${(n / 1_000_000).toFixed(1)}M`} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} width={40} />
                <Tooltip
                  formatter={(v: number) => [`${v} runs`, 'count']}
                  labelFormatter={(v: number) => fmtCZK(v)}
                  contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 11 }}
                />
                {target != null && <ReferenceLine x={target} stroke="var(--green)" strokeDasharray="4 4" />}
                <Bar dataKey="count" fill="var(--blue)" opacity={0.7} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </>
      )}

      {/* Inputs */}
      <Panel title="Assumptions">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 18 }}>
          <NumInput label="Monthly contribution" value={monthlyContribution} onChange={setContribution} />
          <NumInput label="Horizon (years)" value={years} onChange={v => setYears(Math.min(50, Math.max(1, v)))} />
          <NumInput label="Simulations" value={sims} onChange={v => setSims(Math.min(20000, Math.max(100, v)))} />
          <NumInput label="Seed" value={seed} onChange={setSeed} />
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Asset class', 'Starting value', 'Real return', 'Volatility'].map((h, i) => (
              <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {assumptions
              .filter(a => (startByClass[a.assetClass] ?? 0) > 0)
              .map(a => (
                <tr key={a.assetClass}>
                  <td style={tdL}>{ASSET_CLASS_LABELS[a.assetClass]}</td>
                  <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>
                    {fmtCZK(startByClass[a.assetClass] ?? 0)}
                  </td>
                  <td style={tdR}>
                    <input type="number" step="0.5" value={(a.expectedRealReturn * 100).toFixed(1)}
                      onChange={e => setAssumptions(prev => prev.map(x =>
                        x.assetClass === a.assetClass
                          ? { ...x, expectedRealReturn: (parseFloat(e.target.value) || 0) / 100 }
                          : x))}
                      style={{ ...inputStyle, width: 74, textAlign: 'right', padding: '4px 6px', fontSize: 11 }} />
                    <span style={{ fontSize: 10, color: 'var(--text4)', marginLeft: 4 }}>%</span>
                  </td>
                  <td style={tdR}>
                    <input type="number" step="1" value={(a.volatility * 100).toFixed(0)}
                      onChange={e => setAssumptions(prev => prev.map(x =>
                        x.assetClass === a.assetClass
                          ? { ...x, volatility: (parseFloat(e.target.value) || 0) / 100 }
                          : x))}
                      style={{ ...inputStyle, width: 74, textAlign: 'right', padding: '4px 6px', fontSize: 11 }} />
                    <span style={{ fontSize: 10, color: 'var(--text4)', marginLeft: 4 }}>%</span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        <div style={{
          marginTop: 16, padding: '10px 14px', background: 'var(--bg3)',
          border: '1px solid var(--border)', borderRadius: 7,
          fontSize: 11, color: 'var(--text3)', lineHeight: 1.7,
        }}>
          ⓘ These are assumptions compounded, not predictions. The simulation cannot know what
          markets will do; what it can show is how much the answer moves when the assumptions do.
          The width of the band is the honest part. Runs are seeded, so the same inputs always
          give the same fan.
        </div>
      </Panel>
    </PageShell>
  )
}

function NumInput({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 5 }}>{label}</div>
      <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{ ...inputStyle, fontFamily: "'DM Mono', monospace" }} />
    </div>
  )
}
