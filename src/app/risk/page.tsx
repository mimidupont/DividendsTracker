'use client'
import { useEffect, useMemo } from 'react'
import Badge from '@/components/Badge'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import { useAppData } from '@/hooks/useAppData'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { buildPositions } from '@/lib/portfolio'
import {
  riskSummary, concentrationTable, exposureBy, liquidityLadder, raisableWithin,
  topFiveBand, effectiveNBand, unhedgedFxBand, liquidityBand, ASSET_CLASS_LABELS,
} from '@/lib/risk'
import { effectiveAnnualExpenses, DEFAULT_PLAN } from '@/lib/fire'
import { SEED_SECTORS } from '@/lib/risk'
import { useProfile } from '@/lib/profile'
import { supabase } from '@/lib/supabase'
import { btnStyle } from '@/lib/ui'
import { useState } from 'react'
import { fmtCZK } from '@/lib/fx'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { tdR, tdL, th } from '@/lib/ui'

const SECTOR_COLORS = [
  '#4a9448', '#185fa5', '#7a5810', '#8a2b22', '#2a7a7a',
  '#5a3a8a', '#8a6a2a', '#4a6a2a', '#6a4a8a', '#888c8e',
]

const TIER_COLORS: Record<string, string> = {
  instant: 'var(--green)', week: 'var(--blue)', month: 'var(--amber)',
  year: 'var(--teal)', illiquid: 'var(--text4)',
}

export default function RiskPage() {
  const data = useAppData()
  const { activeProfile } = useProfile()
  const [seeding, setSeeding] = useState(false)
  const { fx } = useFx()
  const market = useMarketData()
  const crypto = useCryptoPrices()

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

  const expenses = effectiveAnnualExpenses(
    data.financialPlan ?? DEFAULT_PLAN, data.expenseLog)
  const monthlyExpenses = expenses.annualCZK / 12

  const summary = riskSummary(positions, monthlyExpenses)
  const rows = concentrationTable(positions)
  const sectors = exposureBy(positions, 'sector')
  const regions = exposureBy(positions, 'region')
  const currencies = exposureBy(positions, 'currency')
  const ladder = liquidityLadder(positions)

  /**
   * Seed sector/region metadata for the symbols you hold. Without it the
   * exposure pies have nothing to group by, so the page ships with a one-click
   * starting point rather than an empty chart and no explanation.
   */
  const seedMetadata = async () => {
    if (!activeProfile) return
    setSeeding(true)
    try {
      const known = new Set(data.assetMetadata.map(m => m.symbol.toUpperCase()))
      const rows = data.holdings
        .filter(h => !known.has(h.symbol.toUpperCase()))
        .map(h => {
          const seed = SEED_SECTORS[h.symbol.toUpperCase()]
          return {
            profile_id: activeProfile.id,
            symbol: h.symbol.toUpperCase(),
            sector: seed?.sector ?? 'Other',
            region: seed?.region ?? 'Other',
            liquidity_tier: 'week',
            is_hedged: false,
          }
        })
      if (rows.length === 0) { alert('Every holding already has metadata.'); return }
      const { error } = await supabase.from('asset_metadata')
        .upsert(rows, { onConflict: 'profile_id,symbol' })
      if (error) { alert(`Could not seed metadata: ${error.message}`); return }
      data.reload()
    } finally {
      setSeeding(false)
    }
  }

  const unclassified = data.holdings.filter(h =>
    !data.assetMetadata.some(m => m.symbol.toUpperCase() === h.symbol.toUpperCase()))

  if (data.loading) return <LoadingShell label="Loading risk profile…" />

  if (positions.length === 0) {
    return (
      <PageShell>
        <PageHeader title="Risk" subtitle="Concentration, exposure and liquidity" />
        <EmptyState
          icon="◈"
          title="Nothing to measure yet"
          body="Add holdings, cash accounts, crypto or property and this page will show how concentrated the portfolio is, what it is exposed to, and how quickly you could raise cash."
        />
      </PageShell>
    )
  }

  const pieData = (buckets: { key: string; valueCZK: number; pct: number; count: number }[]) =>
    buckets.map((b, i) => ({
      name: b.key, value: b.valueCZK, pct: b.pct * 100,
      count: b.count, color: SECTOR_COLORS[i % SECTOR_COLORS.length],
    }))

  const PieTip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
        <div>{fmtCZK(d.value)} · {d.pct.toFixed(1)}%</div>
        <div style={{ color: 'var(--text3)', marginTop: 2 }}>{d.count} position{d.count > 1 ? 's' : ''}</div>
      </div>
    )
  }

  const ladderTotal = Object.values(ladder).reduce((s, v) => s + v, 0)

  return (
    <PageShell maxWidth={1160}>
      <PageHeader
        title="Risk"
        subtitle={
          <>
            Concentration, exposure and liquidity across {summary.positionCount} positions ·
            expenses from {expenses.source === 'logged'
              ? `${expenses.monthsOfData} months of logged spending`
              : 'your financial plan'}
          </>
        }
        actions={unclassified.length > 0 ? (
          <button onClick={seedMetadata} disabled={seeding} style={btnStyle('secondary')}>
            {seeding ? 'Seeding…' : `↺ Classify ${unclassified.length} holdings`}
          </button>
        ) : undefined}
      />

      {unclassified.length > 0 && (
        <div style={{
          background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)',
          color: 'var(--amber)', borderRadius: 8, padding: '9px 14px',
          marginBottom: 14, fontSize: 11, lineHeight: 1.6,
        }}>
          ⚠ {unclassified.length} holding{unclassified.length > 1 ? 's have' : ' has'} no sector or
          region on file, so they fall into &ldquo;Unclassified&rdquo; below. Classify them to make
          the exposure breakdowns meaningful.
        </div>
      )}

      <MetricCards
        columns={4}
        cards={[
          {
            label: 'Top-5 weight',
            value: `${(summary.topFivePct * 100).toFixed(1)}%`,
            accent: `var(--${topFiveBand(summary.topFivePct)})`,
            color: `var(--${topFiveBand(summary.topFivePct)})`,
            note: 'green under 35%',
          },
          {
            label: 'Effective N',
            value: summary.effectiveN.toFixed(1),
            accent: `var(--${effectiveNBand(summary.effectiveN)})`,
            color: `var(--${effectiveNBand(summary.effectiveN)})`,
            note: 'how many bets you really have',
          },
          {
            label: 'Unhedged FX',
            value: `${(summary.unhedgedPct * 100).toFixed(0)}%`,
            accent: `var(--${unhedgedFxBand(summary.unhedgedPct)})`,
            color: `var(--${unhedgedFxBand(summary.unhedgedPct)})`,
            note: 'non-CZK assets',
          },
          {
            label: 'Instant liquidity',
            value: orDash(summary.instantMonths, n => `${n.toFixed(1)} mo`),
            accent: summary.instantMonths != null ? `var(--${liquidityBand(summary.instantMonths)})` : 'var(--border2)',
            color: summary.instantMonths != null ? `var(--${liquidityBand(summary.instantMonths)})` : 'var(--text3)',
            note: fmtCZK(summary.instantCZK),
          },
        ]}
      />

      <div style={{
        background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8,
        padding: '10px 14px', marginBottom: 14, fontSize: 11, color: 'var(--text3)', lineHeight: 1.7,
      }}>
        ⓘ For a CZK-based investor, high unhedged FX is usually a deliberate diversification
        choice rather than a defect — the koruna is a small currency and holding only CZK assets
        is its own concentration. It is flagged here so it stays visible, not because it is wrong.
      </div>

      {/* Concentration */}
      <Panel title="Concentration by position" right={<Badge variant="gray">{rows.length} positions</Badge>} padded={false}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Position', 'Class', 'Value (CZK)', 'Weight', 'Cumulative', ''].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i <= 1 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.position.id} style={{
                  background: r.band === 'red' ? 'var(--red-bg)' : undefined,
                }}>
                  <td style={tdL}>
                    <div style={{ fontWeight: 500 }}>{r.position.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--text4)' }}>{r.position.name}</div>
                  </td>
                  <td style={tdL}>
                    <Badge variant="gray">{ASSET_CLASS_LABELS[r.position.assetClass]}</Badge>
                  </td>
                  <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(r.position.valueCZK)}</td>
                  <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: `var(--${r.band})` }}>
                    {(r.pct * 100).toFixed(1)}%
                  </td>
                  <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--text3)' }}>
                    {(r.cumulativePct * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', width: 140 }}>
                    <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${Math.min(r.pct * 100 * 3, 100)}%`,
                        background: `var(--${r.band})`, borderRadius: 3, opacity: 0.8,
                      }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Sector + region pies */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        {[{ title: 'Sector exposure', buckets: sectors }, { title: 'Region exposure', buckets: regions }].map(({ title, buckets }) => (
          <div key={title} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 500, marginBottom: 14 }}>
              {title}
            </div>
            {buckets.length === 0 || buckets.every(b => b.key === 'Unclassified') ? (
              <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.7, padding: '20px 0' }}>
                Nothing classified yet. Sector and region come from the asset metadata table —
                seed it from the Risk setup, or add rows per symbol.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <ResponsiveContainer width={150} height={150}>
                  <PieChart>
                    <Pie data={pieData(buckets)} dataKey="value" cx="50%" cy="50%" outerRadius={68} innerRadius={38} paddingAngle={2}>
                      {pieData(buckets).map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip content={<PieTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1 }}>
                  {pieData(buckets).slice(0, 7).map(b => (
                    <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, flex: 1 }}>{b.name}</span>
                      <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--text3)' }}>
                        {b.pct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Currency */}
      <Panel title="Currency exposure">
        <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 12 }}>
          {currencies.map((c, i) => (
            <div key={c.key} title={`${c.key} ${(c.pct * 100).toFixed(1)}%`} style={{
              flex: c.valueCZK,
              background: c.key === 'CZK' ? 'var(--green)' : SECTOR_COLORS[(i + 1) % SECTOR_COLORS.length],
              opacity: 0.85,
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {currencies.map((c, i) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 8, height: 8, borderRadius: 2,
                background: c.key === 'CZK' ? 'var(--green)' : SECTOR_COLORS[(i + 1) % SECTOR_COLORS.length],
              }} />
              <span style={{ fontSize: 11 }}>{c.key}</span>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'DM Mono', monospace" }}>
                {(c.pct * 100).toFixed(1)}%
              </span>
              <span style={{ fontSize: 10, color: 'var(--text4)' }}>{fmtCZK(c.valueCZK)}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Liquidity ladder */}
      <Panel title="Liquidity ladder">
        <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
          {(Object.keys(ladder) as (keyof typeof ladder)[]).map(tier => (
            ladder[tier] > 0 && (
              <div key={tier} title={`${tier}: ${fmtCZK(ladder[tier])}`} style={{
                flex: ladder[tier], background: TIER_COLORS[tier], opacity: 0.8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, color: '#fff', overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                {ladderTotal > 0 && ladder[tier] / ladderTotal > 0.08 ? tier : ''}
              </div>
            )
          ))}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Tier', 'Available', 'Share', 'Months of expenses'].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(Object.keys(ladder) as (keyof typeof ladder)[]).map(tier => (
              <tr key={tier}>
                <td style={tdL}>
                  <span style={{ color: TIER_COLORS[tier], textTransform: 'capitalize' }}>{tier}</span>
                </td>
                <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(ladder[tier])}</td>
                <td style={{ ...tdR, color: 'var(--text3)' }}>
                  {ladderTotal > 0 ? `${((ladder[tier] / ladderTotal) * 100).toFixed(1)}%` : DASH}
                </td>
                <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--text3)' }}>
                  {monthlyExpenses > 0 ? `${(ladder[tier] / monthlyExpenses).toFixed(1)} mo` : DASH}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text2)' }}>
          You could raise <strong style={{ color: 'var(--green)' }}>{fmtCZK(raisableWithin(positions, 'week'))}</strong> within a week
          {monthlyExpenses > 0 && ` — ${(raisableWithin(positions, 'week') / monthlyExpenses).toFixed(1)} months of expenses`}.
        </div>
      </Panel>
    </PageShell>
  )
}
