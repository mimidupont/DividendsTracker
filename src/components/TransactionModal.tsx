'use client'
import { useEffect, useState } from 'react'
import Modal from './Modal'
import { Field, FormGrid, FormActions, ErrorBox, NumberInput, Notice, inputStyle } from './FormFields'
import type { Transaction, TransactionType, TxnAssetClass } from '@/lib/supabase'
import { useProfile } from '@/lib/profile'
import { useRateOn } from '@/hooks/useRateOn'
import { todayISO } from '@/lib/date'
import { defaultIsExternal } from '@/lib/transactions'
import { updateScoped, insertScoped } from '@/lib/db'
import { parseDecimal } from '@/lib/parse'

const TYPES: TransactionType[] = [
  'buy', 'sell', 'deposit', 'withdrawal', 'dividend',
  'interest', 'rent', 'fee', 'tax', 'transfer', 'adjustment',
]
// Splits change positions and lots too, so they are recorded through Record, not here.

const ASSET_CLASSES: TxnAssetClass[] = ['stock', 'bond', 'cash', 'crypto', 'realestate', 'none']

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

/**
 * Direct ledger editing — for corrections and for movements Record does not
 * model (rent, transfers, adjustments). Rows written here do NOT change any
 * position or balance; Record is the normal way in.
 */
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
    currency: transaction?.currency ?? 'CZK',
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

  // The rate for the transaction's own date (ECB for past dates, live for
  // today, 1 for CZK). Pre-filled for a new row; an edited row keeps the rate
  // it was frozen at unless the user presses the button.
  const rateOn = useRateOn(form.currency, form.txn_date)
  const [fxTouched, setFxTouched] = useState(editing)
  useEffect(() => {
    if (fxTouched) return
    setForm(f => ({ ...f, fx_rate_czk: rateOn.rate != null ? String(Number(rateOn.rate.toFixed(6))) : '' }))
  }, [rateOn.rate, fxTouched])
  const useSuggestedRate = () => {
    if (rateOn.rate != null) { set('fx_rate_czk', String(Number(rateOn.rate.toFixed(6)))); setFxTouched(true) }
  }

  const showsQuantity = QUANTITY_TYPES.includes(form.type)
  const q = parseDecimal(form.quantity), pr = parseDecimal(form.price)
  const autoAmount = q != null && pr != null ? (q * pr).toFixed(2) : null

  const handleSubmit = async () => {
    if (!activeProfile) { setError('No active profile selected.'); return }
    if (!form.txn_date) { setError('A date is required.'); return }

    const amountAbs = parseDecimal(form.amount) ?? NaN
    if (!isFinite(amountAbs) || amountAbs <= 0) {
      setError('Enter the amount as a positive number — the sign follows the type.')
      return
    }

    // The rate is frozen on the row. Deriving it later from today's rate would
    // silently rewrite the CZK value of every historical transaction.
    const rate = form.currency === 'CZK' ? 1 : (parseDecimal(form.fx_rate_czk) ?? NaN)
    if (!isFinite(rate) || rate <= 0) {
      setError('An FX rate is required — it is frozen on the row so historical CZK values stay correct.')
      return
    }

    const quantity = form.quantity.trim() ? parseDecimal(form.quantity) : null
    const price = form.price.trim() ? parseDecimal(form.price) : null
    if (showsQuantity && form.quantity.trim() && (quantity == null || quantity <= 0)) {
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
      fee: parseDecimal(form.fee) ?? 0,
      tax: parseDecimal(form.tax) ?? 0,
      currency: form.currency,
      fx_rate_czk: rate,
      is_external: form.is_external,
      notes: form.notes.trim() || null,
    }

    const { error: err } = editing
      ? await updateScoped('transactions', transaction!.id, activeProfile.id, payload)
      : await insertScoped('transactions', activeProfile.id, [payload])

    setSaving(false)
    if (err) { setError(err); return }
    onSaved()
  }

  return (
    <Modal
      title={editing ? 'Edit transaction' : 'Add transaction'}
      subtitle="Amounts are entered positive; the sign follows the type"
      onClose={onClose}
      width={560}
    >
      {!editing && (
        <Notice tone="gray">
          This edits the ledger only. To buy, sell, log a dividend or move cash — and update the position or
          balance at the same time — use <strong>Record</strong> in the sidebar.
        </Notice>
      )}
      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="Date">
          <input style={inputStyle} type="date" value={form.txn_date} max={todayISO()} onChange={e => set('txn_date', e.target.value)} />
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
              <NumberInput placeholder="10" value={form.quantity} onChange={v => set('quantity', v)} />
            </Field>
            <Field label="Price per unit">
              <NumberInput placeholder="58,50" value={form.price} onChange={v => set('price', v)} />
            </Field>
          </>
        )}

        <Field
          label={`Amount (${expectedSign(form.type) > 0 ? 'in' : 'out'})`}
          hint={autoAmount ? `Auto: ${autoAmount}` : undefined}
        >
          <NumberInput
            placeholder={autoAmount ?? '1000'}
            value={form.amount} onChange={v => set('amount', v)}
            onFocus={() => { if (!form.amount && autoAmount) set('amount', autoAmount) }}
          />
        </Field>
        <Field label="Currency">
          <select style={inputStyle} value={form.currency} onChange={e => { set('currency', e.target.value); if (!editing) setFxTouched(false) }}>
            <option>CZK</option><option>USD</option><option>EUR</option><option>GBP</option><option>CHF</option><option>PLN</option>
          </select>
        </Field>

        <Field label="Fee">
          <NumberInput value={form.fee} onChange={v => set('fee', v)} />
        </Field>
        <Field label="Tax withheld">
          <NumberInput value={form.tax} onChange={v => set('tax', v)} />
        </Field>

        {form.currency !== 'CZK' && (
          <Field
            label={`FX rate (CZK per 1 ${form.currency})`}
            hint={rateOn.loading ? 'looking up…' : rateOn.rate != null ? `${rateOn.source}: ${rateOn.rate.toFixed(4)}` : rateOn.source}
            span="2"
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <NumberInput placeholder="23,45" value={form.fx_rate_czk}
                onChange={v => { set('fx_rate_czk', v); setFxTouched(true) }} />
              <button type="button" onClick={useSuggestedRate} disabled={rateOn.rate == null} style={{
                padding: '7px 12px', borderRadius: 6, cursor: rateOn.rate == null ? 'not-allowed' : 'pointer',
                background: 'var(--bg3)', border: '1px solid var(--border2)',
                color: 'var(--text2)', fontSize: 11, whiteSpace: 'nowrap',
                opacity: rateOn.rate == null ? 0.5 : 1,
              }}>Use rate on date</button>
            </div>
          </Field>
        )}

        <Field label="" span="2">
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_external}
              onChange={e => set('is_external', e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--green)', cursor: 'pointer', marginTop: 2 }} />
            <span style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
              External flow
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text3)' }}>
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
