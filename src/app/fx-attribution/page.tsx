'use client'
import { useMemo } from 'react'
import Badge from '@/components/Badge'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import { usePortfolioSnapshots } from '@/hooks/usePortfolioSnapshots'
import { useAppData } from '@/hooks/useAppData'
import SetupNotice from '@/components/SetupNotice'
import { RouteTabs, RETURNS_TABS } from '@/components/Sidebar'
import Link from 'next/link'
import { btnStyle, signColor } from '@/lib/ui'
import {
  attributeSeries, attributeByMonth, attributionTotals,
  attributionAvailableFrom, constantFxSeries, hasExposureData, type AttributionFlow,
} from '@/lib/fxattribution'
import { czkOf } from '@/lib/transactions'
import { fmtCZK, fmtSignedCZK, fmtAxisCZK } from '@/lib/fx'
import { fmtISODate, fmtISODateShort } from '@/lib/date'
import { tdR, tdL, th } from '@/lib/ui'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'

export default function FxAttributionPage() {
  const { snapshots, loading, error, exposureAvailable } = usePortfolioSnapshots()
  const { transactions } = useAppData()
  const withExposure = useMemo(() => snapshots.filter(hasExposureData), [snapshots])
  // Deposits and withdrawals, in the currency they moved in, so they are not
  // counted as "what the asset did".
  const flows: AttributionFlow[] = useMemo(
    () => transactions.filter(t => t.is_external).map(t => ({ date: t.txn_date, amountCZK: czkOf(t), currency: t.currency })),
    [transactions]
  )
  const rows = useMemo(() => attributeSeries(withExposure, flows), [withExposure, flows])
  const monthly = useMemo(() => attributeByMonth(withExposure, flows), [withExposure, flows])
  const constant = useMemo(() => constantFxSeries(withExposure), [withExposure])
  const totals = attributionTotals(rows)
  const availableFrom = attributionAvailableFrom(withExposure)

  if (loading) return <LoadingShell label="Loading attribution…" />

  if (withExposure.length < 2) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Analysis"
          title="FX attribution"
          subtitle="Was it the market, or was it the koruna?"
          actions={
            // The cron route needs CRON_SECRET, which the browser cannot hold,
            // so today's snapshot is written by opening the dashboard instead.
            <Link href="/" style={{ ...btnStyle('secondary'), textDecoration: 'none' }}>
              ↻ Write today&rsquo;s snapshot
            </Link>
          }
        />
        <RouteTabs tabs={RETURNS_TABS} />
        {error && (
          <div style={{
            background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)', color: 'var(--amber)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 11, lineHeight: 1.6,
          }}>⚠ Snapshot history could not be loaded: {error}</div>
        )}
        {!exposureAvailable && <SetupNotice tables={['portfolio_snapshots_exposure']} />}
        <EmptyState
          icon="⇅"
          title="Not enough exposure history yet"
          body={
            <>
              Splitting a return into &ldquo;the asset moved&rdquo; and &ldquo;the currency
              moved&rdquo; needs per-currency exposure recorded on each daily snapshot. Those
              columns are new, so the series starts from the first snapshot written after the
              migration ran.
              <br /><br />
              A snapshot is written once a day by the scheduled job — see <code>vercel.json</code>,
              which needs <code>CRON_SECRET</code> set — and also whenever you open the dashboard.
              Opening the dashboard now writes today&rsquo;s immediately.
              {withExposure.length === 1 && (
                <><br /><br />One snapshot recorded so far — two are needed for a first comparison.</>
              )}
            </>
          }
        />
      </PageShell>
    )
  }

  const monthlyChart = monthly.map(m => {
    const [y, mm] = m.month.split('-').map(Number)
    return {
      month: new Date(y, mm - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      asset: Math.round(m.assetCZK),
      currency: Math.round(m.currencyCZK),
    }
  })

  const constantChart = constant.map(c => ({
    date: c.date,
    actual: Math.round(c.actualCZK),
    constantFx: Math.round(c.constantFxCZK),
  }))

  return (
    <PageShell maxWidth={1100}>
      <PageHeader
        eyebrow="Analysis"
        title="FX attribution"
        subtitle={
          <>
            How much of the change was the assets, and how much was the koruna ·
            available from {availableFrom ? fmtISODate(availableFrom) : DASH}
          </>
        }
      />
      <RouteTabs tabs={RETURNS_TABS} />

      <MetricCards
        cards={[
          {
            label: 'Change in value', value: fmtSignedCZK(totals.totalCZK),
            accent: signColor(totals.totalCZK), color: signColor(totals.totalCZK),
            note: 'chained day by day',
          },
          {
            label: 'Paid in / taken out', value: fmtSignedCZK(totals.flowsCZK),
            accent: 'var(--c-cash)', note: flows.length ? 'deposits and withdrawals — not performance' : 'no deposits recorded',
          },
          {
            label: 'Assets did', value: fmtSignedCZK(totals.assetCZK),
            accent: signColor(totals.assetCZK), color: signColor(totals.assetCZK),
          },
          {
            label: 'Currency did', value: fmtSignedCZK(totals.currencyCZK),
            accent: signColor(totals.currencyCZK), color: signColor(totals.currencyCZK),
            note: 'USD, EUR and GBP holdings',
          },
          {
            label: 'FX share of performance',
            value: orDash(totals.fxShareOfTotal, n => `${(n * 100).toFixed(0)} %`),
            accent: 'var(--border3)',
            note: totals.fxShareOfTotal == null ? 'performance too close to zero' : undefined,
          },
        ]}
      />

      {/* Monthly split */}
      <Panel title="Monthly split: asset vs currency">
        <div role="img" aria-label="Monthly asset and currency effects">
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={monthlyChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text3)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text3)' }} width={72} tickFormatter={fmtAxisCZK} />
            <Tooltip formatter={(v: number) => fmtSignedCZK(v)}
              contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="var(--text3)" label={{ value: '0', position: 'left', fontSize: 10, fill: 'var(--text3)' }} />
            <Bar dataKey="asset" name="Asset effect" stackId="a" fill="var(--blue)" />
            <Bar dataKey="currency" name="Currency effect" stackId="a" fill="var(--slate)" />
          </BarChart>
        </ResponsiveContainer>
        </div>
      </Panel>

      {/* Constant FX comparison — the gap IS the currency effect */}
      <Panel title="Actual value vs the same portfolio at frozen start-date FX">
        <div role="img" aria-label="Actual value against the same holdings at start-date exchange rates">
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={constantChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text3)' }}
              tickFormatter={fmtISODateShort} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text3)' }} width={72}
              tickFormatter={fmtAxisCZK} domain={['auto', 'auto']} />
            <Tooltip formatter={(v: number) => fmtCZK(v)} labelFormatter={fmtISODate}
              contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="actual" name="Actual (live FX)" stroke="var(--blue)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="constantFx" name="At start-date FX" stroke="var(--slate)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text3)', lineHeight: 1.7 }}>
          The gap between the two lines <em>is</em> the currency effect. Where they run together,
          the koruna did nothing to you; where they diverge, exchange rates moved your net worth
          without a single asset changing price.
        </div>
      </Panel>

      {/* Per-currency table */}
      <Panel title="By currency" padded={false}>
        <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <caption className="sr-only">Attribution by currency</caption>
          <thead>
            <tr>
              {['Currency', 'Asset effect', 'Currency effect', 'Interaction', 'Paid in / out', 'Total change'].map((h, i) => (
                <th key={h} scope="col" style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.currency}>
                <td style={tdL}>
                  <Badge variant="gray">{r.currency}</Badge>
                  {r.unsplit && <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 6 }}>stored in CZK — FX part not separable</span>}
                </td>
                <td className="num" style={{ ...tdR, color: signColor(r.assetEffectCZK) }}>{fmtSignedCZK(r.assetEffectCZK)}</td>
                <td className="num" style={{ ...tdR, color: signColor(r.currencyEffectCZK) }}>{r.unsplit ? DASH : fmtSignedCZK(r.currencyEffectCZK)}</td>
                <td className="num" style={{ ...tdR, color: 'var(--text3)' }}>{r.unsplit ? DASH : fmtSignedCZK(r.interactionCZK)}</td>
                <td className="num" style={{ ...tdR, color: 'var(--text3)' }}>{r.flowsCZK ? fmtSignedCZK(r.flowsCZK) : DASH}</td>
                <td className="num" style={{ ...tdR, fontWeight: 500, color: signColor(r.totalCZK) }}>{fmtSignedCZK(r.totalCZK)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div style={{ padding: '12px 18px', fontSize: 11, color: 'var(--text3)', lineHeight: 1.7, borderTop: '1px solid var(--border)' }}>
          Interaction is the cross-term — the part of the move that needed both the asset and the
          currency to change. It is usually small, and it is reported rather than folded silently
          into one of the other two columns.
        </div>
      </Panel>
    </PageShell>
  )
}
