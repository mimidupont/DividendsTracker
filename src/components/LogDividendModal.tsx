'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import Modal from './Modal'
import { Field, FormGrid, FormActions, ErrorBox, inputStyle } from './FormFields'

export default function LogDividendModal({
  onClose,
  onSaved,
  prefillSymbol,
}: {
  onClose: () => void
  onSaved: () => void
  prefillSymbol?: string
}) {
  const [form, setForm] = useState({
    symbol: prefillSymbol ?? '',
    payment_date: new Date().toISOString().slice(0, 10),
    ex_date: '',
    amount_per_share: '',
    shares_held: '',
    gross_amount: '',
    withholding_tax: '0',
    currency: 'USD',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // Auto-compute gross when amount × shares are filled
  const autoGross = form.amount_per_share && form.shares_held
    ? (parseFloat(form.amount_per_share) * parseFloat(form.shares_held)).toFixed(4)
    : null

  const handleSubmit = async () => {
    if (!form.symbol || !form.payment_date || !form.gross_amount) {
      setError('Symbol, date, and gross amount are required.')
      return
    }
    setSaving(true)
    const { error: err } = await supabase.from('dividends_received').insert([{
      symbol: form.symbol.toUpperCase(),
      payment_date: form.payment_date,
      ex_date: form.ex_date || null,
      amount_per_share: parseFloat(form.amount_per_share) || 0,
      shares_held: parseFloat(form.shares_held) || 0,
      gross_amount: parseFloat(form.gross_amount),
      withholding_tax: parseFloat(form.withholding_tax) || 0,
      currency: form.currency,
      notes: form.notes || null,
    }])
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved(); onClose()
  }

  return (
    <Modal title="Log dividend" onClose={onClose}>
      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="Symbol">
          <input style={inputStyle} placeholder="KO" value={form.symbol} onChange={e => set('symbol', e.target.value)} />
        </Field>
        <Field label="Currency">
          <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)}>
            <option>USD</option><option>EUR</option><option>CZK</option><option>GBP</option>
          </select>
        </Field>
        <Field label="Payment date">
          <input style={inputStyle} type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} />
        </Field>
        <Field label="Ex-dividend date">
          <input style={inputStyle} type="date" value={form.ex_date} onChange={e => set('ex_date', e.target.value)} />
        </Field>
        <Field label="Shares held">
          <input style={inputStyle} type="number" placeholder="53.95" value={form.shares_held} onChange={e => set('shares_held', e.target.value)} />
        </Field>
        <Field label="Amount per share">
          <input style={inputStyle} type="number" placeholder="0.53" value={form.amount_per_share} onChange={e => set('amount_per_share', e.target.value)} />
        </Field>
        <Field
          label="Gross amount"
          hint={autoGross ? `Auto: ${autoGross} (override if needed)` : undefined}
        >
          <input
            style={inputStyle}
            type="number"
            placeholder={autoGross ?? '28.59'}
            value={form.gross_amount}
            onChange={e => set('gross_amount', e.target.value)}
            onFocus={() => { if (!form.gross_amount && autoGross) set('gross_amount', autoGross) }}
          />
        </Field>
        <Field label="Withholding tax">
          <input style={inputStyle} type="number" placeholder="4.29" value={form.withholding_tax} onChange={e => set('withholding_tax', e.target.value)} />
        </Field>
        <Field label="Notes (optional)" span="2">
          <input style={inputStyle} placeholder="e.g. Ordinary dividend Q1" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
      <FormActions onCancel={onClose} onSubmit={handleSubmit} label="Save dividend" saving={saving} />
    </Modal>
  )
}
