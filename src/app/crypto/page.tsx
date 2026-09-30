'use client'
import { useEffect, useMemo, useState } from 'react'
import type { CryptoHolding } from '@/lib/supabase'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import { useFx } from '@/hooks/useFx'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { useMarketData } from '@/hooks/useMarketData'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel } from '@/components/PageShell'
import Badge from '@/components/Badge'
import Modal from '@/components/Modal'
import RecordModal, { type RecordPreset } from '@/components/RecordModal'
import DataTable, { type Column } from '@/components/DataTable'
import { Field, FormGrid, FormActions, ErrorBox, NumberInput, Notice, inputStyle } from '@/components/FormFields'
import { useUndoableDelete } from '@/components/UndoToast'
import { fmtCZK, fmtSignedCZK, fmtNum, fmtPct, fmtShare, historicalRate } from '@/lib/fx'
import { buildPositions, type Position } from '@/lib/portfolio'
import { updateScoped, deleteScoped } from '@/lib/db'
import { parseDecimal, parsePercent } from '@/lib/parse'
import { btnStyle, actionBtn, signColor } from '@/lib/ui'

type Row = { c: CryptoHolding; p: Position; price: number; change: number | null }

export default function CryptoPage() {
  const app = useAppData()
  const { cryptoHoldings: coins, loading, reload } = app
  const { activeProfile } = useProfile()
  const { fx, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const prices = useCryptoPrices()
  const market = useMarketData()
  const [record, setRecord] = useState<RecordPreset | null>(null)
  const [editing, setEditing] = useState<CryptoHolding | null>(null)
  const { schedule, pendingIds, toast } = useUndoableDelete()

  const coinKey = coins.map(c => c.coin_id).join(',')
  useEffect(() => {
    if (coinKey) prices.refresh(coinKey.split(','))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinKey])

  const visible = coins.filter(c => !pendingIds.has(c.id))
  // Same valuation as everywhere else (and cost at the rate it was paid).
  const positions = useMemo(
    () => buildPositions({ ...app, cryptoHoldings: visible, holdings: [], bankAccounts: [], realEstate: [], bondHoldings: [] }, fx, market, prices),
    [app, visible, fx, market, prices]
  )
  const rows: Row[] = visible.map(c => ({
    c, p: positions.find(p => p.id === c.id)!,
    price: prices.getPrice(c.coin_id, c.avg_cost_usd),
    change: prices.getChange(c.coin_id),
  })).filter(r => r.p)

  const value = rows.reduce((s, r) => s + r.p.valueCZK, 0)
  const cost = rows.reduce((s, r) => s + r.p.costCZK, 0)
  const pl = value - cost
  const staking = rows.reduce((s, r) => s + r.p.annualIncomeCZK, 0)
  const atCost = rows.filter(r => !r.p.isLivePrice)
  const fxUnknown = rows.filter(r => r.c.avg_fx_czk == null)

  if (loading) return <LoadingShell />

  const columns: Column<Row>[] = [
    { key: 'name', label: 'Asset', sortValue: r => r.c.name, render: r => <>
      <div style={{ fontWeight: 500 }}>{r.c.name} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{r.c.symbol}</span></div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.c.wallet_label ?? r.c.coin_id}</div>
    </> },
    { key: 'amount', label: 'Amount', numeric: true, sortValue: r => r.c.amount, render: r => fmtNum(r.c.amount, 6) },
    { key: 'price', label: 'Price (USD)', numeric: true, sortValue: r => r.price, render: r => <>
      {fmtNum(r.price, 2)}
      {!r.p.isLivePrice && <> <Badge variant="amber">at cost</Badge></>}
      {r.change != null && <div style={{ fontSize: 11, color: signColor(r.change) }}>{fmtPct(r.change)} 24h</div>}
    </> },
    { key: 'value', label: 'Value (CZK)', numeric: true, sortValue: r => r.p.valueCZK, render: r => fmtCZK(r.p.valueCZK) },
    { key: 'cost', label: 'Cost (CZK)', numeric: true, sortValue: r => r.p.costCZK, render: r => <>
      {fmtCZK(r.p.costCZK)}
      {r.c.avg_fx_czk == null && <div style={{ fontSize: 10, color: 'var(--text3)' }} title="USD/CZK at purchase unknown — today's rate used">FX ?</div>}
    </> },
    { key: 'pl', label: 'P&L', numeric: true, sortValue: r => r.p.valueCZK - r.p.costCZK, render: r => {
      const v = r.p.valueCZK - r.p.costCZK
      return <span style={{ color: signColor(v) }}>{fmtSignedCZK(v)}<div style={{ fontSize: 10 }}>{fmtPct(r.p.costCZK > 0 ? (v / r.p.costCZK) * 100 : null, 1)}</div></span>
    } },
    { key: 'apy', label: 'Staking', numeric: true, sortValue: r => r.c.staking_apy, render: r => r.c.staking_apy > 0 ? <>
      {fmtShare(r.c.staking_apy * 100, 2)}<div style={{ fontSize: 10, color: 'var(--text3)' }}>{fmtCZK(r.p.annualIncomeCZK)}/yr</div>
    </> : '—' },
    { key: 'actions', label: '', align: 'center', render: r => (
      <span style={{ whiteSpace: 'nowrap' }}>
        <button type="button" aria-label={`Buy more ${r.c.symbol}`} title="Buy" onClick={() => setRecord({ kind: 'buy', asset: 'crypto', coinId: r.c.coin_id })} style={actionBtn}>+</button>
        <button type="button" aria-label={`Sell ${r.c.symbol}`} title="Sell" onClick={() => setRecord({ kind: 'sell', asset: 'crypto', coinId: r.c.coin_id })} style={{ ...actionBtn, marginLeft: 4 }}>−</button>
        <button type="button" aria-label={`Edit ${r.c.symbol}`} title="Edit" onClick={() => setEditing(r.c)} style={{ ...actionBtn, marginLeft: 4 }}>✎</button>
        <button type="button" aria-label={`Delete ${r.c.symbol}`} title="Delete (mistake)" onClick={() =>
          schedule(r.c.id, r.c.symbol, () => deleteScoped('crypto_holdings', r.c.id, activeProfile?.id), reload)}
          style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}>✕</button>
      </span>
    ) },
  ]

  return (
    <PageShell>
      {toast}
      {record && <RecordModal preset={record} onClose={() => setRecord(null)} onSaved={reload} />}
      {editing && <CoinModal coin={editing} onClose={() => setEditing(null)} onSaved={reload} />}

      <PageHeader
        eyebrow="Assets"
        accent="var(--c-crypto)"
        title="Crypto"
        subtitle={<>Priced in USD via CoinGecko, valued in CZK{fxTs && <> · FX {fxTs}</>}</>}
        actions={<>
          <button type="button" onClick={refreshFx} disabled={fxLoading} style={btnStyle('secondary')}>{fxLoading ? '⟳ FX…' : '↻ FX'}</button>
          {coins.length > 0 && (
            <button type="button" onClick={() => prices.refresh(coins.map(c => c.coin_id), true)} disabled={prices.state === 'loading'} style={btnStyle('secondary')}>
              {prices.state === 'loading' ? '⟳ Fetching…' : '↻ Prices'}
            </button>
          )}
          <button type="button" onClick={() => setRecord({ kind: 'buy', asset: 'crypto' })} style={btnStyle('primary')}>+ Buy</button>
        </>}
      />

      {prices.state === 'error' && (
        <Notice>⚠ Live crypto prices unavailable — coins are valued at average cost. {prices.errorMsg}</Notice>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="⬡"
          title="No crypto yet"
          body="Record a purchase with its date — the USD/CZK rate that day is kept, so your P&L includes the currency effect. You need the CoinGecko id (e.g. bitcoin, ethereum)."
          action={<button type="button" onClick={() => setRecord({ kind: 'buy', asset: 'crypto' })} style={btnStyle('primary')}>+ Record a purchase</button>}
        />
      ) : <>
        <MetricCards cards={[
          { label: 'Value', value: fmtCZK(value), accent: 'var(--c-crypto)', note: `${rows.length} assets${atCost.length ? ` · ${atCost.length} at cost` : ''}` },
          { label: 'Cost', value: fmtCZK(cost), accent: 'var(--border3)', note: fxUnknown.length ? `${fxUnknown.length} without purchase rate` : 'at the rates paid' },
          { label: 'Unrealised P&L', value: fmtSignedCZK(pl), color: signColor(pl), accent: signColor(pl), note: fmtPct(cost > 0 ? (pl / cost) * 100 : null, 1) },
          { label: 'Staking a year', value: staking > 0 ? fmtCZK(staking) : '—', accent: 'var(--c-income)', note: 'gross, at today\'s price' },
        ]} />
        <Panel title="Holdings" padded={false}>
          <DataTable caption="Crypto holdings" columns={columns} rows={rows} rowKey={r => r.c.id} initialSort={{ key: 'value', dir: 'desc' }} />
        </Panel>
      </>}
    </PageShell>
  )
}

/** Corrections and non-trade details (wallet, staking). Buys and sells go through Record. */
function CoinModal({ coin, onClose, onSaved }: { coin: CryptoHolding; onClose: () => void; onSaved: () => void }) {
  const { activeProfile } = useProfile()
  const [form, setForm] = useState({
    name: coin.name, symbol: coin.symbol, amount: String(coin.amount), avg_cost_usd: String(coin.avg_cost_usd),
    avg_fx_czk: coin.avg_fx_czk != null ? String(coin.avg_fx_czk) : '',
    wallet_label: coin.wallet_label ?? '', staking_apy: String(Number((coin.staking_apy * 100).toFixed(3))),
    purchase_date: coin.purchase_date ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm(f => ({ ...f, [k]: v }))

  const lookUp = async () => {
    if (!form.purchase_date) { setError('Enter the purchase date first.'); return }
    const r = await historicalRate('USD', form.purchase_date)
    if (r == null) { setError('No ECB rate for that date — enter it by hand.'); return }
    setError(''); set('avg_fx_czk', String(Number(r.toFixed(6))))
  }

  const save = async () => {
    const amount = parseDecimal(form.amount), cost = parseDecimal(form.avg_cost_usd)
    const apy = form.staking_apy.trim() ? parsePercent(form.staking_apy) : 0
    const fx = form.avg_fx_czk.trim() ? parseDecimal(form.avg_fx_czk) : null
    if (amount == null || amount <= 0 || cost == null || cost < 0) { setError('Amount and average cost must be valid numbers.'); return }
    if (apy == null || apy < 0 || apy > 1) { setError('Staking APY must be a percentage between 0 and 100.'); return }
    if (form.avg_fx_czk.trim() && (fx == null || fx <= 0)) { setError('Purchase USD/CZK must be positive.'); return }
    setSaving(true)
    const { error: err } = await updateScoped('crypto_holdings', coin.id, activeProfile?.id, {
      name: form.name.trim() || coin.name, symbol: form.symbol.trim().toUpperCase() || coin.symbol,
      amount, avg_cost_usd: cost, avg_fx_czk: fx, wallet_label: form.wallet_label.trim() || null,
      staking_apy: apy, purchase_date: form.purchase_date || null, updated_at: new Date().toISOString(),
    })
    setSaving(false)
    if (err) { setError(err); return }
    onSaved(); onClose()
  }

  return (
    <Modal title="Edit coin" subtitle={`${coin.name} · ${coin.coin_id}`} onClose={onClose} width={520}>
      <Notice tone="gray">To record a purchase or sale use <strong>Buy</strong> / <strong>−</strong>. This form is for corrections and staking details.</Notice>
      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="Name"><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Symbol"><input style={inputStyle} value={form.symbol} onChange={e => set('symbol', e.target.value)} /></Field>
        <Field label="Amount"><NumberInput value={form.amount} onChange={v => set('amount', v)} /></Field>
        <Field label="Average cost"><NumberInput value={form.avg_cost_usd} onChange={v => set('avg_cost_usd', v)} suffix="USD" /></Field>
        <Field label="Purchase date"><input style={inputStyle} type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} /></Field>
        <Field label="Avg purchase rate (CZK/USD)" hint={<button type="button" onClick={lookUp} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--blue)', cursor: 'pointer', fontSize: 10, textDecoration: 'underline' }}>Use ECB rate on purchase date</button>}>
          <NumberInput value={form.avg_fx_czk} onChange={v => set('avg_fx_czk', v)} placeholder="unknown" />
        </Field>
        <Field label="Wallet / exchange"><input style={inputStyle} value={form.wallet_label} onChange={e => set('wallet_label', e.target.value)} /></Field>
        <Field label="Staking APY"><NumberInput value={form.staking_apy} onChange={v => set('staking_apy', v)} suffix="%" /></Field>
      </FormGrid>
      <FormActions onCancel={onClose} onSubmit={save} label="Save" saving={saving} />
    </Modal>
  )
}
