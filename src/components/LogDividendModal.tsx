'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function LogDividendModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    symbol: '', payment_date: '', amount_per_share: '', shares_held: '',
    gross_amount: '', withholding_tax: '0', currency: 'USD', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.symbol || !form.payment_date || !form.gross_amount) {
      setError('Symbol, date, and gross amount are required.')
      return
    }
    setSaving(true)
    const { error: err } = await supabase.from('dividends_received').insert([{
      symbol: form.symbol.toUpperCase(),
      payment_date: form.payment_date,
      amount_per_share: parseFloat(form.amount_per_share) || 0,
      shares_held: parseFloat(form.shares_held) || 0,
      gross_amount: parseFloat(form.gross_amount),
      withholding_tax: parseFloat(form.withholding_tax) || 0,
      currency: form.currency,
      notes: form.notes || null,
    }])
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
    onClose()
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    border: '1px solid var(--border2)', background: 'var(--bg)',
    color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 12,
    outline: 'none',
  }

  const labelStyle = { fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, display: 'block', marginBottom: 4 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border2)', width: 420, padding: 28, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 400 }}>Log dividend</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18 }}>×</button>
        </div>

        {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-bd)', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div><label style={labelStyle}>Symbol</label><input style={inputStyle} placeholder="KO" value={form.symbol} onChange={e => set('symbol', e.target.value)} /></div>
          <div><label style={labelStyle}>Currency</label>
            <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)}>
              <option>USD</option><option>EUR</option><option>CZK</option><option>GBP</option>
            </select>
          </div>
          <div><label style={labelStyle}>Payment date</label><input style={inputStyle} type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} /></div>
          <div><label style={labelStyle}>Shares held</label><input style={inputStyle} type="number" placeholder="53.95" value={form.shares_held} onChange={e => set('shares_held', e.target.value)} /></div>
          <div><label style={labelStyle}>Amount / share</label><input style={inputStyle} type="number" placeholder="0.53" value={form.amount_per_share} onChange={e => set('amount_per_share', e.target.value)} /></div>
          <div><label style={labelStyle}>Gross amount</label><input style={inputStyle} type="number" placeholder="28.59" value={form.gross_amount} onChange={e => set('gross_amount', e.target.value)} /></div>
          <div style={{ gridColumn: '1/-1' }}><label style={labelStyle}>Withholding tax</label><input style={inputStyle} type="number" placeholder="4.29" value={form.withholding_tax} onChange={e => set('withholding_tax', e.target.value)} /></div>
          <div style={{ gridColumn: '1/-1' }}><label style={labelStyle}>Notes (optional)</label><input style={inputStyle} placeholder="e.g. Ordinary dividend Q1" value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontFamily: 'DM Mono, monospace', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--green-bd)', background: 'var(--green-bg)', color: 'var(--green)', fontFamily: 'DM Mono, monospace', fontSize: 12, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save dividend'}
          </button>
        </div>
      </div>
    </div>
  )
}
