'use client'
import { useState } from 'react'
import type { Holding } from '@/lib/supabase'
import { useProfile } from '@/lib/profile'
import { updateScoped } from '@/lib/db'
import { parseDecimal } from '@/lib/parse'
import { historicalRate, normalizeCurrencyCode } from '@/lib/fx'
import Modal from './Modal'
import { Field, FormGrid, FormActions, ErrorBox, NumberInput, Checkbox, Notice, inputStyle } from './FormFields'

/**
 * Corrections to a position's static data. Purchases and sales go through
 * Record; this is for fixing a name, the exchange, a mistyped average, or
 * filling in the FX rate a pre-ledger position was bought at.
 */
export default function EditPositionModal({
  holding,
  onClose,
  onSaved,
}: {
  holding: Holding
  onClose: () => void
  onSaved: () => void
}) {
  const { activeProfile } = useProfile()
  const [form, setForm] = useState({
    name: holding.name,
    shares: String(holding.shares),
    avg_price: String(holding.avg_price),
    avg_fx_czk: holding.avg_fx_czk != null ? String(holding.avg_fx_czk) : '',
    exchange: holding.exchange ?? '',
    purchase_date: holding.purchase_date ?? '',
    is_dividend_payer: holding.is_dividend_payer,
  })
  const [saving, setSaving] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [error, setError] = useState('')
  const isCZK = normalizeCurrencyCode(holding.currency) === 'CZK'

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))

  const lookUpRate = async () => {
    if (!form.purchase_date) { setError('Enter the purchase date first.'); return }
    setLookingUp(true)
    const r = await historicalRate(holding.currency, form.purchase_date)
    setLookingUp(false)
    if (r == null) { setError('No ECB rate available for that date — enter it by hand.'); return }
    setError('')
    set('avg_fx_czk', String(Number(r.toFixed(6))))
  }

  const handleSubmit = async () => {
    const shares = parseDecimal(form.shares)
    const price  = parseDecimal(form.avg_price)
    const fx     = form.avg_fx_czk.trim() ? parseDecimal(form.avg_fx_czk) : null
    if (!form.name.trim()) { setError('Name is required.'); return }
    if (shares == null || shares <= 0 || price == null || price <= 0) {
      setError('Shares and average price must be positive numbers.')
      return
    }
    if (form.avg_fx_czk.trim() && (fx == null || fx <= 0)) {
      setError('The purchase FX rate must be a positive number (or left empty).')
      return
    }

    setSaving(true)
    // `symbol` and `currency` are deliberately not editable: lots, dividends,
    // projections, metadata and ledger rows key on the ticker text, and the
    // average cost is expressed in the currency — changing either would detach
    // or silently re-denominate that history.
    const { error: err } = await updateScoped('holdings', holding.id, activeProfile?.id, {
      name: form.name.trim(),
      shares,
      avg_price: price,
      avg_fx_czk: isCZK ? 1 : fx,
      exchange: form.exchange.trim() || null,
      purchase_date: form.purchase_date || null,
      is_dividend_payer: form.is_dividend_payer,
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    if (err) { setError(err); return }
    onSaved(); onClose()
  }

  const s = parseDecimal(form.shares), p = parseDecimal(form.avg_price)
  const costBasis = s != null && p != null ? s * p : null

  return (
    <Modal title="Edit position" subtitle={`${holding.symbol} · ${holding.name}`} onClose={onClose}>
      <Notice tone="gray">
        To record a purchase or sale use <strong>Record</strong> — it keeps the ledger and the lot history in step.
        Use this form to correct data.
      </Notice>
      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="Ticker" hint="Fixed: history is keyed on it.">
          <input style={{ ...inputStyle, opacity: 0.6 }} value={holding.symbol} readOnly disabled />
        </Field>
        <Field label="Currency" hint="Fixed: the average cost is in this currency.">
          <input style={{ ...inputStyle, opacity: 0.6 }} value={holding.currency} readOnly disabled />
        </Field>
        <Field label="Company name" span="2">
          <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Shares held">
          <NumberInput value={form.shares} onChange={v => set('shares', v)} />
        </Field>
        <Field label="Avg price per share">
          <NumberInput value={form.avg_price} onChange={v => set('avg_price', v)} suffix={holding.currency} />
        </Field>
        <Field label="Purchase date">
          <input style={inputStyle} type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
        </Field>
        {!isCZK && (
          <Field
            label={`Avg purchase rate (CZK/${normalizeCurrencyCode(holding.currency)})`}
            hint={<>
              The rate your cost was paid at. Empty = today&apos;s rate is used and the currency part of your P&amp;L is hidden.{' '}
              <button type="button" onClick={lookUpRate} disabled={lookingUp} style={{
                background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', padding: 0, fontSize: 10, textDecoration: 'underline',
              }}>{lookingUp ? 'Looking up…' : 'Use ECB rate on purchase date'}</button>
            </>}
          >
            <NumberInput value={form.avg_fx_czk} onChange={v => set('avg_fx_czk', v)} placeholder="e.g. 23,45" />
          </Field>
        )}
        <Field label="Exchange">
          <input style={inputStyle} value={form.exchange} onChange={e => set('exchange', e.target.value)} />
        </Field>
        <Field label="" span="2">
          <Checkbox checked={form.is_dividend_payer} onChange={v => set('is_dividend_payer', v)} label="Pays dividends" />
        </Field>
      </FormGrid>

      {costBasis != null && (
        <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--bg3)', borderRadius: 7, fontSize: 11, color: 'var(--text3)' }}>
          Total cost basis: <span className="num" style={{ color: 'var(--text)', fontWeight: 500 }}>
            {costBasis.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} {holding.currency}
          </span>
        </div>
      )}

      <FormActions onCancel={onClose} onSubmit={handleSubmit} label="Save changes" saving={saving} />
    </Modal>
  )
}
