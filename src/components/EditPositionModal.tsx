'use client'
import { useState } from 'react'
import { supabase, Holding } from '@/lib/supabase'

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
      setError('Ticker, name, shares, and price are required.')
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
    onSaved()
    onClose()
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    border: '1px solid var(--border2)', background: 'var(--bg)',
    color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 12,
    outline: 'none', boxSizing: 'border-box' as const,
  }

  const labelStyle = {
    fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em',
    textTransform: 'uppercase' as const, display: 'block', marginBottom: 4,
  }

  const costBasis = form.shares && form.avg_price
    ? parseFloat(form.shares) * parseFloat(form.avg_price)
    : null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border2)', width: 440, padding: 28, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 400 }}>Edit position</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>Editing {holding.symbol} · {holding.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18 }}>×</button>
        </div>

        {error && (
          <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-bd)', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={labelStyle}>Ticker symbol</label>
            <input style={inputStyle} value={form.symbol} onChange={e => set('symbol', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Currency</label>
            <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)}>
              <option>USD</option><option>EUR</option><option>CZK</option><option>GBP</option>
            </select>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={labelStyle}>Company name</label>
            <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Shares held</label>
            <input style={inputStyle} type="number" value={form.shares} onChange={e => set('shares', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Avg price per share</label>
            <input style={inputStyle} type="number" value={form.avg_price} onChange={e => set('avg_price', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Exchange (optional)</label>
            <input style={inputStyle} value={form.exchange} onChange={e => set('exchange', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Purchase date (optional)</label>
            <input style={inputStyle} type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="edit_is_div_payer"
              type="checkbox"
              checked={form.is_dividend_payer}
              onChange={e => set('is_dividend_payer', e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--green)' }}
            />
            <label htmlFor="edit_is_div_payer" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer', textTransform: 'none', fontSize: 12, letterSpacing: 0, color: 'var(--text2)' }}>
              Dividend payer
            </label>
          </div>
        </div>

        {costBasis !== null && !isNaN(costBasis) && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--bg3)', borderRadius: 7, fontSize: 11, color: 'var(--text3)' }}>
            Total cost basis:{' '}
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>
              {costBasis.toLocaleString(undefined, { maximumFractionDigits: 2 })} {form.currency}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontFamily: 'DM Mono, monospace', fontSize: 12, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--green-bd)', background: 'var(--green-bg)', color: 'var(--green)', fontFamily: 'DM Mono, monospace', fontSize: 12, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
