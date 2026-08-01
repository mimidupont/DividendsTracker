'use client'
import { useState } from 'react'
import Modal from './Modal'
import { Field, FormGrid, FormActions, ErrorBox, inputStyle } from './FormFields'
import { supabase, type Transaction, type TransactionType, type TxnAssetClass } from '@/lib/supabase'
import { useProfile } from '@/lib/profile'
import { useFx } from '@/hooks/useFx'
import { fxRate } from '@/lib/fx'
import { todayISO } from '@/lib/date'
import { defaultIsExternal } from '@/lib/transactions'

const TYPES: TransactionType[] = [
  'buy', 'sell', 'deposit', 'withdrawal', 'dividend',
  'interest', 'rent', 'fee', 'tax', 'transfer', 'adjustment',
]

const ASSET_CLASSES: TxnAssetClass[] = ['stock', 'cash', 'crypto', 'realestate', 'none']

/** Types that involve a traded quantity rather than a bare cash movement. */
const QUANTITY_TYPES: TransactionType[] = ['buy', 'sell', 'dividend']

/** Sign the amount should carry, so the ledger stays consistent. */
function expectedSign(type: TransactionType): 1 | -1 {
  switch (type) {
    case 'buy': case 'withdrawal': case 'fee': case 'tax':
      return -1
    default:
      return 1
  }
}

export default function TransactionModal({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: Transaction | null
  onClose: () => void
  onSaved: () => void
}) {
  const { activeProfile } = useProfile()
  const { fx } = useFx()
  const editing = transaction != null

  const [form, setForm] = useState({
    txn_date: transaction?.txn_date ?? todayISO(),
    type: (transaction?.type ?? 'buy') as TransactionType,
    asset_class: (transaction?.asset_class ?? 'stock') as TxnAssetClass,
    symbol: transaction?.symbol ?? '',
    quantity: transaction?.quantity != null ? String(transaction.quantity) : '',
    price: transaction?.price != null ? String(transaction.price) : '',
    amount: transaction ? String(Math.abs(transaction.amount)) : '',
    fee: String(transaction?.fee ?? 0),
    tax: String(transaction?.tax ?? 0),
    currency: transaction?.currency ?? 'USD',
    fx_rate_czk: transaction?.fx_rate_czk != null ? String(transaction.fx_rate_czk) : '',
    is_external: transaction?.is_external ?? defaultIsExternal('buy'),
    notes: transaction?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  const onTypeChange = (type: TransactionType) => {
    setForm(f => ({ ...f, type, is_external: defaultIsExternal(type) }))
  }

  /** Suggest today's live rate, but never overwrite a rate already stored. */
  const suggestedRate = fxRate(form.currency, fx)
  const useSuggestedRate = () => {
    if (suggestedRate != null) set('fx_rate_czk', String(Number(suggestedRate.toFixed(4))))
  }

  const showsQuantity = QUANTITY_TYPES.includes(form.type)
  const autoAmount = form.quantity && form.price
    ? (parseFloat(form.quantity) * parseFloat(form.price)).toFixed(2)
    : null

  const handleSubmit = async () => {
    if (!activeProfile) { setError('No active profile selected.'); return }
    if (!form.txn_date) { setError('A date is required.'); return }

    const amountAbs = parseFloat(form.amount)
    if (!isFinite(amountAbs) || amountAbs <= 0) {
      setError('Enter the amount as a positive number — the sign follows the type.')
      return
    }

    // The rate is frozen on the row. Deriving it later from today's rate would
    // silently rewrite the CZK value of every historical transaction.
    const rate = parseFloat(form.fx_rate_czk)
    if (!isFinite(rate) || rate <= 0) {
      setError('An FX rate is required — it is frozen on the row so historical CZK values stay correct.')
      return
    }

    const quantity = form.quantity ? parseFloat(form.quantity) : null
    const price = form.price ? parseFloat(form.price) : null
    if (showsQuantity && quantity != null && (!isFinite(quantity) || quantity <= 0)) {
      setError('Quantity must be a positive number.')
      return
    }

    setSaving(true)
    const payload = {
      txn_date: form.txn_date,
      type: form.type,
      asset_class: form.asset_class,
      symbol: form.symbol.trim().toUpperCase() || null,
      quantity: quantity != null && isFinite(quantity) ? quantity : null,
      price: price != null && isFinite(price) ? price : null,
      amount: amountAbs * expectedSign(form.type),
      fee: parseFloat(form.fee) || 0,
      tax: parseFloat(form.tax) || 0,
      currency: form.currency,
      fx_rate_czk: rate,
      is_external: form.is_external,
      notes: form.notes.trim() || null,
    }

    const { error: err } = editing
      ? await supabase.from('transactions').update(payload).eq('id', transaction!.id)
      : await supabase.from('transactions').insert([{ ...payload, profile_id: activeProfile.id }])

    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <Modal
      title={editing ? 'Edit transaction' : 'Add transaction'}
      subtitle="Amounts are entered positive; the sign follows the type"
      onClose={onClose}
      width={560}
    >
      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="Date">
          <input style={inputStyle} type="date" value={form.txn_date} onChange={e => set('txn_date', e.target.value)} />
        </Field>
        <Field label="Type">
          <select style={inputStyle} value={form.type} onChange={e => onTypeChange(e.target.value as TransactionType)}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>

        <Field label="Asset class">
          <select style={inputStyle} value={form.asset_class} onChange={e => set('asset_class', e.target.value)}>
            {ASSET_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Symbol (optional)">
          <input style={inputStyle} placeholder="KO / bitcoin" value={form.symbol}
            onChange={e => set('symbol', e.target.value)} />
        </Field>

        {showsQuantity && (
          <>
            <Field label="Quantity">
              <input style={inputStyle} type="number" placeholder="10" value={form.quantity}
                onChange={e => set('quantity', e.target.value)} />
            </Field>
            <Field label="Price per unit">
              <input style={inputStyle} type="number" placeholder="58.50" value={form.price}
                onChange={e => set('price', e.target.value)} />
            </Field>
          </>
        )}

        <Field
          label={`Amount (${expectedSign(form.type) > 0 ? 'in' : 'out'})`}
          hint={autoAmount ? `Auto: ${autoAmount}` : undefined}
        >
          <input
            style={inputStyle} type="number" placeholder={autoAmount ?? '1000'}
            value={form.amount} onChange={e => set('amount', e.target.value)}
            onFocus={() => { if (!form.amount && autoAmount) set('amount', autoAmount) }}
          />
        </Field>
        <Field label="Currency">
          <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)}>
            <option>USD</option><option>EUR</option><option>CZK</option><option>GBP</option>
          </select>
        </Field>

        <Field label="Fee">
          <input style={inputStyle} type="number" value={form.fee} onChange={e => set('fee', e.target.value)} />
        </Field>
        <Field label="Tax withheld">
          <input style={inputStyle} type="number" value={form.tax} onChange={e => set('tax', e.target.value)} />
        </Field>

        <Field
          label="FX rate (CZK per 1 unit)"
          hint={suggestedRate != null ? `Today: ${suggestedRate.toFixed(3)}` : 'No live rate for this currency'}
          span="2"
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={inputStyle} type="number" step="0.001" placeholder="20.65"
              value={form.fx_rate_czk} onChange={e => set('fx_rate_czk', e.target.value)} />
            <button type="button" onClick={useSuggestedRate} disabled={suggestedRate == null} style={{
              padding: '7px 12px', borderRadius: 6, cursor: suggestedRate == null ? 'not-allowed' : 'pointer',
              background: 'var(--bg3)', border: '1px solid var(--border2)',
              color: 'var(--text2)', fontSize: 11, whiteSpace: 'nowrap',
              opacity: suggestedRate == null ? 0.5 : 1,
            }}>Use today&rsquo;s</button>
          </div>
        </Field>

        <Field label="" span="2">
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_external}
              onChange={e => set('is_external', e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--green)', cursor: 'pointer', marginTop: 2 }} />
            <span style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
              External flow
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text4)' }}>
                Tick when money crosses the boundary of your wealth — a salary paid in, or cash
                withdrawn to spend. Buying shares with money you already had is internal, and so
                is a dividend until you actually take it out.
              </span>
            </span>
          </label>
        </Field>

        <Field label="Notes (optional)" span="2">
          <input style={inputStyle} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </Field>
      </FormGrid>

      <FormActions onCancel={onClose} onSubmit={handleSubmit}
        label={editing ? 'Save changes' : 'Add transaction'} saving={saving} />
    </Modal>
  )
}
