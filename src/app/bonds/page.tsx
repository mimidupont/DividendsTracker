'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { BondHolding, BondIssuerType, CouponFrequency, CouponType, DayCount } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import { useFx } from '@/hooks/useFx'
import { useRateOn } from '@/hooks/useRateOn'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel } from '@/components/PageShell'
import Badge from '@/components/Badge'
import Modal from '@/components/Modal'
import RecordModal, { type RecordPreset } from '@/components/RecordModal'
import DataTable, { type Column } from '@/components/DataTable'
import { Field, FormGrid, FormActions, ErrorBox, NumberInput, Checkbox, Notice, inputStyle } from '@/components/FormFields'
import { useUndoableDelete } from '@/components/UndoToast'
import { toCZK, fmtCZK, fmtSignedCZK, fmtNum, fmtShare } from '@/lib/fx'
import { fmtISODate, todayISO, daysBetween } from '@/lib/date'
import {
  valueBond, yieldToMaturity, bondRisk, futureCashFlows, annualCouponLocal, accruedInterest,
} from '@/lib/bonds'
import { costToCZK } from '@/lib/portfolio'
import { updateScoped, recordEvent, isMissingFunction } from '@/lib/db'
import { parseDecimal, parsePercent } from '@/lib/parse'
import { CZ_COUPON_TAX } from '@/lib/tax'
import { btnStyle, actionBtn, signColor } from '@/lib/ui'

const ISSUER_LABEL: Record<BondIssuerType, string> = {
  government: 'Government', corporate: 'Corporate', municipal: 'Municipal', savings: 'Savings bond',
}
const FREQ_LABEL: Record<number, string> = { 0: 'Zero-coupon', 1: 'Annual', 2: 'Semi-annual', 4: 'Quarterly', 12: 'Monthly' }

interface Row {
  b: BondHolding
  valueCZK: number
  costCZK: number
  cleanPct: number
  basis: ReturnType<typeof valueBond>['basis']
  ytm: number | null
  duration: number | null
  nextCoupon: string | null
  couponCZK: number
}

/**
 * Bonds held directly: government, corporate and Czech savings bonds. Valued
 * at clean price + accrued interest; yield, duration and the coupon calendar
 * are computed from each bond's terms (src/lib/bonds.ts).
 */
export default function BondsPage() {
  const { bondHoldings, missingTables, loading, reload } = useAppData()
  const { activeProfile } = useProfile()
  const { fx, fxTs } = useFx()
  const [editing, setEditing] = useState<BondHolding | 'new' | null>(null)
  const [record, setRecord] = useState<RecordPreset | null>(null)
  const { schedule, pendingIds, toast } = useUndoableDelete()
  const today = todayISO()

  const rows: Row[] = useMemo(() => bondHoldings
    .filter(b => !pendingIds.has(b.id) && b.quantity > 0)
    .map(b => {
      const v = valueBond(b, today)
      const ytm = yieldToMaturity(b, v.cleanPct, today)
      const risk = ytm != null ? bondRisk(b, ytm, today) : null
      const next = futureCashFlows(b, today).find(cf => !cf.isPrincipal)?.date ?? null
      return {
        b, valueCZK: toCZK(v.valueLocal, b.currency, fx),
        costCZK: costToCZK(v.costLocal, b.currency, b.purchase_fx_czk, fx).czk,
        cleanPct: v.cleanPct, basis: v.basis, ytm,
        duration: b.redeemable_early ? 0 : risk?.modified ?? null,
        nextCoupon: next,
        couponCZK: toCZK(annualCouponLocal(b, today), b.currency, fx),
      }
    }), [bondHoldings, pendingIds, fx, today])

  const value = rows.reduce((s, r) => s + r.valueCZK, 0)
  const cost = rows.reduce((s, r) => s + r.costCZK, 0)
  const income = rows.reduce((s, r) => s + r.couponCZK, 0)
  const wtd = (f: (r: Row) => number | null) => {
    const known = rows.filter(r => f(r) != null)
    const w = known.reduce((s, r) => s + r.valueCZK, 0)
    return w > 0 ? known.reduce((s, r) => s + (f(r) as number) * r.valueCZK, 0) / w : null
  }
  const avgYtm = wtd(r => r.ytm)
  const avgDur = wtd(r => r.duration)

  // Maturity ladder: principal due per calendar year.
  const ladder = useMemo(() => {
    const byYear = new Map<number, number>()
    for (const r of rows) {
      const y = Number(r.b.maturity_date.slice(0, 4))
      byYear.set(y, (byYear.get(y) ?? 0) + toCZK(r.b.face_value * r.b.quantity, r.b.currency, fx))
    }
    return Array.from(byYear).sort((a, b) => a[0] - b[0])
  }, [rows, fx])
  const ladderMax = Math.max(1, ...ladder.map(([, v]) => v))

  if (loading) return <LoadingShell />

  if (missingTables.includes('bond_holdings')) {
    return (
      <PageShell>
        <PageHeader eyebrow="Assets" accent="var(--c-bond)" title="Bonds" />
        <EmptyState icon="▥" title="Bonds need a database update"
          body={<>Run <code>supabase/migrations/011_bonds.sql</code> (and 010, 012) in the Supabase SQL editor, then reload.</>} />
      </PageShell>
    )
  }

  const columns: Column<Row>[] = [
    { key: 'name', label: 'Bond', sortValue: r => r.b.name, render: r => <>
      <div style={{ fontWeight: 500 }}>{r.b.name}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {r.b.isin} · <Badge variant="gray">{ISSUER_LABEL[r.b.issuer_type]}</Badge>
        {r.b.coupon_type !== 'fixed' && <Badge variant="gray">{r.b.coupon_type}</Badge>}
      </div>
    </> },
    { key: 'qty', label: 'Held', numeric: true, sortValue: r => r.b.quantity, render: r => <>
      {fmtNum(r.b.quantity, 0)} × {fmtNum(r.b.face_value, 0)}
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{r.b.currency} nominal</div>
    </> },
    { key: 'coupon', label: 'Coupon', numeric: true, sortValue: r => r.b.coupon_rate, render: r => <>
      {r.b.coupon_freq === 0 ? 'zero' : fmtShare(r.b.coupon_rate * 100, 2)}
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{FREQ_LABEL[r.b.coupon_freq]}</div>
    </> },
    { key: 'maturity', label: 'Matures', numeric: true, sortValue: r => r.b.maturity_date, render: r => <>
      {fmtISODate(r.b.maturity_date)}
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{(daysBetween(today, r.b.maturity_date) / 365).toFixed(1)} years</div>
    </> },
    { key: 'price', label: 'Clean price', numeric: true, sortValue: r => r.cleanPct, render: r => <>
      {fmtNum(r.cleanPct, 2)} %
      <div style={{ fontSize: 10, color: r.basis === 'cost' ? 'var(--amber)' : 'var(--text3)' }}>
        {r.basis === 'market' ? (r.b.price_date ? `as of ${fmtISODate(r.b.price_date)}` : 'entered') : r.basis === 'redemption' ? 'redemption value' : r.basis === 'cost' ? 'at cost — enter a price' : 'par'}
      </div>
    </> },
    { key: 'ytm', label: 'Yield (YTM)', numeric: true, sortValue: r => r.ytm, render: r => r.ytm != null ? fmtShare(r.ytm * 100, 2) : '—' },
    { key: 'dur', label: 'Duration', numeric: true, sortValue: r => r.duration, render: r => r.duration != null ? `${r.duration.toFixed(1)} y` : '—' },
    { key: 'value', label: 'Value incl. accrued', numeric: true, sortValue: r => r.valueCZK, render: r => <>
      {fmtCZK(r.valueCZK)}
      <div style={{ fontSize: 10, color: signColor(r.valueCZK - r.costCZK) }}>{fmtSignedCZK(r.valueCZK - r.costCZK)}</div>
    </> },
    { key: 'next', label: 'Next coupon', numeric: true, sortValue: r => r.nextCoupon, render: r => r.nextCoupon ? fmtISODate(r.nextCoupon) : '—' },
    { key: 'actions', label: '', align: 'center', render: r => (
      <span style={{ whiteSpace: 'nowrap' }}>
        <button type="button" aria-label={`Record coupon on ${r.b.name}`} title="Record coupon" onClick={() => setRecord({ kind: 'coupon', bondId: r.b.id })} style={actionBtn}>%</button>
        <button type="button" aria-label={`Buy more ${r.b.name}`} title="Buy" onClick={() => setRecord({ kind: 'buy', asset: 'bond', bondId: r.b.id })} style={{ ...actionBtn, marginLeft: 4 }}>+</button>
        <button type="button" aria-label={`Sell ${r.b.name}`} title="Sell / redeem" onClick={() => setRecord({ kind: 'sell', asset: 'bond', bondId: r.b.id })} style={{ ...actionBtn, marginLeft: 4 }}>−</button>
        <button type="button" aria-label={`Edit ${r.b.name}`} title="Edit terms / price" onClick={() => setEditing(r.b)} style={{ ...actionBtn, marginLeft: 4 }}>✎</button>
        <button type="button" aria-label={`Archive ${r.b.name}`} title="Archive" onClick={() =>
          schedule(r.b.id, r.b.name, () => updateScoped('bond_holdings', r.b.id, activeProfile?.id, { is_active: false }), reload)}
          style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}>✕</button>
      </span>
    ) },
  ]

  return (
    <PageShell>
      {toast}
      {editing && <BondModal bond={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {record && <RecordModal preset={record} onClose={() => setRecord(null)} onSaved={reload} />}
      <PageHeader
        eyebrow="Assets"
        accent="var(--c-bond)"
        title="Bonds & fixed income"
        subtitle={<>Valued at clean price plus accrued interest{fxTs && <> · FX {fxTs}</>}.
          Bond ETFs stay on <Link href="/holdings">Stocks &amp; ETFs</Link> — tag them “bond ETF” on <Link href="/allocation#classification">Allocation</Link> to count them as fixed income.</>}
        actions={<button type="button" onClick={() => setEditing('new')} style={btnStyle('primary')}>+ Add bond</button>}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="▥"
          title="No bonds yet"
          body={<>Add a government, corporate or Czech savings bond (Dluhopisy Republiky) with its ISIN, coupon and maturity.
            Bonds then get their own bucket in net worth and allocation, with accrued interest, yield to maturity and a
            maturity ladder.</>}
          action={<button type="button" onClick={() => setEditing('new')} style={btnStyle('primary')}>+ Add a bond</button>}
        />
      ) : <>
        <MetricCards cards={[
          { label: 'Value', value: fmtCZK(value), accent: 'var(--c-bond)', note: `${rows.length} bonds · incl. accrued` },
          { label: 'Coupons a year', value: fmtCZK(income), accent: 'var(--c-income)', note: `gross · ≈ ${fmtCZK(income * (1 - CZ_COUPON_TAX))} after 15 % tax` },
          { label: 'Avg yield to maturity', value: avgYtm != null ? fmtShare(avgYtm * 100, 2) : '—', accent: 'var(--border3)', note: 'value-weighted' },
          { label: 'Avg duration', value: avgDur != null ? `${avgDur.toFixed(1)} y` : '—', accent: 'var(--border3)',
            note: avgDur != null ? `+1 pp in yields ≈ ${fmtSignedCZK(-value * avgDur * 0.01)}` : undefined },
          { label: 'Gain vs cost', value: fmtSignedCZK(value - cost), color: signColor(value - cost), accent: 'var(--border3)' },
        ]} />

        <Panel title="Positions" padded={false}>
          <DataTable caption="Bond positions" columns={columns} rows={rows} rowKey={r => r.b.id} initialSort={{ key: 'maturity', dir: 'asc' }} />
        </Panel>

        <Panel title="Maturity ladder (principal due)">
          <ul aria-label="Principal due by year" style={{ listStyle: 'none', display: 'grid', gap: 8 }}>
            {ladder.map(([y, v]) => (
              <li key={y} style={{ display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 10, alignItems: 'center', fontSize: 12 }}>
                <span className="num">{y}</span>
                <span aria-hidden="true" style={{ height: 10, background: 'var(--bg4)', borderRadius: 3, overflow: 'hidden' }}>
                  <span style={{ display: 'block', width: `${(v / ladderMax) * 100}%`, height: '100%', background: 'var(--c-bond)' }} />
                </span>
                <span className="num">{fmtCZK(v)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </>}
    </PageShell>
  )
}

/** Add or edit a bond's terms and price. A new bond with a quantity is recorded as a purchase. */
function BondModal({ bond, onClose, onSaved }: { bond: BondHolding | null; onClose: () => void; onSaved: () => void }) {
  const { activeProfile } = useProfile()
  const b = bond
  const [form, setForm] = useState({
    isin: b?.isin ?? '', name: b?.name ?? '', issuer_type: (b?.issuer_type ?? 'government') as BondIssuerType,
    currency: b?.currency ?? 'CZK', face_value: b ? String(b.face_value) : '1000',
    coupon_rate: b ? String(Number((b.coupon_rate * 100).toFixed(4))) : '', coupon_freq: String(b?.coupon_freq ?? 1),
    coupon_type: (b?.coupon_type ?? 'fixed') as CouponType, day_count: (b?.day_count ?? 'ACT/ACT') as DayCount,
    issue_date: b?.issue_date ?? '', maturity_date: b?.maturity_date ?? '',
    redeemable_early: b?.redeemable_early ?? false,
    clean_price_pct: b?.clean_price_pct != null ? String(b.clean_price_pct) : '', price_date: b?.price_date ?? todayISO(),
    // New bond only: the first purchase
    quantity: '', purchase_date: todayISO(), purchase_price_pct: '100',
    notes: b?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))
  const rateOn = useRateOn(form.currency, form.purchase_date)

  const save = async () => {
    const face = parseDecimal(form.face_value)
    const coupon = form.coupon_rate.trim() ? parsePercent(form.coupon_rate) : 0
    const price = form.clean_price_pct.trim() ? parseDecimal(form.clean_price_pct) : null
    if (!form.isin.trim() || !form.name.trim()) { setError('ISIN and name are required.'); return }
    if (face == null || face <= 0) { setError('Face value must be positive.'); return }
    if (coupon == null || coupon < 0 || coupon > 1) { setError('Coupon must be a percentage.'); return }
    if (!form.maturity_date) { setError('Maturity date is required.'); return }
    if (form.issue_date && form.issue_date >= form.maturity_date) { setError('Issue date must be before maturity.'); return }
    if (form.clean_price_pct.trim() && (price == null || price <= 0)) { setError('Price must be a positive % of par (e.g. 98,5).'); return }
    const terms = {
      isin: form.isin.trim().toUpperCase(), name: form.name.trim(), issuer_type: form.issuer_type,
      currency: form.currency, face_value: face, coupon_rate: coupon, coupon_freq: Number(form.coupon_freq) as CouponFrequency,
      coupon_type: form.coupon_type, day_count: form.day_count, issue_date: form.issue_date || null,
      maturity_date: form.maturity_date, redeemable_early: form.redeemable_early,
      clean_price_pct: price, price_date: price != null ? (form.price_date || todayISO()) : null,
      notes: form.notes.trim() || null, updated_at: new Date().toISOString(),
    }
    setSaving(true)
    if (b) {
      const { error: err } = await updateScoped('bond_holdings', b.id, activeProfile?.id, terms)
      setSaving(false)
      if (err) { setError(err); return }
      onSaved(); onClose(); return
    }
    if (!activeProfile) { setSaving(false); setError('No active profile selected.'); return }
    const qty = form.quantity.trim() ? parseDecimal(form.quantity) : 0
    const buyPct = parseDecimal(form.purchase_price_pct)
    if (qty == null || qty < 0 || (qty > 0 && (buyPct == null || buyPct <= 0))) {
      setSaving(false); setError('Quantity and purchase price must be valid numbers.'); return
    }
    // Create the bond with zero quantity, then record the purchase — so the
    // ledger, the purchase price and its FX rate are all written.
    const { data, error: insErr } = await supabase.from('bond_holdings')
      .insert([{ ...terms, quantity: 0, profile_id: activeProfile.id }]).select('id').single()
    if (insErr || !data) { setSaving(false); setError(insErr?.message ?? 'Could not create the bond.'); return }
    if (qty > 0) {
      const fxRate = form.currency === 'CZK' ? 1 : rateOn.rate
      if (fxRate == null) { setSaving(false); setError(`No CZK/${form.currency} rate for ${form.purchase_date}.`); onSaved(); return }
      const accrued = accruedInterest({ ...terms, coupon_freq: terms.coupon_freq } as BondHolding, form.purchase_date) * qty
      const { error: recErr } = await recordEvent(activeProfile.id, {
        kind: 'buy', asset_class: 'bond', bond_id: data.id, date: form.purchase_date, currency: form.currency,
        fx_rate_czk: fxRate, quantity: qty, price_pct: buyPct!, accrued,
      })
      if (recErr) {
        setSaving(false)
        setError(isMissingFunction({ message: recErr }) ? recErr : `Bond created, but the purchase could not be recorded: ${recErr}`)
        onSaved(); return
      }
    }
    setSaving(false)
    onSaved(); onClose()
  }

  return (
    <Modal title={b ? 'Edit bond' : 'Add bond'} subtitle={b ? `${b.name} · ${b.isin}` : undefined} onClose={onClose} width={600}>
      {b && <Notice tone="gray">Buy, sell and coupons go through Record (+, −, % on the row). This form edits the terms and the price.</Notice>}
      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="ISIN"><input style={inputStyle} value={form.isin} onChange={e => set('isin', e.target.value)} placeholder="CZ0001005037" disabled={!!b} /></Field>
        <Field label="Name"><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="ČR 4,50/2030" /></Field>
        <Field label="Issuer type">
          <select style={inputStyle} value={form.issuer_type} onChange={e => set('issuer_type', e.target.value as BondIssuerType)}>
            {Object.entries(ISSUER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Currency">
          <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)} disabled={!!b}>
            <option>CZK</option><option>EUR</option><option>USD</option>
          </select>
        </Field>
        <Field label="Face value of one bond"><NumberInput value={form.face_value} onChange={v => set('face_value', v)} suffix={form.currency} /></Field>
        <Field label="Coupon"><NumberInput value={form.coupon_rate} onChange={v => set('coupon_rate', v)} placeholder="4,5" suffix="%" /></Field>
        <Field label="Coupon frequency">
          <select style={inputStyle} value={form.coupon_freq} onChange={e => set('coupon_freq', e.target.value)}>
            {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Coupon type">
          <select style={inputStyle} value={form.coupon_type} onChange={e => set('coupon_type', e.target.value as CouponType)}>
            <option value="fixed">Fixed</option><option value="floating">Floating</option>
            <option value="inflation">Inflation-linked</option><option value="reinvest">Reinvesting (savings bond)</option>
          </select>
        </Field>
        <Field label="Issue date"><input style={inputStyle} type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} /></Field>
        <Field label="Maturity date"><input style={inputStyle} type="date" value={form.maturity_date} onChange={e => set('maturity_date', e.target.value)} /></Field>
        <Field label="Day count" hint="Czech government bonds: ACT/ACT. Many corporates: 30E/360.">
          <select style={inputStyle} value={form.day_count} onChange={e => set('day_count', e.target.value as DayCount)}>
            <option>ACT/ACT</option><option>ACT/365</option><option>30E/360</option>
          </select>
        </Field>
        <Field label="" >
          <Checkbox checked={form.redeemable_early} onChange={v => set('redeemable_early', v)} label="Redeemable early at par (savings bond)" />
        </Field>
        <Field label="Current clean price (% of par)" hint="From your broker or the exchange. Empty = valued at purchase price.">
          <NumberInput value={form.clean_price_pct} onChange={v => set('clean_price_pct', v)} placeholder="98,75" suffix="%" />
        </Field>
        <Field label="Price date"><input style={inputStyle} type="date" value={form.price_date} onChange={e => set('price_date', e.target.value)} /></Field>
        {!b && (<>
          <Field label="Bonds bought (optional)" hint="Records the purchase with its date and FX rate."><NumberInput value={form.quantity} onChange={v => set('quantity', v)} placeholder="10" /></Field>
          <Field label="Purchase clean price"><NumberInput value={form.purchase_price_pct} onChange={v => set('purchase_price_pct', v)} suffix="%" /></Field>
          <Field label="Purchase date" hint={form.currency !== 'CZK' ? rateOn.source : undefined}><input style={inputStyle} type="date" value={form.purchase_date} max={todayISO()} onChange={e => set('purchase_date', e.target.value)} /></Field>
        </>)}
        <Field label="Notes (optional)" span="2"><input style={inputStyle} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
      </FormGrid>
      <FormActions onCancel={onClose} onSubmit={save} label={b ? 'Save changes' : 'Add bond'} saving={saving} />
    </Modal>
  )
}
