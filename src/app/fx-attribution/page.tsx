'use client'
import { useMemo } from 'react'
import Badge from '@/components/Badge'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import { usePortfolioSnapshots } from '@/hooks/usePortfolioSnapshots'
import SetupNotice from '@/components/SetupNotice'
import Link from 'next/link'
import { btnStyle } from '@/lib/ui'
import { useState } from 'react'
import {
  attributeSeries, attributeByMonth, attributionTotals,
  attributionAvailableFrom, constantFxSeries, hasExposureData,
} from '@/lib/fxattribution'
import { fmtCZK } from '@/lib/fx'
import { fmtISODate, fmtISODateShort } from '@/lib/date'
import { tdR, tdL, th } from '@/lib/ui'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'

export default function FxAttributionPage() {
  const { snapshots, loading, error, exposureAvailable } = usePortfolioSnapshots()
  const withExposure = useMemo(
    () => (snapshots as any[]).filter(hasExposureData),
    [snapshots]
  )
  const rows = useMemo(() => attributeSeries(withExposure), [withExposure])
  const monthly = useMemo(() => attributeByMonth(withExposure), [withExposure])
  const constant = useMemo(() => constantFxSeries(withExposure), [withExposure])
  const totals = attributionTotals(rows)
  const availableFrom = attributionAvailableFrom(withExposure)

  if (loading) return <LoadingShell label="Loading attribution…" />

  if (withExposure.length < 2) {
    return (
      <PageShell>
        <PageHeader
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
        title="FX attribution"
        subtitle={
          <>
            How much of the return was the assets, and how much was the koruna ·
            available from {availableFrom ? fmtISODate(availableFrom) : DASH}
          </>
        }
      />

      <MetricCards
        columns={4}
        cards={[
          {
            label: 'Total change', value: fmtCZK(totals.totalCZK),
            accent: totals.totalCZK >= 0 ? 'var(--green)' : 'var(--red)',
            color: totals.totalCZK >= 0 ? 'var(--green)' : 'var(--red)',
            note: 'chained daily, so contributions do not distort it',
          },
          {
            label: 'Of which assets', value: fmtCZK(totals.assetCZK),
            accent: 'var(--blue)',
            color: totals.assetCZK >= 0 ? 'var(--green)' : 'var(--red)',
          },
          {
            label: 'Of which currency', value: fmtCZK(totals.currencyCZK),
            accent: 'var(--amber)',
            color: totals.currencyCZK >= 0 ? 'var(--green)' : 'var(--red)',
          },
          {
            label: 'FX share of total',
            value: orDash(totals.fxShareOfTotal, n => `${(n * 100).toFixed(0)}%`),
            accent: 'var(--purple)',
            note: totals.fxShareOfTotal == null ? 'total too close to zero' : undefined,
          },
        ]}
      />

      {/* Monthly split */}
      <Panel title="Monthly split: asset vs currency">
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={monthlyChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--text3)' }} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} width={70}
              tickFormatter={n => fmtCZK(n, 0)} />
            <Tooltip formatter={(v: number) => fmtCZK(v)}
              contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={0} stroke="var(--border2)" />
            <Bar dataKey="asset" name="Asset effect" stackId="a" fill="var(--green)" opacity={0.8} />
            <Bar dataKey="currency" name="Currency effect" stackId="a" fill="var(--amber)" opacity={0.8} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {/* Constant FX comparison — the gap IS the currency effect */}
      <Panel title="Actual value vs the same portfolio at frozen start-date FX">
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={constantChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text3)' }}
              tickFormatter={fmtISODateShort} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} width={70}
              tickFormatter={n => fmtCZK(n, 0)} domain={['auto', 'auto']} />
            <Tooltip formatter={(v: number) => fmtCZK(v)} labelFormatter={fmtISODate}
              contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="actual" name="Actual (live FX)" stroke="var(--green)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="constantFx" name="At frozen FX" stroke="var(--amber)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text3)', lineHeight: 1.7 }}>
          The gap between the two lines <em>is</em> the currency effect. Where they run together,
          the koruna did nothing to you; where they diverge, exchange rates moved your net worth
          without a single asset changing price.
        </div>
      </Panel>

      {/* Per-currency table */}
      <Panel title="By currency" padded={false}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Currency', 'Asset effect', 'Currency effect', 'Interaction', 'Total'].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.currency}>
                <td style={tdL}>
                  <Badge variant={r.currency === 'USD' ? 'gray' : r.currency === 'EUR' ? 'blue' : 'amber'}>
                    {r.currency}
                  </Badge>
                </td>
                <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: r.assetEffectCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmtCZK(r.assetEffectCZK)}
                </td>
                <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: r.currencyEffectCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmtCZK(r.currencyEffectCZK)}
                </td>
                <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--text4)' }}>
                  {fmtCZK(r.interactionCZK)}
                </td>
                <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontWeight: 500, color: r.totalCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmtCZK(r.totalCZK)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '12px 18px', fontSize: 10, color: 'var(--text4)', lineHeight: 1.7, borderTop: '1px solid var(--border)' }}>
          Interaction is the cross-term — the part of the move that needed both the asset and the
          currency to change. It is usually small, and it is reported rather than folded silently
          into one of the other two columns.
        </div>
      </Panel>
    </PageShell>
  )
}
