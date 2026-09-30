'use client'
import { useState } from 'react'
import type { RealEstate } from '@/lib/supabase'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import { useFx } from '@/hooks/useFx'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards } from '@/components/PageShell'
import Badge from '@/components/Badge'
import Modal from '@/components/Modal'
import { Field, FormGrid, FormActions, ErrorBox, NumberInput, Checkbox, inputStyle } from '@/components/FormFields'
import { useUndoableDelete } from '@/components/UndoToast'
import { toCZK, fmtCZK, fmtSignedCZK, fmtShare, fmtNum } from '@/lib/fx'
import { fmtISODate, todayISO, daysBetween } from '@/lib/date'
import { updateScoped, insertScoped, deleteScoped } from '@/lib/db'
import { parseDecimal, parsePercent } from '@/lib/parse'
import { btnStyle, actionBtn, signColor } from '@/lib/ui'

const TYPE_LABELS: Record<string, string> = { residential: 'Residential', commercial: 'Commercial', land: 'Land', reit: 'REIT' }

/** Your share of a property, 0–1. Applied to value, cost, mortgage, rent and costs alike. */
const share = (p: RealEstate) => (isFinite(p.ownership_pct) ? Math.min(Math.max(p.ownership_pct, 0), 100) : 100) / 100

export default function RealEstatePage() {
  const { realEstate, loading, reload } = useAppData()
  const { activeProfile } = useProfile()
  const { fx, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const [editing, setEditing] = useState<RealEstate | 'new' | null>(null)
  const { schedule, pendingIds, toast } = useUndoableDelete()
  const properties = realEstate.filter(p => !pendingIds.has(p.id))
  const today = todayISO()

  const czk = (p: RealEstate, v: number) => toCZK(v * share(p), p.currency, fx)
  const totalValue    = properties.reduce((s, p) => s + czk(p, p.current_value), 0)
  const totalPurchase = properties.reduce((s, p) => s + czk(p, p.purchase_price), 0)
  const totalMortgage = properties.reduce((s, p) => s + czk(p, p.mortgage_balance), 0)
  const totalEquity   = totalValue - totalMortgage
  const netRent       = properties.reduce((s, p) => s + czk(p, p.monthly_rent * 12 - (p.annual_costs ?? 0)), 0)
  const mortgageInterest = properties.reduce((s, p) => s + czk(p, p.mortgage_balance * p.mortgage_rate), 0)

  if (loading) return <LoadingShell />

  return (
    <PageShell>
      {toast}
      {editing && <PropertyModal property={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      <PageHeader
        eyebrow="Assets"
        accent="var(--c-realestate)"
        title="Real estate"
        subtitle={<>All figures are your ownership share{fxTs && <> · FX {fxTs}</>}</>}
        actions={<>
          <button type="button" onClick={refreshFx} disabled={fxLoading} style={btnStyle('secondary')}>{fxLoading ? '⟳ FX…' : '↻ FX'}</button>
          <button type="button" onClick={() => setEditing('new')} style={btnStyle('primary')}>+ Add property</button>
        </>}
      />

      {properties.length === 0 ? (
        <EmptyState
          icon="⌂"
          title="No properties yet"
          body="Add a property with its value, mortgage and your ownership share. Mark your home as the primary residence — it is then left out of investable net worth (with its mortgage) on the FIRE page."
          action={<button type="button" onClick={() => setEditing('new')} style={btnStyle('primary')}>+ Add a property</button>}
        />
      ) : <>
        <MetricCards cards={[
          { label: 'Equity', value: fmtCZK(totalEquity), accent: 'var(--c-realestate)', note: `value ${fmtCZK(totalValue)} − mortgages ${fmtCZK(totalMortgage)}` },
          { label: 'Gain on purchase', value: fmtSignedCZK(totalValue - totalPurchase), color: signColor(totalValue - totalPurchase), accent: 'var(--border3)',
            note: totalPurchase > 0 ? fmtShare(((totalValue - totalPurchase) / totalPurchase) * 100, 1) : undefined },
          { label: 'Rent after costs', value: netRent !== 0 ? fmtCZK(netRent) : '—', accent: 'var(--c-income)',
            note: mortgageInterest > 0 ? `mortgage interest ≈ ${fmtCZK(mortgageInterest)}/yr` : 'a year, before tax' },
          { label: 'Loan-to-value', value: totalValue > 0 ? fmtShare((totalMortgage / totalValue) * 100, 0) : '—', accent: 'var(--border3)' },
        ]} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {properties.map(p => {
            const value = czk(p, p.current_value)
            const debt = czk(p, p.mortgage_balance)
            const equity = value - debt
            const ltv = value > 0 ? debt / value : null
            const rentNet = czk(p, p.monthly_rent * 12 - (p.annual_costs ?? 0))
            const interest = czk(p, p.mortgage_balance * p.mortgage_rate)
            const age = p.valuation_date ? daysBetween(p.valuation_date, today) : null
            return (
              <article key={p.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', position: 'relative' }}>
                <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--c-realestate)', borderRadius: '12px 12px 0 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</h2>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{p.address ?? TYPE_LABELS[p.property_type]}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <Badge variant="gray">{TYPE_LABELS[p.property_type]}</Badge>
                      {p.is_primary_residence && <Badge variant="blue">Home</Badge>}
                      {p.ownership_pct < 100 && <Badge variant="gray">You own {fmtNum(p.ownership_pct, 0)} %</Badge>}
                    </div>
                  </div>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)} style={actionBtn}>✎</button>
                    <button type="button" aria-label={`Delete ${p.name}`} onClick={() =>
                      schedule(p.id, p.name, () => deleteScoped('real_estate', p.id, activeProfile?.id), reload)}
                      style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}>✕</button>
                  </span>
                </div>

                <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', marginTop: 14, fontSize: 12 }}>
                  <dt style={{ color: 'var(--text3)' }}>Value</dt>
                  <dd className="num" style={{ textAlign: 'right' }}>
                    {fmtCZK(value)}
                    <div style={{ fontSize: 10, color: age != null && age > 365 ? 'var(--amber)' : 'var(--text3)' }}>
                      {p.valuation_date ? `estimate · ${fmtISODate(p.valuation_date)}${age != null && age > 365 ? ` (${Math.floor(age / 30)} months old)` : ''}` : 'estimate · date unknown'}
                    </div>
                  </dd>
                  <dt style={{ color: 'var(--text3)' }}>Mortgage</dt>
                  <dd className="num" style={{ textAlign: 'right' }}>{debt > 0 ? `−${fmtCZK(debt)}` : '—'}
                    {debt > 0 && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{fmtShare(p.mortgage_rate * 100, 2)} · {fmtCZK(interest)} interest/yr</div>}
                  </dd>
                  <dt style={{ fontWeight: 600 }}>Equity</dt>
                  <dd className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCZK(equity)}</dd>
                  <dt style={{ color: 'var(--text3)' }}>Equity / LTV</dt>
                  <dd className="num" style={{ textAlign: 'right' }}>{ltv != null ? `${fmtShare((1 - ltv) * 100, 0)} / ${fmtShare(ltv * 100, 0)}` : '—'}</dd>
                  {p.monthly_rent > 0 && <>
                    <dt style={{ color: 'var(--text3)' }}>Rent after costs</dt>
                    <dd className="num" style={{ textAlign: 'right' }}>{fmtCZK(rentNet)}/yr
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                        net yield {value > 0 ? fmtShare((rentNet / value) * 100, 2) : '—'}
                        {interest > 0 && value > 0 && ` · ${fmtShare(((rentNet - interest) / value) * 100, 2)} after interest`}
                      </div>
                    </dd>
                  </>}
                  <dt style={{ color: 'var(--text3)' }}>Gain on purchase</dt>
                  <dd className="num" style={{ textAlign: 'right', color: signColor(value - czk(p, p.purchase_price)) }}>{fmtSignedCZK(value - czk(p, p.purchase_price))}</dd>
                </dl>
              </article>
            )
          })}
        </div>
      </>}
    </PageShell>
  )
}

function PropertyModal({ property, onClose, onSaved }: { property: RealEstate | null; onClose: () => void; onSaved: () => void }) {
  const { activeProfile } = useProfile()
  const p = property
  const [form, setForm] = useState({
    name: p?.name ?? '', property_type: p?.property_type ?? 'residential', address: p?.address ?? '',
    purchase_price: p ? String(p.purchase_price) : '', current_value: p ? String(p.current_value) : '',
    valuation_date: p?.valuation_date ?? todayISO(), currency: p?.currency ?? 'CZK', purchase_date: p?.purchase_date ?? '',
    monthly_rent: p ? String(p.monthly_rent) : '', annual_costs: p?.annual_costs != null ? String(p.annual_costs) : '',
    mortgage_balance: p ? String(p.mortgage_balance) : '', mortgage_rate: p ? String(Number((p.mortgage_rate * 100).toFixed(3))) : '',
    monthly_mortgage: p ? String(p.monthly_mortgage) : '', ownership_pct: p ? String(p.ownership_pct) : '100',
    is_primary_residence: p?.is_primary_residence ?? false, notes: p?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))
  const num = (s: string) => (s.trim() ? parseDecimal(s) : 0)

  const save = async () => {
    const purchase = parseDecimal(form.purchase_price), value = parseDecimal(form.current_value)
    const ownership = parseDecimal(form.ownership_pct)
    const rate = form.mortgage_rate.trim() ? parsePercent(form.mortgage_rate) : 0
    const fields = [num(form.monthly_rent), num(form.annual_costs), num(form.mortgage_balance), num(form.monthly_mortgage)]
    if (!form.name.trim()) { setError('Name is required.'); return }
    if (purchase == null || purchase < 0 || value == null || value < 0) { setError('Purchase price and current value must be numbers.'); return }
    if (ownership == null || ownership <= 0 || ownership > 100) { setError('Ownership must be between 0 and 100 %.'); return }
    if (rate == null || rate < 0 || fields.some(f => f == null || f < 0)) { setError('Rent, costs and mortgage figures must be non-negative numbers.'); return }
    const [rent, costs, balance, monthly] = fields as number[]
    const payload: Record<string, unknown> = {
      name: form.name.trim(), property_type: form.property_type, address: form.address.trim() || null,
      purchase_price: purchase, current_value: value, currency: form.currency,
      purchase_date: form.purchase_date || null, monthly_rent: rent, mortgage_balance: balance,
      mortgage_rate: rate, monthly_mortgage: monthly, ownership_pct: ownership,
      is_primary_residence: form.is_primary_residence, notes: form.notes.trim() || null,
      valuation_date: form.valuation_date || null, annual_costs: costs,
      updated_at: new Date().toISOString(),
    }
    setSaving(true)
    let res = p ? await updateScoped('real_estate', p.id, activeProfile?.id, payload)
      : await insertScoped('real_estate', activeProfile?.id, [payload])
    // Before migration 013 the two new columns do not exist; save the rest.
    if (res.error && /valuation_date|annual_costs/.test(res.error)) {
      const { valuation_date: _v, annual_costs: _c, ...legacy } = payload
      void _v; void _c
      res = p ? await updateScoped('real_estate', p.id, activeProfile?.id, legacy)
        : await insertScoped('real_estate', activeProfile?.id, [legacy])
    }
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onSaved(); onClose()
  }

  return (
    <Modal title={p ? 'Edit property' : 'Add property'} onClose={onClose} width={580}>
      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="Name"><input style={inputStyle} value={form.name} placeholder="Byt Brno" onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Type">
          <select style={inputStyle} value={form.property_type} onChange={e => set('property_type', e.target.value as RealEstate['property_type'])}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Address (optional)" span="2"><input style={inputStyle} value={form.address} onChange={e => set('address', e.target.value)} /></Field>
        <Field label="Purchase price (100 %)"><NumberInput value={form.purchase_price} onChange={v => set('purchase_price', v)} suffix={form.currency} /></Field>
        <Field label="Purchase date"><input style={inputStyle} type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} /></Field>
        <Field label="Current value (100 %)"><NumberInput value={form.current_value} onChange={v => set('current_value', v)} suffix={form.currency} /></Field>
        <Field label="Valued on"><input style={inputStyle} type="date" value={form.valuation_date} onChange={e => set('valuation_date', e.target.value)} /></Field>
        <Field label="Currency">
          <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)}>
            <option>CZK</option><option>EUR</option><option>USD</option>
          </select>
        </Field>
        <Field label="Your ownership"><NumberInput value={form.ownership_pct} onChange={v => set('ownership_pct', v)} suffix="%" /></Field>
        <Field label="Monthly rent (100 %)"><NumberInput value={form.monthly_rent} onChange={v => set('monthly_rent', v)} placeholder="0" suffix={form.currency} /></Field>
        <Field label="Running costs a year" hint="Maintenance, insurance, property tax, service charges."><NumberInput value={form.annual_costs} onChange={v => set('annual_costs', v)} placeholder="0" suffix={form.currency} /></Field>
        <Field label="Mortgage balance (100 %)"><NumberInput value={form.mortgage_balance} onChange={v => set('mortgage_balance', v)} placeholder="0" suffix={form.currency} /></Field>
        <Field label="Mortgage rate"><NumberInput value={form.mortgage_rate} onChange={v => set('mortgage_rate', v)} placeholder="4,9" suffix="%" /></Field>
        <Field label="Monthly payment"><NumberInput value={form.monthly_mortgage} onChange={v => set('monthly_mortgage', v)} placeholder="0" suffix={form.currency} /></Field>
        <Field label="" span="2">
          <Checkbox checked={form.is_primary_residence} onChange={v => set('is_primary_residence', v)}
            label="This is my home (primary residence) — left out of investable net worth, with its mortgage" />
        </Field>
        <Field label="Notes (optional)" span="2"><input style={inputStyle} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
      </FormGrid>
      <FormActions onCancel={onClose} onSubmit={save} label={p ? 'Save changes' : 'Add property'} saving={saving} />
    </Modal>
  )
}
