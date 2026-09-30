'use client'
import { useEffect, useMemo } from 'react'
import Badge from '@/components/Badge'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import SetupNotice from '@/components/SetupNotice'
import { useAppData } from '@/hooks/useAppData'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { buildPositions } from '@/lib/portfolio'
import {
  riskSummary, concentrationTable, liquidityLadder, raisableWithin, fundShare,
  topFiveBand, effectiveNBand, unhedgedFxBand, liquidityBand, ASSET_CLASS_LABELS, ASSET_CLASS_COLORS,
} from '@/lib/risk'
import { effectiveAnnualExpenses, DEFAULT_PLAN } from '@/lib/fire'
import { SEED_SECTORS } from '@/lib/risk'
import { useProfile } from '@/lib/profile'
import { supabase, type AssetMetadata } from '@/lib/supabase'
import { btnStyle } from '@/lib/ui'
import { useState } from 'react'
import Link from 'next/link'
import { fmtCZK, fmtShare } from '@/lib/fx'
import { whtRateFor } from '@/lib/tax'
import { Notice, inputStyle } from '@/components/FormFields'
import { tdR, tdL, th } from '@/lib/ui'

/** Sequential blues for liquidity: darker = faster to raise. */
const TIER_COLORS: Record<string, string> = {
  instant: '#1d4ed8', week: '#3b6fd8', month: '#6f93dc', year: '#a3b7df', illiquid: '#c9cfd9',
}
const TIER_LABEL: Record<string, string> = {
  instant: 'Instant', week: 'Within a week', month: 'Within a month', year: 'Within a year', illiquid: 'Locked / illiquid',
}
const ASSET_TYPES = [
  { key: 'stock', label: 'Stock' }, { key: 'etf', label: 'Equity ETF' },
  { key: 'bond_etf', label: 'Bond ETF' }, { key: 'reit', label: 'REIT' },
]

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
  const ladder = liquidityLadder(positions)
  const funds = fundShare(positions)
  const [notice, setNotice] = useState<string | null>(null)

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
            sector: seed?.sector ?? null,
            region: seed?.region ?? null,
            asset_type: seed?.sector === 'ETF' ? 'etf' : seed ? 'stock' : null,
            liquidity_tier: 'week',
            is_hedged: false,
          }
        })
      if (rows.length === 0) { setNotice('Every holding already has a classification row.'); return }
      let { error } = await supabase.from('asset_metadata')
        .upsert(rows, { onConflict: 'profile_id,symbol' })
      if (error && /asset_type/.test(error.message)) {
        ;({ error } = await supabase.from('asset_metadata')
          .upsert(rows.map(({ asset_type: _t, ...r }) => { void _t; return r }), { onConflict: 'profile_id,symbol' }))
      }
      if (error) { setNotice(`Could not seed classifications: ${error.message}`); return }
      setNotice(`Added ${rows.length} rows — ${rows.filter(r => !r.sector).length} still need a sector; fill them in below.`)
      data.reload()
    } finally {
      setSeeding(false)
    }
  }

  const unclassified = data.holdings.filter(h =>
    !data.assetMetadata.some(m => m.symbol.toUpperCase() === h.symbol.toUpperCase() && (m.sector || m.asset_type)))

  if (data.loading) return <LoadingShell label="Loading risk profile…" />

  if (positions.length === 0) {
    return (
      <PageShell>
        <PageHeader eyebrow="Analysis" title="Risk & liquidity" subtitle="Concentration and how quickly you could raise cash" />
        <EmptyState
          icon="◈"
          title="Nothing to measure yet"
          body="Add holdings, cash accounts, crypto or property and this page will show how concentrated the portfolio is, what it is exposed to, and how quickly you could raise cash."
        />
      </PageShell>
    )
  }

  const ladderTotal = Object.values(ladder).reduce((s, v) => s + v, 0)

  return (
    <PageShell maxWidth={1160}>
      <PageHeader
        eyebrow="Analysis"
        title="Risk & liquidity"
        subtitle={
          <>
            Concentration, exposure and liquidity across {summary.positionCount} positions ·
            expenses from {expenses.source === 'logged'
              ? `${expenses.monthsOfData} months of logged spending`
              : 'your financial plan'}
          </>
        }
        actions={unclassified.length > 0 ? (
          <button type="button" onClick={seedMetadata} disabled={seeding} style={btnStyle('secondary')}>
            {seeding ? 'Seeding…' : `↺ Classify ${unclassified.length} holdings`}
          </button>
        ) : undefined}
      />

      <SetupNotice tables={data.missingTables.filter(t => t === 'asset_metadata')} />
      {notice && <Notice tone="blue">{notice}</Notice>}

      {unclassified.length > 0 && (
        <div style={{
          background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)',
          color: 'var(--amber)', borderRadius: 8, padding: '9px 14px',
          marginBottom: 14, fontSize: 11, lineHeight: 1.6,
        }}>
          ⚠ {unclassified.length} holding{unclassified.length > 1 ? 's have' : ' has'} no classification
          ({unclassified.slice(0, 5).map(h => h.symbol).join(', ')}{unclassified.length > 5 ? '…' : ''}), so
          {unclassified.length > 1 ? ' they count' : ' it counts'} as an unclassified stock. Set sector, region, country
          and type in <a href="#classification">Classification</a> below.
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
            note: funds > 0.2 ? `${fmtShare(funds * 100, 0)} in funds, each counted as one` : 'how many bets you really have',
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
        ⓘ Funds (ETFs) are scored as one position each — there is no look-through to what they
        hold, so a portfolio built on one world ETF reads as concentrated when it holds thousands
        of companies. High unhedged FX is usually a deliberate choice for a CZK investor; it is shown,
        not judged. Sector, region and currency splits are on <Link href="/allocation">Allocation</Link>.
      </div>

      {/* Concentration */}
      <Panel title="Concentration by position" right={<Badge variant="gray">{rows.length} positions</Badge>} padded={false}>
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="sr-only">Positions by weight</caption>
            <thead>
              <tr>
                {['Position', 'Class', 'Value (CZK)', 'Weight', 'Cumulative', ''].map((h, i) => (
                  <th key={h || 'bar'} scope="col" style={{ ...th, textAlign: i <= 1 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.position.id}>
                  <td style={tdL}>
                    <div style={{ fontWeight: 500 }}>{r.position.label}{r.position.isFund && <span style={{ fontSize: 10, color: 'var(--text3)' }}> · fund</span>}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.position.name}</div>
                  </td>
                  <td style={tdL}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: ASSET_CLASS_COLORS[r.position.assetClass] }} />
                      {ASSET_CLASS_LABELS[r.position.assetClass]}
                    </span>
                  </td>
                  <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(r.position.valueCZK)}</td>
                  <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>
                    {(r.pct * 100).toFixed(1)}%
                    {r.band !== 'green' && <span style={{ marginLeft: 6 }}><Badge variant={r.band}>{r.band === 'red' ? 'high' : 'watch'}</Badge></span>}
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

      {/* Liquidity ladder */}
      <Panel title="Liquidity ladder">
        <div aria-hidden="true" style={{ display: 'flex', height: 14, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
          {(Object.keys(ladder) as (keyof typeof ladder)[]).map(tier => (
            ladder[tier] > 0 && (
              <div key={tier} title={`${TIER_LABEL[tier]}: ${fmtCZK(ladder[tier])}`} style={{
                flex: ladder[tier], background: TIER_COLORS[tier],
              }} />
            )
          ))}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <caption className="sr-only">Liquidity ladder</caption>
          <thead>
            <tr>
              {['Tier', 'Available', 'Share', 'Months of expenses'].map((h, i) => (
                <th key={h} scope="col" style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(Object.keys(ladder) as (keyof typeof ladder)[]).map(tier => (
              <tr key={tier}>
                <td style={tdL}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: TIER_COLORS[tier] }} />
                    {TIER_LABEL[tier]}
                  </span>
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
          You could raise <strong>{fmtCZK(raisableWithin(positions, 'week'))}</strong> within a week
          {monthlyExpenses > 0 && ` — ${(raisableWithin(positions, 'week') / monthlyExpenses).toFixed(1)} months of expenses`}.
        </div>
      </Panel>

      <ClassificationPanel />
    </PageShell>
  )
}


/**
 * Per-symbol classification: sector, region, issuer country (drives the
 * dividend withholding default), asset type (a bond ETF counts as fixed
 * income) and liquidity. The single source for all of these — no page keeps
 * its own copy.
 */
function ClassificationPanel() {
  const data = useAppData()
  const { activeProfile } = useProfile()
  const [drafts, setDrafts] = useState<Record<string, Partial<AssetMetadata>>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const metaBy = new Map(data.assetMetadata.map(m => [m.symbol.toUpperCase(), m]))
  const symbols = data.holdings.map(h => h.symbol.toUpperCase())
  const val = (sym: string, k: keyof AssetMetadata) =>
    (drafts[sym]?.[k] ?? metaBy.get(sym)?.[k] ?? '') as string
  const set = (sym: string, k: keyof AssetMetadata, v: string) =>
    setDrafts(d => ({ ...d, [sym]: { ...d[sym], [k]: v } }))
  const dirty = Object.keys(drafts).length > 0

  const save = async () => {
    if (!activeProfile) return
    setSaving(true); setMsg(null)
    const rows = Object.entries(drafts).map(([symbol, d]) => {
      const cur = metaBy.get(symbol)
      const pick = (k: keyof AssetMetadata) => {
        const v = (d[k] ?? cur?.[k] ?? null) as string | null
        return v === '' ? null : v
      }
      return {
        profile_id: activeProfile.id, symbol,
        sector: pick('sector'), region: pick('region'), country: pick('country')?.toUpperCase() ?? null,
        asset_type: pick('asset_type'), liquidity_tier: pick('liquidity_tier') ?? 'week',
        is_hedged: cur?.is_hedged ?? false,
      }
    })
    const { error } = await supabase.from('asset_metadata').upsert(rows, { onConflict: 'profile_id,symbol' })
    setSaving(false)
    if (error) { setMsg(`Could not save: ${error.message}${/asset_type/.test(error.message) ? ' — run migration 011.' : ''}`); return }
    setDrafts({}); setMsg(`Saved ${rows.length} classification${rows.length > 1 ? 's' : ''}.`)
    data.reload()
  }

  if (symbols.length === 0) return null
  const cell = { ...inputStyle, padding: '4px 6px', fontSize: 12 }
  return (
    <section id="classification">
      <Panel title="Classification" right={
        <button type="button" onClick={save} disabled={!dirty || saving} style={btnStyle(dirty ? 'primary' : 'secondary')}>
          {saving ? 'Saving…' : dirty ? `Save ${Object.keys(drafts).length} change${Object.keys(drafts).length > 1 ? 's' : ''}` : 'Saved'}
        </button>
      } padded={false}>
        {msg && <div style={{ padding: '8px 18px', fontSize: 11, color: 'var(--text2)' }}>{msg}</div>}
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="sr-only">Classification of each holding</caption>
            <thead><tr>
              {['Symbol', 'Type', 'Sector', 'Region', 'Issuer country', 'Withholding', 'Liquidity'].map((h, i) => (
                <th key={h} scope="col" style={{ ...th, textAlign: i === 5 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {symbols.map(sym => {
                const wht = whtRateFor({ country: val(sym, 'country'), region: val(sym, 'region') })
                return (
                  <tr key={sym}>
                    <td style={{ ...tdL, fontWeight: 500 }}>{sym}</td>
                    <td style={tdL}>
                      <select aria-label={`${sym} type`} style={cell} value={val(sym, 'asset_type')} onChange={e => set(sym, 'asset_type', e.target.value)}>
                        <option value="">—</option>
                        {ASSET_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </td>
                    <td style={tdL}><input aria-label={`${sym} sector`} style={cell} value={val(sym, 'sector')} onChange={e => set(sym, 'sector', e.target.value)} placeholder="Technology" list="sector-options" /></td>
                    <td style={tdL}>
                      <select aria-label={`${sym} region`} style={cell} value={val(sym, 'region')} onChange={e => set(sym, 'region', e.target.value)}>
                        <option value="">—</option>
                        {['US', 'EU', 'CZ', 'UK', 'Global', 'EM', 'Other'].map(r => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={tdL}><input aria-label={`${sym} issuer country`} style={{ ...cell, width: 64 }} maxLength={2} value={val(sym, 'country')} onChange={e => set(sym, 'country', e.target.value.toUpperCase())} placeholder="US" /></td>
                    <td className="num" style={tdR} title={wht.basis === 'default' ? 'Country unknown — US treaty rate assumed' : undefined}>
                      {fmtShare(wht.rate * 100, wht.rate * 100 % 1 ? 2 : 0)}{wht.basis === 'default' && ' ?'}
                    </td>
                    <td style={tdL}>
                      <select aria-label={`${sym} liquidity`} style={cell} value={val(sym, 'liquidity_tier') || 'week'} onChange={e => set(sym, 'liquidity_tier', e.target.value)}>
                        {Object.entries(TIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <datalist id="sector-options">
            {['Technology', 'Financials', 'Consumer Staples', 'Consumer Discretionary', 'Health Care', 'Industrials',
              'Energy', 'Materials', 'Utilities', 'Real Estate', 'Telecom'].map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
      </Panel>
    </section>
  )
}
