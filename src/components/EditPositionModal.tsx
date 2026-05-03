'use client'
import { useState } from 'react'
import { supabase, Holding } from '@/lib/supabase'
import Modal from './Modal'
import { Field, FormGrid, FormActions, ErrorBox, inputStyle } from './FormFields'

export default function EditPositionModal({
  holding,
  onClose,
  onSaved,
}: {
  holding: Holding
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    symbol: holding.symbol,
    name: holding.name,
    shares: String(holding.shares),
    avg_price: String(holding.avg_price),
    currency: holding.currency,
    exchange: holding.exchange ?? '',
    purchase_date: holding.purchase_date ?? '',
    is_dividend_payer: holding.is_dividend_payer,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.symbol || !form.name || !form.shares || !form.avg_price) {
      setError('All required fields must be filled.')
      return
    }
    setSaving(true)
    const { error: err } = await supabase.from('holdings').update({
      symbol: form.symbol.toUpperCase().trim(),
      name: form.name.trim(),
      shares: parseFloat(form.shares),
      avg_price: parseFloat(form.avg_price),
      currency: form.currency,
      exchange: form.exchange.trim() || null,
      purchase_date: form.purchase_date || null,
      is_dividend_payer: form.is_dividend_payer,
      updated_at: new Date().toISOString(),
    }).eq('id', holding.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved(); onClose()
  }

  const costBasis = form.shares && form.avg_price
    ? parseFloat(form.shares) * parseFloat(form.avg_price) : null

  return (
    <Modal
      title="Edit position"
      subtitle={`${holding.symbol} · ${holding.name}`}
      onClose={onClose}
    >
      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="Ticker symbol">
          <input style={inputStyle} value={form.symbol} onChange={e => set('symbol', e.target.value)} />
        </Field>
        <Field label="Currency">
          <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)}>
            <option>USD</option><option>EUR</option><option>CZK</option><option>GBP</option>
          </select>
        </Field>
        <Field label="Company name" span="2">
          <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Shares held">
          <input style={inputStyle} type="number" value={form.shares} onChange={e => set('shares', e.target.value)} />
        </Field>
        <Field label="Avg price per share">
          <input style={inputStyle} type="number" value={form.avg_price} onChange={e => set('avg_price', e.target.value)} />
        </Field>
        <Field label="Exchange">
          <input style={inputStyle} value={form.exchange} onChange={e => set('exchange', e.target.value)} />
        </Field>
        <Field label="Purchase date">
          <input style={inputStyle} type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
        </Field>
        <Field label="" span="2">
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_dividend_payer}
              onChange={e => set('is_dividend_payer', e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--green)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Dividend payer</span>
          </label>
        </Field>
      </FormGrid>

      {costBasis !== null && !isNaN(costBasis) && (
        <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--bg3)', borderRadius: 7, fontSize: 11, color: 'var(--text3)' }}>
          Total cost basis: <span style={{ color: 'var(--text)', fontWeight: 500 }}>
            {costBasis.toLocaleString(undefined, { maximumFractionDigits: 2 })} {form.currency}
          </span>
        </div>
      )}

      <FormActions onCancel={onClose} onSubmit={handleSubmit} label="Save changes" saving={saving} />
    </Modal>
  )
}
