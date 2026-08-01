'use client'
import { useEffect, useMemo, useState } from 'react'
import Badge from '@/components/Badge'
import RunwayCard from '@/components/RunwayCard'
import { PageShell, PageHeader, LoadingShell, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import { useAppData } from '@/hooks/useAppData'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { useProfile } from '@/lib/profile'
import { buildPositions, investableNetWorthCZK } from '@/lib/portfolio'
import {
  DEFAULT_PLAN, fiNumber, fiProgress, savingsRate, currentSwrIncome,
  yearsToFI, coastFireNumber, projectPath, milestones, effectiveAnnualExpenses, ageIn,
} from '@/lib/fire'
import { supabase, type FinancialPlan } from '@/lib/supabase'
import { fmtCZK } from '@/lib/fx'
import { tdR, tdL, th, btnStyle, inputStyle } from '@/lib/ui'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

export default function FirePage() {
  const data = useAppData()
  const { fx } = useFx()
  const market = useMarketData()
  const crypto = useCryptoPrices()
  const { activeProfile } = useProfile()

  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Partial<FinancialPlan> | null>(null)

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

  // Draft overlays the stored plan so sliders recalculate live before saving
  const plan = { ...DEFAULT_PLAN, ...(data.financialPlan ?? {}), ...(draft ?? {}) }
  const expenses = effectiveAnnualExpenses(plan, data.expenseLog)
  const annualExpenses = expenses.annualCZK

  const investable = investableNetWorthCZK(positions, {
    includePrimaryResidence: plan.include_primary_residence,
    includeProperty: plan.include_property_in_fi,
  })

  const target = fiNumber(annualExpenses, plan.swr_pct)
  const progress = fiProgress(investable, target)
  const years = yearsToFI(investable, plan.monthly_contribution_czk, plan.expected_real_return, target)
  const swrIncome = currentSwrIncome(investable, plan.swr_pct)
  const rate = savingsRate(plan.annual_income_czk, annualExpenses)

  const yearsToRetirement = plan.birth_year && plan.target_retirement_age
    ? Math.max(0, plan.target_retirement_age - (new Date().getFullYear() - plan.birth_year))
    : 20
  const coast = coastFireNumber(target, yearsToRetirement, plan.expected_real_return)

  const path = useMemo(
    () => projectPath(investable, plan.monthly_contribution_czk, plan.expected_real_return,
      Math.min(Math.max(years ?? 30, 5), 50)),
    [investable, plan.monthly_contribution_czk, plan.expected_real_return, years]
  )

  const stones = milestones(investable, annualExpenses, plan.monthly_contribution_czk, plan.expected_real_return)

  const update = (patch: Partial<FinancialPlan>) => setDraft(d => ({ ...(d ?? {}), ...patch }))

  const savePlan = async () => {
    if (!activeProfile || !draft) return
    setSaving(true)
    try {
      const { error } = await supabase.from('financial_plan').upsert({
        profile_id: activeProfile.id,
        annual_expenses_czk: plan.annual_expenses_czk,
        annual_income_czk: plan.annual_income_czk,
        monthly_contribution_czk: plan.monthly_contribution_czk,
        swr_pct: plan.swr_pct,
        expected_real_return: plan.expected_real_return,
        inflation_pct: plan.inflation_pct,
        birth_year: plan.birth_year,
        target_retirement_age: plan.target_retirement_age,
        include_property_in_fi: plan.include_property_in_fi,
        include_primary_residence: plan.include_primary_residence,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id' })
      if (error) { alert(`Could not save plan: ${error.message}`); return }
      setDraft(null)
      data.reload()
    } finally {
      setSaving(false)
    }
  }

  if (data.loading) return <LoadingShell label="Loading plan…" />

  const pct = progress != null ? Math.min(progress, 1) : 0
  const covered = swrIncome >= annualExpenses

  return (
    <PageShell maxWidth={1100}>
      <PageHeader
        title="Financial independence"
        subtitle={
          <>
            Expenses from {expenses.source === 'logged'
              ? `${expenses.monthsOfData} months of logged spending`
              : 'your plan'} · {fmtCZK(annualExpenses)}/year
          </>
        }
        actions={draft ? (
          <button onClick={savePlan} disabled={saving} style={btnStyle('primary')}>
            {saving ? 'Saving…' : 'Save plan'}
          </button>
        ) : undefined}
      />

      {/* Hero progress */}
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16,
        padding: '28px 32px', marginBottom: 18,
      }}>
        <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10, fontWeight: 500 }}>
          Progress to financial independence
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14 }}>
          <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--green)' }}>
            {progress != null ? `${(progress * 100).toFixed(1)}%` : DASH}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>
            {fmtCZK(investable)} of {orDash(target, fmtCZK)}
          </span>
        </div>
        <div style={{ height: 12, background: 'var(--bg4)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct * 100}%`,
            background: 'linear-gradient(90deg, var(--green), var(--teal))',
            borderRadius: 6, transition: 'width 0.6s ease',
          }} />
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text4)' }}>
          Investable net worth excludes your primary residence
          {plan.include_primary_residence ? ' (currently included)' : ''} — mortgages are subtracted either way.
        </div>
      </div>

      <MetricCards
        columns={5}
        cards={[
          { label: 'FI number', value: orDash(target, fmtCZK), accent: 'var(--green)', note: `${(plan.swr_pct * 100).toFixed(2)}% withdrawal rate` },
          { label: 'Years to FI', value: orDash(years, n => n.toFixed(1)), accent: 'var(--blue)', note: years != null ? `age ${ageIn(plan.birth_year, years) ?? '—'}` : 'add a contribution' },
          { label: 'Projected FI date', value: years != null ? String(new Date().getFullYear() + Math.ceil(years)) : DASH, accent: 'var(--teal)', note: 'at current contribution' },
          { label: 'Savings rate', value: orDash(rate, n => `${(n * 100).toFixed(0)}%`), accent: 'var(--amber)', note: plan.annual_income_czk ? 'of income' : 'set income below' },
          {
            label: `${(plan.swr_pct * 100).toFixed(1)}% income`,
            value: fmtCZK(swrIncome),
            accent: covered ? 'var(--green)' : 'var(--amber)',
            color: covered ? 'var(--green)' : 'var(--text)',
            note: covered ? 'covers your expenses' : `${fmtCZK(annualExpenses - swrIncome)} short`,
          },
        ]}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        {/* Coast FIRE */}
        <Panel title="Coast FIRE">
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 12 }}>
            The pot that, left completely alone, still compounds to your FI number in{' '}
            {yearsToRetirement} years at {(plan.expected_real_return * 100).toFixed(1)}% real.
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, color: 'var(--teal)' }}>
              {orDash(coast, fmtCZK)}
            </span>
            {coast != null && (
              <Badge variant={investable >= coast ? 'green' : 'gray'}>
                {investable >= coast ? 'reached — you could stop contributing' : `${fmtCZK(coast - investable)} to go`}
              </Badge>
            )}
          </div>
        </Panel>

        {/* Emergency runway */}
        <RunwayCard positions={positions} monthlyExpenses={annualExpenses / 12} accounts={data.bankAccounts} />
      </div>

      {/* Assumptions */}
      <Panel title="Assumptions" right={draft ? <Badge variant="amber">unsaved</Badge> : undefined}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 18 }}>
          <SliderRow
            label="Safe withdrawal rate" value={plan.swr_pct * 100} min={3} max={5} step={0.05}
            suffix="%" onChange={v => update({ swr_pct: v / 100 })}
          />
          <SliderRow
            label="Expected real return" value={plan.expected_real_return * 100} min={0} max={10} step={0.25}
            suffix="%" onChange={v => update({ expected_real_return: v / 100 })}
          />
          <NumberRow
            label="Annual expenses (CZK)" value={plan.annual_expenses_czk}
            onChange={v => update({ annual_expenses_czk: v })}
            hint={expenses.source === 'logged' ? 'overridden by logged spending' : undefined}
          />
          <NumberRow
            label="Annual income (CZK)" value={plan.annual_income_czk ?? 0}
            onChange={v => update({ annual_income_czk: v })}
          />
          <NumberRow
            label="Monthly contribution (CZK)" value={plan.monthly_contribution_czk}
            onChange={v => update({ monthly_contribution_czk: v })}
          />
          <NumberRow
            label="Birth year" value={plan.birth_year ?? 0}
            onChange={v => update({ birth_year: v || null })}
          />
          <div style={{ gridColumn: '1/-1', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <Toggle
              label="Count property toward FI"
              checked={plan.include_property_in_fi}
              onChange={v => update({ include_property_in_fi: v })}
            />
            <Toggle
              label="Count primary residence"
              checked={plan.include_primary_residence}
              onChange={v => update({ include_primary_residence: v })}
            />
          </div>
        </div>
        <div style={{
          marginTop: 16, padding: '10px 14px', background: 'var(--bg3)',
          border: '1px solid var(--border)', borderRadius: 7,
          fontSize: 11, color: 'var(--text3)', lineHeight: 1.7,
        }}>
          ⓘ The 4% rule comes from US historical data over 30-year retirements. A Czech investor
          planning for a longer horizon, or holding a different asset mix, may prefer 3.25–3.5%.
          Move the slider and watch the FI number — the sensitivity is the lesson. This is a
          planning tool, not advice.
        </div>
      </Panel>

      {/* Projection chart */}
      <Panel title="Projected path" right={<Badge variant="gray">real terms</Badge>}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={path} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="fireGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1a7a3a" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#1a7a3a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 9, fill: 'var(--text3)' }}
              tickFormatter={y => `${y}y`} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text3)' }} width={64}
              tickFormatter={n => `${(n / 1_000_000).toFixed(1)}M`} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(v: number) => fmtCZK(v)}
              labelFormatter={(y: number) => `Year ${y}${plan.birth_year ? ` · age ${ageIn(plan.birth_year, y)}` : ''}`}
              contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 11 }}
            />
            {target != null && (
              <ReferenceLine y={target} stroke="var(--green)" strokeDasharray="4 4"
                label={{ value: 'FI number', fontSize: 9, fill: 'var(--green)', position: 'insideTopRight' }} />
            )}
            <Area type="monotone" dataKey="value" stroke="var(--green)" strokeWidth={2} fill="url(#fireGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      {/* Milestones */}
      <Panel title="Milestones" padded={false}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Milestone', 'Target', 'Status', 'When'].map((h, i) => (
              <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {stones.map(m => (
              <tr key={m.label}>
                <td style={tdL}>{m.label}</td>
                <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(m.targetCZK)}</td>
                <td style={tdR}>
                  {m.reached ? <Badge variant="green">reached</Badge> : <Badge variant="gray">ahead</Badge>}
                </td>
                <td style={{ ...tdR, color: 'var(--text3)' }}>
                  {m.reached ? '—' : orDash(m.yearsAway, n => `${n.toFixed(1)}y · ${new Date().getFullYear() + Math.ceil(n)}`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </PageShell>
  )
}

function SliderRow({ label, value, min, max, step, suffix, onChange }: {
  label: string; value: number; min: number; max: number; step: number
  suffix?: string; onChange: (v: number) => void
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>
          {value.toFixed(2)}{suffix}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--green)' }} />
    </div>
  )
}

function NumberRow({ label, value, onChange, hint }: {
  label: string; value: number; onChange: (v: number) => void; hint?: string
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 5 }}>
        {label}
        {hint && <span style={{ color: 'var(--amber)', marginLeft: 6, fontSize: 10 }}>{hint}</span>}
      </div>
      <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{ ...inputStyle, fontFamily: "'DM Mono', monospace" }} />
    </div>
  )
}

function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 14, height: 14, accentColor: 'var(--green)', cursor: 'pointer' }} />
      <span style={{ fontSize: 12, color: 'var(--text2)' }}>{label}</span>
    </label>
  )
}
