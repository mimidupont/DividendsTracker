'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

export default function AddPositionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    symbol: '',
    name: '',
    shares: '',
    avg_price: '',
    currency: 'USD',
    exchange: '',
    purchase_date: '',
    is_dividend_payer: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'found' | 'notfound'>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  // Auto-lookup company name when ticker symbol changes
  useEffect(() => {
    const symbol = form.symbol.trim().toUpperCase()
    if (!symbol || symbol.length < 1) {
      setLookupStatus('idle')
      return
    }

    // Debounce: wait 600ms after user stops typing
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLookingUp(true)
      setLookupStatus('idle')
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query`,
          { headers: { 'Accept': 'application/json' } }
        )
        if (!res.ok) throw new Error('fetch failed')
        const data = await res.json()
        const quotes = data?.finance?.result?.[0]?.quotes ?? []

        // Find exact symbol match first, then fall back to first result
        const exact = quotes.find((q: { symbol: string }) => q.symbol === symbol)
        const match = exact ?? quotes[0]

        if (match?.longname || match?.shortname) {
          const name = match.longname || match.shortname
          setForm(f => ({ ...f, name }))
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

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border2)', width: 440, padding: 28, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 400 }}>Add position</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18 }}>×</button>
        </div>

        {error && (
          <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-bd)', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Ticker symbol with lookup indicator */}
          <div>
            <label style={labelStyle}>Ticker symbol</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputStyle, paddingRight: 28 }}
                placeholder="e.g. KO"
                value={form.symbol}
                onChange={e => {
                  set('symbol', e.target.value)
                  setLookupStatus('idle')
                }}
              />
              {/* Status indicator inside input */}
              <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 12 }}>
                {lookingUp && (
                  <span style={{ color: 'var(--text3)', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                )}
                {!lookingUp && lookupStatus === 'found' && (
                  <span style={{ color: 'var(--green)' }}>✓</span>
                )}
                {!lookingUp && lookupStatus === 'notfound' && (
                  <span style={{ color: 'var(--amber)' }}>?</span>
                )}
              </div>
            </div>
            {!lookingUp && lookupStatus === 'notfound' && (
              <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>
                Ticker not found — enter name manually
              </div>
            )}
            {!lookingUp && lookupStatus === 'found' && (
              <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 4 }}>
                Company name auto-filled ✓
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Currency</label>
            <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)}>
              <option>USD</option><option>EUR</option><option>CZK</option><option>GBP</option>
            </select>
          </div>

          {/* Company name — editable, auto-filled from lookup */}
          <div style={{ gridColumn: '1/-1' }}>
            <label style={labelStyle}>
              Company name
              {lookingUp && <span style={{ color: 'var(--text3)', marginLeft: 6, fontStyle: 'italic' }}>looking up…</span>}
            </label>
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
          </div>

          <div>
            <label style={labelStyle}>Shares bought</label>
            <input style={inputStyle} type="number" placeholder="e.g. 50" value={form.shares} onChange={e => set('shares', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Price per share</label>
            <input style={inputStyle} type="number" placeholder="e.g. 58.50" value={form.avg_price} onChange={e => set('avg_price', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Exchange (optional)</label>
            <input style={inputStyle} placeholder="e.g. NYSE" value={form.exchange} onChange={e => set('exchange', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Purchase date (optional)</label>
            <input style={inputStyle} type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="is_div_payer"
              type="checkbox"
              checked={form.is_dividend_payer}
              onChange={e => set('is_dividend_payer', e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--green)' }}
            />
            <label htmlFor="is_div_payer" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer', textTransform: 'none', fontSize: 12, letterSpacing: 0, color: 'var(--text2)' }}>
              Dividend payer
            </label>
          </div>
        </div>

        {form.shares && form.avg_price && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--bg3)', borderRadius: 7, fontSize: 11, color: 'var(--text3)' }}>
            Total cost basis:{' '}
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>
              {(parseFloat(form.shares) * parseFloat(form.avg_price)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {form.currency}
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
            {saving ? 'Saving…' : 'Add position'}
          </button>
        </div>
      </div>
    </div>
  )
}
