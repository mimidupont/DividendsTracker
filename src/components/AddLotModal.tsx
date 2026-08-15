'use client'
import { useState } from 'react'
import { supabase, Holding } from '@/lib/supabase'
import { useProfile } from '@/lib/profile'
import { todayISO } from '@/lib/date'
import Modal from './Modal'
import { Field, FormGrid, FormActions, ErrorBox, inputStyle } from './FormFields'

/** PostgREST's code for "no such function", i.e. migration 009 not run yet. */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  if (error.code === 'PGRST202' || error.code === '42883') return true
  const msg = (error.message ?? '').toLowerCase()
  return msg.includes('could not find the function') || msg.includes('does not exist')
}

export default function AddLotModal({
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
    shares: '',
    purchase_price: '',
    purchase_date: todayISO(),
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.shares || !form.purchase_price) {
      setError('Shares and purchase price are required.')
      return
    }
    const newShares = parseFloat(form.shares)
    const newPrice  = parseFloat(form.purchase_price)
    if (isNaN(newShares) || isNaN(newPrice) || newShares <= 0 || newPrice <= 0) {
      setError('Please enter valid numbers.')
      return
    }
    if (!activeProfile) { setError('No active profile selected.'); return }

    setSaving(true)

    // One statement, so the position and its lot move together. Doing this as
    // two requests meant a failure on the second left the shares updated with
    // no lot to explain them.
    const { error: rpcErr } = await supabase.rpc('add_holding_lot', {
      p_holding_id: holding.id,
      p_profile_id: activeProfile.id,
      p_shares: newShares,
      p_price: newPrice,
      p_purchase_date: form.purchase_date || null,
      p_notes: form.notes || null,
    })

    if (!rpcErr) {
      setSaving(false)
      onSaved(); onClose()
      return
    }

    // Migration 009 has not been run: fall back to the two-write path rather
    // than blocking the user, and say so if the second write is the one that
    // fails.
    if (!isMissingFunction(rpcErr)) {
      setError(rpcErr.message)
      setSaving(false)
      return
    }

    const totalOldCost  = holding.shares * holding.avg_price
    const totalNewCost  = newShares * newPrice
    const totalShares   = holding.shares + newShares
    const newAvgPrice   = (totalOldCost + totalNewCost) / totalShares

    const { error: updateErr } = await supabase.from('holdings').update({
      shares: totalShares,
      avg_price: newAvgPrice,
      updated_at: new Date().toISOString(),
    }).eq('id', holding.id)

    if (updateErr) { setError(updateErr.message); setSaving(false); return }

    const { error: lotErr } = await supabase.from('holding_lots').insert([{
      holding_id: holding.id,
      symbol: holding.symbol,
      shares: newShares,
      purchase_price: newPrice,
      purchase_date: form.purchase_date || null,
      notes: form.notes || null,
      profile_id: activeProfile.id,
    }])

    setSaving(false)
    if (lotErr) {
      // The position itself is already updated and correct; only the lot
      // history is missing, so say so instead of failing silently.
      setError(
        `Position updated, but the lot history could not be saved: ${lotErr.message}. ` +
        'Run supabase/migrations/009_add_holding_lot.sql to make this atomic.'
      )
      onSaved()
      return
    }
    onSaved(); onClose()
  }

  const newShares  = parseFloat(form.shares) || 0
  const newPrice   = parseFloat(form.purchase_price) || 0
  const lotCost    = newShares * newPrice
  const newTotal   = holding.shares + newShares
  const newAvg     = newTotal > 0
    ? (holding.shares * holding.avg_price + lotCost) / newTotal
    : 0

  return (
    <Modal
      title="Add lot"
      subtitle={`New purchase of ${holding.symbol} · ${holding.name}`}
      onClose={onClose}
    >
      <div style={{
        background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px',
        marginBottom: 18, fontSize: 11, color: 'var(--text3)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
      }}>
        <div>Current shares: <span style={{ color: 'var(--text)', fontWeight: 500 }}>{holding.shares}</span></div>
        <div>Current avg: <span style={{ color: 'var(--text)', fontWeight: 500 }}>{holding.avg_price.toFixed(2)} {holding.currency}</span></div>
      </div>

      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="Shares to buy">
          <input style={inputStyle} type="number" placeholder="10" value={form.shares} onChange={e => set('shares', e.target.value)} />
        </Field>
        {/* The currency is fixed to the holding's, not a choice: the new lot is
            blended straight into the weighted average, so a price entered in
            another currency would permanently corrupt the cost basis. */}
        <Field label="Purchase price per share">
          <div style={{ position: 'relative' }}>
            <input
              style={{ ...inputStyle, paddingRight: 52 }}
              type="number" placeholder="74.50" value={form.purchase_price}
              onChange={e => set('purchase_price', e.target.value)}
            />
            <span style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 11, color: 'var(--text3)', pointerEvents: 'none',
              fontFamily: "'DM Mono', monospace",
            }}>{holding.currency}</span>
          </div>
        </Field>
        <Field label="Purchase date">
          <input style={inputStyle} type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
        </Field>
        <Field label="Notes (optional)">
          <input style={inputStyle} placeholder="e.g. DCA purchase" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
      </FormGrid>

      {newShares > 0 && newPrice > 0 && (
        <div style={{
          marginTop: 14, padding: '12px 14px',
          background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
          borderRadius: 8, fontSize: 11,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
        }}>
          <div style={{ color: 'var(--text3)' }}>Lot cost</div>
          <div style={{ color: 'var(--green)', fontWeight: 500 }}>
            {lotCost.toLocaleString(undefined, { maximumFractionDigits: 2 })} {holding.currency}
          </div>
          <div style={{ color: 'var(--text3)' }}>New total shares</div>
          <div style={{ color: 'var(--text)', fontWeight: 500 }}>{newTotal.toFixed(4)}</div>
          <div style={{ color: 'var(--text3)' }}>New avg price</div>
          <div style={{ color: 'var(--text)', fontWeight: 500 }}>
            {newAvg.toFixed(4)} {holding.currency}
          </div>
        </div>
      )}

      <FormActions onCancel={onClose} onSubmit={handleSubmit} label="Add lot" saving={saving} />
    </Modal>
  )
}
