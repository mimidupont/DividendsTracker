'use client'
import { useEffect, useMemo, useState } from 'react'
import Badge from '@/components/Badge'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import SetupNotice from '@/components/SetupNotice'
import { useAppData } from '@/hooks/useAppData'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { useProfile } from '@/lib/profile'
import { buildPositions } from '@/lib/portfolio'
import { applyScenario, SCENARIO_PRESETS, waterfall, type Shocks } from '@/lib/scenarios'
import { DEFAULT_PLAN, effectiveAnnualExpenses } from '@/lib/fire'
import { ASSET_CLASS_LABELS } from '@/lib/risk'
import { supabase } from '@/lib/supabase'
import { fmtCZK } from '@/lib/fx'
import { tdR, tdL, th, btnStyle, inputStyle } from '@/lib/ui'

/**
 * The shock keys that are percentages, as a union rather than `keyof Shocks`.
 *
 * `keyof Shocks` also admits `fx` (a Record) and `income_loss_months` (a count),
 * and a computed-key spread bypasses type checking — so a future caller could
 * write a number into `fx` or divide a month count by 100 with the compiler
 * saying nothing.
 */
type PctShockKey =
  | 'equity_pct' | 'crypto_pct' | 'property_pct'
  | 'rates_pct' | 'rent_vacancy_pct' | 'expense_shock_pct'

const SHOCK_SLIDERS: { key: PctShockKey; label: string; min: number; max: number; step: number }[] = [
  { key: 'equity_pct', label: 'Equities', min: -70, max: 30, step: 1 },
  { key: 'crypto_pct', label: 'Crypto', min: -90, max: 100, step: 1 },
  { key: 'property_pct', label: 'Property', min: -50, max: 30, step: 1 },
  { key: 'rates_pct', label: 'Deposit rates', min: -100, max: 100, step: 5 },
  { key: 'rent_vacancy_pct', label: 'Rental income', min: -100, max: 20, step: 5 },
  { key: 'expense_shock_pct', label: 'Living costs', min: -20, max: 50, step: 1 },
]

export default function ScenariosPage() {
  const data = useAppData()
  const { fx } = useFx()
  const market = useMarketData()
  const crypto = useCryptoPrices()
  const { activeProfile } = useProfile()

  const [shocks, setShocks] = useState<Shocks>(SCENARIO_PRESETS[0].shocks)
  const [activePreset, setActivePreset] = useState<string | null>(SCENARIO_PRESETS[0].name)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

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
  const planWithExpenses = { ...plan, annual_expenses_czk: expenses.annualCZK }

  const result = useMemo(
    () => applyScenario(positions, planWithExpenses, shocks, fx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positions, shocks, fx, expenses.annualCZK]
  )

  const setShock = (key: PctShockKey, value: number) => {
    setActivePreset(null)
    setShocks(s => ({ ...s, [key]: value / 100 }))
  }

  const applyPreset = (presetName: string, presetShocks: Shocks) => {
    setActivePreset(presetName)
    setShocks(presetShocks)
  }

  const saveScenario = async () => {
    if (!activeProfile || !name.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase.from('scenarios').insert([{
        profile_id: activeProfile.id, name: name.trim(),
        description: null, shocks, is_preset: false,
      }])
      if (error) { alert(`Could not save: ${error.message}`); return }
      setName('')
      data.reload()
    } finally {
      setSaving(false)
    }
  }

  if (data.loading) return <LoadingShell label="Loading scenarios…" />

  if (positions.length === 0) {
    return (
      <PageShell>
        <PageHeader title="Scenarios" subtitle="What a bad year would actually do" />
        <EmptyState icon="⚠" title="Nothing to stress yet"
          body="Add holdings, cash, crypto or property and this page will show what a 2008-style crash, a currency move or a job loss would do to your net worth, income and runway." />
      </PageShell>
    )
  }

  const steps = waterfall(result)
  const propertyUnderwater = result.propertyEquityAfter < 0

  return (
    <PageShell maxWidth={1100}>
      <PageHeader
        title="Scenarios"
        subtitle="Stress tests against your actual positions — mortgages do not shrink when property falls"
      />

      <SetupNotice tables={data.missingTables.filter(t => t === 'scenarios')} />

      {/* Presets */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {SCENARIO_PRESETS.map(p => (
          <button key={p.name} onClick={() => applyPreset(p.name, p.shocks)} title={p.description}
            style={{
              padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
              background: activePreset === p.name ? 'var(--red-bg)' : 'var(--bg2)',
              border: `1px solid ${activePreset === p.name ? 'var(--red-bd)' : 'var(--border2)'}`,
              color: activePreset === p.name ? 'var(--red)' : 'var(--text2)',
              fontFamily: "'Geist', sans-serif",
            }}>{p.name}</button>
        ))}
        <button onClick={() => { setActivePreset(null); setShocks({}) }} style={{
          padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
          background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text3)',
        }}>Reset</button>
      </div>

      {activePreset && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14, lineHeight: 1.7 }}>
          {SCENARIO_PRESETS.find(p => p.name === activePreset)?.description}
        </div>
      )}

      <MetricCards
        columns={4}
        cards={[
          { label: 'Net worth before', value: fmtCZK(result.netWorthBefore), accent: 'var(--text3)' },
          {
            label: 'Net worth after', value: fmtCZK(result.netWorthAfter),
            accent: result.deltaCZK >= 0 ? 'var(--green)' : 'var(--red)',
            color: result.deltaCZK >= 0 ? 'var(--green)' : 'var(--red)',
            note: `${result.deltaPct >= 0 ? '+' : ''}${(result.deltaPct * 100).toFixed(1)}%`,
          },
          {
            label: 'Annual income after', value: fmtCZK(result.annualIncomeAfter),
            accent: 'var(--amber)',
            note: `was ${fmtCZK(result.annualIncomeBefore)}`,
          },
          {
            label: 'Runway after',
            value: orDash(result.runwayMonthsAfter, n => `${n.toFixed(1)} mo`),
            accent: 'var(--blue)',
            note: result.runwayMonthsBefore != null ? `was ${result.runwayMonthsBefore.toFixed(1)} mo` : undefined,
          },
        ]}
      />

      {/* Sliders */}
      <Panel title="Shock dimensions">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {SHOCK_SLIDERS.map(s => {
            const raw = shocks[s.key] ?? 0
            return (
              <div key={String(s.key)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{s.label}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, fontFamily: "'DM Mono', monospace",
                    color: raw < 0 ? 'var(--red)' : raw > 0 ? 'var(--green)' : 'var(--text3)',
                  }}>
                    {raw > 0 ? '+' : ''}{(raw * 100).toFixed(0)}%
                  </span>
                </div>
                <input type="range" min={s.min} max={s.max} step={s.step} value={raw * 100}
                  onChange={e => setShock(s.key, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: raw < 0 ? 'var(--red)' : 'var(--green)' }} />
              </div>
            )
          })}
          {/* FX shocks */}
          {['USD', 'EUR'].map(ccy => {
            const raw = shocks.fx?.[ccy] ?? 0
            return (
              <div key={ccy}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{ccy} vs CZK</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, fontFamily: "'DM Mono', monospace",
                    color: raw < 0 ? 'var(--red)' : raw > 0 ? 'var(--green)' : 'var(--text3)',
                  }}>{raw > 0 ? '+' : ''}{(raw * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min={-30} max={30} step={1} value={raw * 100}
                  onChange={e => {
                    setActivePreset(null)
                    setShocks(s => ({ ...s, fx: { ...(s.fx ?? {}), [ccy]: parseFloat(e.target.value) / 100 } }))
                  }}
                  style={{ width: '100%', accentColor: raw < 0 ? 'var(--red)' : 'var(--green)' }} />
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18, alignItems: 'center' }}>
          <input placeholder="Name this scenario" value={name} onChange={e => setName(e.target.value)}
            style={{ ...inputStyle, width: 240 }} />
          <button onClick={saveScenario} disabled={saving || !name.trim()} style={btnStyle('secondary')}>
            {saving ? 'Saving…' : 'Save scenario'}
          </button>
          {data.scenarios.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 8 }}>
              {data.scenarios.map(s => (
                <button key={s.id} onClick={() => applyPreset(s.name, s.shocks as Shocks)}
                  style={{
                    padding: '4px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                    background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text3)',
                  }}>{s.name}</button>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {/* Waterfall */}
      <Panel title="Where the loss comes from">
        {steps.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>No shock applied yet — move a slider or pick a preset.</div>
        ) : (
          <div>
            {steps.map(s => {
              const share = Math.abs(s.delta) / Math.max(1, Math.abs(result.deltaCZK))
              return (
                <div key={s.label} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: 'var(--text2)' }}>{s.label}</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", color: s.delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {s.delta >= 0 ? '+' : ''}{fmtCZK(s.delta)}
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${Math.min(share * 100, 100)}%`,
                      background: s.delta >= 0 ? 'var(--green)' : 'var(--red)',
                      borderRadius: 3, opacity: 0.8,
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {/* Impact by class */}
      <Panel title="Impact by asset class" padded={false}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Class', 'Before', 'After', 'Change', '%'].map((h, i) => (
              <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {(Object.keys(result.byClass) as (keyof typeof result.byClass)[])
              .filter(k => result.byClass[k].before !== 0 || result.byClass[k].after !== 0)
              .map(k => {
                const c = result.byClass[k]
                const pct = c.before !== 0 ? c.delta / Math.abs(c.before) : 0
                return (
                  <tr key={k}>
                    <td style={tdL}>{ASSET_CLASS_LABELS[k]}</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(c.before)}</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(c.after)}</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: c.delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {c.delta >= 0 ? '+' : ''}{fmtCZK(c.delta)}
                    </td>
                    <td style={{ ...tdR, color: c.delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {(pct * 100).toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </Panel>

      {/* What survives */}
      <Panel title="What survives">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <Survives label="Emergency runway"
            before={result.runwayMonthsBefore != null ? `${result.runwayMonthsBefore.toFixed(1)} mo` : DASH}
            after={result.runwayMonthsAfter != null ? `${result.runwayMonthsAfter.toFixed(1)} mo` : DASH}
            good={(result.runwayMonthsAfter ?? 0) >= 3} />
          <Survives label="FI progress"
            before={result.fiProgressBefore != null ? `${(result.fiProgressBefore * 100).toFixed(1)}%` : DASH}
            after={result.fiProgressAfter != null ? `${(result.fiProgressAfter * 100).toFixed(1)}%` : DASH}
            good={(result.fiProgressAfter ?? 0) >= (result.fiProgressBefore ?? 0) * 0.8} />
          <Survives label="Years to FI"
            before="—"
            after={result.yearsToFIDelta != null
              ? `${result.yearsToFIDelta >= 0 ? '+' : ''}${result.yearsToFIDelta.toFixed(1)} years`
              : DASH}
            good={(result.yearsToFIDelta ?? 0) < 3} />
          <Survives label="Income vs expenses"
            before={fmtCZK(result.annualIncomeBefore)}
            after={fmtCZK(result.annualIncomeAfter)}
            good={result.annualIncomeAfter >= planWithExpenses.annual_expenses_czk} />
        </div>

        {propertyUnderwater && (
          <div style={{
            marginTop: 14, padding: '10px 14px', background: 'var(--red-bg)',
            border: '1px solid var(--red-bd)', borderRadius: 7,
            fontSize: 11, color: 'var(--red)', lineHeight: 1.7,
          }}>
            ⚠ Property equity is negative at {fmtCZK(result.propertyEquityAfter)} — the mortgage now
            exceeds the property&rsquo;s value. Debt does not fall when prices do, which is exactly
            what this scenario is for.
          </div>
        )}
      </Panel>
    </PageShell>
  )
}

function Survives({ label, before, after, good }: {
  label: string; before: string; after: string; good: boolean
}) {
  return (
    <div style={{
      padding: '12px 14px', background: 'var(--bg3)',
      border: `1px solid ${good ? 'var(--green-bd)' : 'var(--red-bd)'}`, borderRadius: 8,
    }}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text4)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text4)' }}>{before}</span>
        <span style={{ fontSize: 11, color: 'var(--text4)' }}>→</span>
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: 14,
          color: good ? 'var(--green)' : 'var(--red)',
        }}>{after}</span>
      </div>
    </div>
  )
}
