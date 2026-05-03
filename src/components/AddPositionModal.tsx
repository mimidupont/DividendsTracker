'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import Modal from './Modal'
import { Field, FormGrid, FormActions, ErrorBox, inputStyle } from './FormFields'

export default function AddPositionModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    symbol: '', name: '', shares: '', avg_price: '',
    currency: 'USD', exchange: '', purchase_date: '', is_dividend_payer: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'found' | 'notfound'>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    const symbol = form.symbol.trim().toUpperCase()
    if (!symbol) { setLookupStatus('idle'); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLookingUp(true)
      setLookupStatus('idle')
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=0`,
          { headers: { Accept: 'application/json' } }
        )
        const data = await res.json()
        const quotes = data?.finance?.result?.[0]?.quotes ?? []
        const exact = quotes.find((q: { symbol: string }) => q.symbol === symbol)
        const match = exact ?? quotes[0]
        if (match?.longname || match?.shortname) {
          setForm(f => ({ ...f, name: match.longname || match.shortname }))
          setLookupStatus('found')
        } else {
          setLookupStatus('notfound')
        }
      } catch {
        setLookupStatus('notfound')
      } finally {
        setLookingUp(false)
      }
    }, 600)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.symbol])

  const handleSubmit = async () => {
    if (!form.symbol || !form.name || !form.shares || !form.avg_price) {
      setError('Ticker, name, shares, and price are required.')
      return
    }
    setSaving(true)
    const { error: err } = await supabase.from('holdings').insert([{
      symbol: form.symbol.toUpperCase().trim(),
      name: form.name.trim(),
      shares: parseFloat(form.shares),
      avg_price: parseFloat(form.avg_price),
      currency: form.currency,
      exchange: form.exchange.trim() || null,
      purchase_date: form.purchase_date || null,
      is_dividend_payer: form.is_dividend_payer,
    }])
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved(); onClose()
  }

  const costBasis = form.shares && form.avg_price
    ? parseFloat(form.shares) * parseFloat(form.avg_price) : null

  return (
    <Modal title="Add position" onClose={onClose}>
      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="Ticker symbol">
          <div style={{ position: 'relative' }}>
            <input
              style={{ ...inputStyle, paddingRight: 28 }}
              placeholder="e.g. KO"
              value={form.symbol}
              onChange={e => { set('symbol', e.target.value); setLookupStatus('idle') }}
            />
            <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 12 }}>
              {lookingUp && <span style={{ color: 'var(--text3)' }}>⟳</span>}
              {!lookingUp && lookupStatus === 'found' && <span style={{ color: 'var(--green)' }}>✓</span>}
              {!lookingUp && lookupStatus === 'notfound' && <span style={{ color: 'var(--amber)' }}>?</span>}
            </span>
          </div>
        </Field>

        <Field label="Currency">
          <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)}>
            <option>USD</option><option>EUR</option><option>CZK</option><option>GBP</option>
          </select>
        </Field>

        <Field label={`Company name${lookingUp ? ' — looking up…' : ''}`} span="2">
          <input
            style={{
              ...inputStyle,
              background: lookupStatus === 'found' ? 'var(--green-bg)' : 'var(--bg)',
              borderColor: lookupStatus === 'found' ? 'var(--green-bd)' : undefined,
              transition: 'background 0.3s, border-color 0.3s',
            }}
            placeholder="Auto-filled from ticker, or type manually"
            value={form.name}
            onChange={e => set('name', e.target.value)}
          />
        </Field>

        <Field label="Shares">
          <input style={inputStyle} type="number" placeholder="50" value={form.shares} onChange={e => set('shares', e.target.value)} />
        </Field>
        <Field label="Price per share">
          <input style={inputStyle} type="number" placeholder="58.50" value={form.avg_price} onChange={e => set('avg_price', e.target.value)} />
        </Field>
        <Field label="Exchange (optional)">
          <input style={inputStyle} placeholder="NYSE" value={form.exchange} onChange={e => set('exchange', e.target.value)} />
        </Field>
        <Field label="Purchase date (optional)">
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

      <FormActions onCancel={onClose} onSubmit={handleSubmit} label="Add position" saving={saving} />
    </Modal>
  )
}
