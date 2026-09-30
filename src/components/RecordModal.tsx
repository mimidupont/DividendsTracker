'use client'
import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { Field, FormGrid, FormActions, ErrorBox, NumberInput, Notice, inputStyle } from './FormFields'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import { useRateOn } from '@/hooks/useRateOn'
import { recordEvent, type RecordEvent, type RecordKind } from '@/lib/db'
import { parseDecimal } from '@/lib/parse'
import { todayISO } from '@/lib/date'
import { whtRateFor, CZ_INTEREST_TAX, CZ_COUPON_TAX } from '@/lib/tax'
import { accruedInterest } from '@/lib/bonds'
import { fmtNum } from '@/lib/fx'

type AssetKind = 'stock' | 'crypto' | 'bond'

export interface RecordPreset {
  kind?: RecordKind
  asset?: AssetKind
  symbol?: string
  coinId?: string
  bondId?: string
  accountId?: string
}

const KINDS: { key: RecordKind; label: string }[] = [
  { key: 'buy', label: 'Buy' },
  { key: 'sell', label: 'Sell' },
  { key: 'dividend', label: 'Dividend' },
  { key: 'coupon', label: 'Coupon' },
  { key: 'interest', label: 'Interest' },
  { key: 'deposit', label: 'Deposit' },
  { key: 'withdrawal', label: 'Withdrawal' },
  { key: 'split', label: 'Split' },
]

const CURRENCIES = ['CZK', 'USD', 'EUR', 'GBP', 'CHF', 'PLN']

/**
 * One form for every money movement. Writes the ledger row and applies it to
 * the position / dividend log / bank balance in a single database call, so
 * nothing has to be entered twice and the two can never disagree.
 */
export default function RecordModal({
  onClose, onSaved, preset,
}: {
  onClose: () => void
  onSaved?: () => void
  preset?: RecordPreset
}) {
  const app = useAppData()
  const { activeProfile } = useProfile()
  const held = app.holdings.filter(h => h.shares > 0)

  const [kind, setKind] = useState<RecordKind>(preset?.kind ?? 'buy')
  const [asset, setAsset] = useState<AssetKind>(preset?.asset ?? 'stock')
  const [date, setDate] = useState(todayISO())
  const [symbol, setSymbol] = useState(preset?.symbol ?? '')
  const [name, setName] = useState('')
  const [newCcy, setNewCcy] = useState('USD')
  const [coinId, setCoinId] = useState(preset?.coinId ?? '')
  const [bondId, setBondId] = useState(preset?.bondId ?? app.bondHoldings[0]?.id ?? '')
  const [accountId, setAccountId] = useState(preset?.accountId ?? app.bankAccounts[0]?.id ?? '')
  const [settleId, setSettleId] = useState('')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [fee, setFee] = useState('')
  const [gross, setGross] = useState('')
  const [tax, setTax] = useState('')
  const [taxTouched, setTaxTouched] = useState(false)
  const [amount, setAmount] = useState('')
  const [accrued, setAccrued] = useState('')
  const [fxText, setFxText] = useState('')
  const [fxTouched, setFxTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const holding = held.find(h => h.symbol.toUpperCase() === symbol.trim().toUpperCase())
    ?? app.holdings.find(h => h.symbol.toUpperCase() === symbol.trim().toUpperCase())
  const coin = app.cryptoHoldings.find(c => c.coin_id === coinId.trim())
  const bond = app.bondHoldings.find(b => b.id === bondId)
  const account = app.bankAccounts.find(a => a.id === accountId)

  const isCash = kind === 'deposit' || kind === 'withdrawal' || kind === 'interest'
  const isTrade = kind === 'buy' || kind === 'sell'
  const effAsset: AssetKind | 'cash' = isCash ? 'cash' : kind === 'dividend' || kind === 'split' ? 'stock' : kind === 'coupon' ? 'bond' : asset

  // The currency is dictated by what is being traded — never a free choice
  // when the position already exists, or the cost basis would mix currencies.
  const currency = effAsset === 'cash' ? (account?.currency ?? 'CZK')
    : effAsset === 'bond' ? (bond?.currency ?? 'CZK')
    : effAsset === 'crypto' ? 'USD'
    : (holding?.currency ?? newCcy)

  const rateOn = useRateOn(currency, date)
  useEffect(() => {
    if (!fxTouched) setFxText(rateOn.rate != null ? String(Number(rateOn.rate.toFixed(6))) : '')
  }, [rateOn.rate, fxTouched])
  useEffect(() => { setFxTouched(false) }, [currency, date])

  // Sensible tax defaults: treaty WHT on dividends, 15 % on CZ interest/coupons.
  const meta = app.assetMetadata.find(m => m.symbol.toUpperCase() === symbol.trim().toUpperCase())
  const wht = whtRateFor(meta)
  useEffect(() => {
    if (taxTouched) return
    const g = parseDecimal(gross)
    if (g == null) { setTax(''); return }
    const rate = kind === 'dividend' ? wht.rate
      : kind === 'interest' ? (currency === 'CZK' ? CZ_INTEREST_TAX : 0)
      : kind === 'coupon' ? (currency === 'CZK' ? CZ_COUPON_TAX : 0) : 0
    setTax(rate > 0 ? String(Number((g * rate).toFixed(2))) : '0')
  }, [gross, kind, wht.rate, currency, taxTouched])

  // Accrued interest (AÚV) for a bond trade, recomputed until the user edits it.
  const [accruedTouched, setAccruedTouched] = useState(false)
  useEffect(() => {
    if (accruedTouched || effAsset !== 'bond' || !isTrade || !bond) return
    const q = parseDecimal(qty)
    setAccrued(q != null ? String(Number((accruedInterest(bond, date) * q).toFixed(2))) : '')
  }, [bond, qty, date, effAsset, isTrade, accruedTouched])

  // Coupon default: one period's coupon on the current holding.
  useEffect(() => {
    if (kind !== 'coupon' || !bond || gross) return
    if (bond.coupon_freq > 0) {
      setGross(String(Number((bond.face_value * bond.quantity * bond.coupon_rate / bond.coupon_freq).toFixed(2))))
    }
  }, [kind, bond, gross])

  const settleAccounts = useMemo(
    () => app.bankAccounts.filter(a => a.currency.toUpperCase() === currency.toUpperCase()),
    [app.bankAccounts, currency]
  )

  const submit = async () => {
    setError('')
    const fx = kind === 'split' ? 1 : parseDecimal(fxText)
    if (fx == null || fx <= 0) { setError(`Enter the CZK rate for ${currency} on ${date}.`); return }
    const base = { date, currency, fx_rate_czk: currency === 'CZK' ? 1 : fx, notes: notes.trim() || null }
    let event: RecordEvent

    if (isTrade) {
      const q = parseDecimal(qty), p = parseDecimal(price), f = parseDecimal(fee) ?? 0
      if (q == null || q <= 0 || p == null || p <= 0) { setError('Quantity and price must be positive numbers.'); return }
      if (f < 0) { setError('Fee cannot be negative.'); return }
      const settle = settleId || null
      if (effAsset === 'stock') {
        const sym = symbol.trim().toUpperCase()
        if (!sym) { setError('Enter a ticker.'); return }
        if (kind === 'sell' && !holding) { setError(`You hold no ${sym}.`); return }
        event = { ...base, kind, asset_class: 'stock', symbol: sym, name: name.trim() || undefined,
          quantity: q, price: p, fee: f, cash_account_id: settle }
      } else if (effAsset === 'crypto') {
        const id = coinId.trim().toLowerCase()
        if (!id) { setError('Enter the CoinGecko id (e.g. bitcoin).'); return }
        event = { ...base, kind, asset_class: 'crypto', coin_id: id, symbol: symbol.trim().toUpperCase() || undefined,
          name: name.trim() || undefined, quantity: q, price: p, fee: f, cash_account_id: settle }
      } else {
        if (!bond) { setError('Choose a bond (add it on the Bonds page first).'); return }
        event = { ...base, kind, asset_class: 'bond', bond_id: bond.id, quantity: q, price_pct: p,
          accrued: parseDecimal(accrued) ?? 0, fee: f, cash_account_id: settle }
      }
    } else if (kind === 'split') {
      const sym = symbol.trim().toUpperCase()
      const ratio = parseDecimal(qty)
      if (!holding) { setError(`You hold no ${sym || 'such position'}.`); return }
      if (ratio == null || ratio <= 0 || ratio === 1) { setError('Enter the split ratio, e.g. 4 for a 4-for-1 split or 0,1 for 1-for-10.'); return }
      event = { ...base, fx_rate_czk: 1, currency: holding.currency, kind, asset_class: 'stock', symbol: sym, quantity: ratio }
    } else if (kind === 'dividend' || kind === 'coupon' || kind === 'interest') {
      const g = parseDecimal(gross), t = parseDecimal(tax) ?? 0
      if (g == null || g <= 0) { setError('Gross amount must be positive.'); return }
      if (t < 0 || t > g) { setError('Tax must be between 0 and the gross amount.'); return }
      if (kind === 'dividend') {
        const sym = symbol.trim().toUpperCase()
        if (!sym) { setError('Choose the paying holding.'); return }
        event = { ...base, kind, asset_class: 'stock', symbol: sym, gross: g, tax: t,
          shares_held: holding?.shares, amount_per_share: holding && holding.shares > 0 ? g / holding.shares : undefined,
          cash_account_id: settleId || null }
      } else if (kind === 'coupon') {
        if (!bond) { setError('Choose a bond.'); return }
        event = { ...base, kind, asset_class: 'bond', bond_id: bond.id, gross: g, tax: t, cash_account_id: settleId || null }
      } else {
        if (!account) { setError('Choose an account.'); return }
        event = { ...base, kind, asset_class: 'cash', account_id: account.id, gross: g, tax: t }
      }
    } else {
      const a = parseDecimal(amount)
      if (a == null || a <= 0) { setError('Amount must be positive.'); return }
      if (!account) { setError('Choose an account.'); return }
      event = { ...base, kind, asset_class: 'cash', account_id: account.id, amount: a }
    }

    setSaving(true)
    const { error: err } = await recordEvent(activeProfile?.id, event)
    setSaving(false)
    if (err) { setError(err); return }
    await app.reload()
    onSaved?.()
    onClose()
  }

  const kindButton = (k: { key: RecordKind; label: string }) => (
    <button
      key={k.key}
      type="button"
      role="radio"
      aria-checked={kind === k.key}
      onClick={() => { setKind(k.key); setError('') }}
      style={{
        padding: '5px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${kind === k.key ? 'var(--green-bd)' : 'var(--border2)'}`,
        background: kind === k.key ? 'var(--green-bg)' : 'var(--bg2)',
        color: kind === k.key ? 'var(--green)' : 'var(--text2)',
        fontWeight: kind === k.key ? 600 : 400,
      }}
    >{k.label}</button>
  )

  const fxField = currency !== 'CZK' && kind !== 'split' && (
    <Field label={`CZK per ${currency}`} hint={rateOn.loading ? 'looking up…' : rateOn.source}>
      <NumberInput value={fxText} onChange={v => { setFxText(v); setFxTouched(true) }} />
    </Field>
  )

  const settleField = settleAccounts.length > 0 && (
    <Field label={kind === 'buy' ? 'Paid from (optional)' : 'Paid into (optional)'}
      hint="Updates that account's balance too.">
      <select style={inputStyle} value={settleId} onChange={e => setSettleId(e.target.value)}>
        <option value="">— not tracked —</option>
        {settleAccounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.institution}</option>)}
      </select>
    </Field>
  )

  return (
    <Modal title="Record" subtitle="Writes the ledger and updates the position in one step" onClose={onClose} width={560}>
      <div role="radiogroup" aria-label="What happened" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
        {KINDS.map(kindButton)}
      </div>

      {isTrade && (
        <div role="radiogroup" aria-label="Asset" style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['stock', 'crypto', 'bond'] as AssetKind[]).map(a => (
            <button key={a} type="button" role="radio" aria-checked={asset === a} onClick={() => setAsset(a)} style={{
              padding: '4px 10px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
              border: `1px solid ${asset === a ? 'var(--border3)' : 'var(--border2)'}`,
              background: asset === a ? 'var(--bg4)' : 'var(--bg2)', color: 'var(--text2)',
            }}>{a === 'stock' ? 'Stock / ETF' : a === 'crypto' ? 'Crypto' : 'Bond'}</button>
          ))}
        </div>
      )}

      <ErrorBox msg={error} />

      <FormGrid>
        <Field label="Date">
          <input style={inputStyle} type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} />
        </Field>

        {/* ── What ── */}
        {(effAsset === 'stock') && (
          <Field label={kind === 'dividend' ? 'Paid by' : 'Ticker'}>
            <input style={inputStyle} list="record-held-symbols" value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL" />
            <datalist id="record-held-symbols">
              {held.map(h => <option key={h.id} value={h.symbol}>{h.name}</option>)}
            </datalist>
          </Field>
        )}
        {effAsset === 'crypto' && (
          <Field label="CoinGecko id">
            <input style={inputStyle} list="record-coins" value={coinId} onChange={e => setCoinId(e.target.value)} placeholder="bitcoin" />
            <datalist id="record-coins">
              {app.cryptoHoldings.map(c => <option key={c.id} value={c.coin_id}>{c.symbol}</option>)}
            </datalist>
          </Field>
        )}
        {effAsset === 'bond' && (
          <Field label="Bond">
            <select style={inputStyle} value={bondId} onChange={e => setBondId(e.target.value)}>
              {app.bondHoldings.length === 0 && <option value="">No bonds yet — add one on the Bonds page</option>}
              {app.bondHoldings.map(b => <option key={b.id} value={b.id}>{b.name} · {b.isin}</option>)}
            </select>
          </Field>
        )}
        {effAsset === 'cash' && (
          <Field label="Account">
            <select style={inputStyle} value={accountId} onChange={e => setAccountId(e.target.value)}>
              {app.bankAccounts.length === 0 && <option value="">No accounts yet</option>}
              {app.bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.institution} ({a.currency})</option>)}
            </select>
          </Field>
        )}

        {/* New stock position: name + currency */}
        {effAsset === 'stock' && kind === 'buy' && symbol.trim() && !holding && (<>
          <Field label="Name (new position)">
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Apple Inc." />
          </Field>
          <Field label="Trading currency">
            <select style={inputStyle} value={newCcy} onChange={e => setNewCcy(e.target.value)}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </>)}
        {effAsset === 'crypto' && kind === 'buy' && coinId.trim() && !coin && (<>
          <Field label="Symbol (new coin)">
            <input style={inputStyle} value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="BTC" />
          </Field>
          <Field label="Name">
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Bitcoin" />
          </Field>
        </>)}

        {/* ── Amounts ── */}
        {isTrade && (<>
          <Field label={effAsset === 'bond' ? 'Number of bonds' : effAsset === 'crypto' ? 'Amount' : 'Shares'}
            hint={kind === 'sell' && effAsset === 'stock' && holding ? `You hold ${fmtNum(holding.shares, 4)}` :
                  kind === 'sell' && effAsset === 'bond' && bond ? `You hold ${fmtNum(bond.quantity, 0)}` : undefined}>
            <NumberInput value={qty} onChange={setQty} placeholder="10" />
          </Field>
          <Field label={effAsset === 'bond' ? 'Clean price (% of par)' : 'Price per unit'}>
            <NumberInput value={price} onChange={setPrice} placeholder={effAsset === 'bond' ? '99,5' : '150'}
              suffix={effAsset === 'bond' ? '%' : currency} />
          </Field>
          {effAsset === 'bond' && (
            <Field label="Accrued interest (AÚV)" hint="Paid on top of the clean price; part of your cost.">
              <NumberInput value={accrued} onChange={v => { setAccrued(v); setAccruedTouched(true) }} suffix={currency} />
            </Field>
          )}
          <Field label="Fee">
            <NumberInput value={fee} onChange={setFee} placeholder="0" suffix={currency} />
          </Field>
          {settleField}
        </>)}

        {(kind === 'dividend' || kind === 'coupon' || kind === 'interest') && (<>
          <Field label="Gross amount">
            <NumberInput value={gross} onChange={setGross} suffix={currency} />
          </Field>
          <Field label="Tax withheld" hint={
            kind === 'dividend'
              ? `Default ${(wht.rate * 100).toFixed(wht.rate * 100 % 1 ? 2 : 0)} % (${wht.basis === 'country' ? `issuer country ${meta?.country}` : wht.basis === 'region' ? 'by region' : 'US treaty rate — set the issuer country on Allocation to refine'}). Use what your broker actually withheld.`
              : currency === 'CZK' ? 'Czech 15 % final withholding by default.' : 'Enter what was withheld.'
          }>
            <NumberInput value={tax} onChange={v => { setTax(v); setTaxTouched(true) }} suffix={currency} />
          </Field>
          {kind !== 'interest' && settleField}
        </>)}

        {kind === 'split' && (
          <Field label="New shares per old share" hint={holding ? `${fmtNum(holding.shares, 4)} → ${fmtNum(holding.shares * (parseDecimal(qty) ?? 1), 4)} shares; total cost unchanged` : '4 for a 4-for-1 split, 0,1 for a 1-for-10 reverse split'}>
            <NumberInput value={qty} onChange={setQty} placeholder="4" />
          </Field>
        )}

        {(kind === 'deposit' || kind === 'withdrawal') && (
          <Field label="Amount" hint={kind === 'deposit' ? 'New money from outside your wealth (salary, gift).' : 'Money leaving your wealth (spending).'}>
            <NumberInput value={amount} onChange={setAmount} suffix={currency} />
          </Field>
        )}

        {fxField}

        <Field label="Notes (optional)" span="2">
          <input style={inputStyle} value={notes} onChange={e => setNotes(e.target.value)} />
        </Field>
      </FormGrid>

      {kind === 'dividend' && holding && (
        <Notice tone="gray">Recorded in the position&apos;s currency ({holding.currency}). To reinvest it, use “Check dividends (DRIP)” on Stocks &amp; ETFs.</Notice>
      )}

      <FormActions onCancel={onClose} onSubmit={submit} label="Record" saving={saving} />
    </Modal>
  )
}
