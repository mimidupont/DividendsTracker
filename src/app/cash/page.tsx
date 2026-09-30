'use client'
import { useEffect, useMemo, useState } from 'react'
import type { BankAccount } from '@/lib/supabase'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, Tabs } from '@/components/PageShell'
import Badge from '@/components/Badge'
import Modal from '@/components/Modal'
import RecordModal, { type RecordPreset } from '@/components/RecordModal'
import DataTable, { type Column } from '@/components/DataTable'
import { Field, FormGrid, FormActions, ErrorBox, NumberInput, inputStyle } from '@/components/FormFields'
import { useUndoableDelete } from '@/components/UndoToast'
import { toCZK, fmtCZK, fmtNum, fmtShare } from '@/lib/fx'
import { fmtISODate, todayISO, daysBetween } from '@/lib/date'
import { buildPositions, cashTier, LIQUIDITY_TIERS } from '@/lib/portfolio'
import { updateScoped, insertScoped } from '@/lib/db'
import { parseDecimal, parsePercent } from '@/lib/parse'
import { CZ_INTEREST_TAX } from '@/lib/tax'
import { btnStyle, actionBtn } from '@/lib/ui'

const TYPE_LABEL: Record<BankAccount['account_type'], string> = {
  checking: 'Current account', savings: 'Savings', money_market: 'Money market', fixed_deposit: 'Term deposit',
}
const TIER_LABEL: Record<string, string> = {
  instant: 'Instant', week: 'Within a week', month: 'Within a month', year: 'Within a year', illiquid: 'Locked',
}

type Tab = 'current' | 'savings' | 'interest'

export default function CashPage() {
  const app = useAppData()
  const { bankAccounts: accounts, bankInterest, loading, reload } = app
  const { activeProfile } = useProfile()
  const { fx, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const market = useMarketData()
  const crypto = useCryptoPrices()
  const [tab, setTab] = useState<Tab>('savings')
  const [editing, setEditing] = useState<BankAccount | 'new' | null>(null)
  const [record, setRecord] = useState<RecordPreset | null>(null)
  const { schedule, pendingIds, toast } = useUndoableDelete()

  const visible = accounts.filter(a => !pendingIds.has(a.id))
  const current = visible.filter(a => a.account_type === 'checking')
  const savings = visible.filter(a => a.account_type !== 'checking')
  useEffect(() => {
    // Open on whichever tab has something in it.
    if (!loading && savings.length === 0 && current.length > 0) setTab('current')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const totalCZK          = visible.reduce((s, a) => s + toCZK(a.balance, a.currency, fx), 0)
  const annualInterestCZK = visible.reduce((s, a) => s + toCZK(a.balance * a.interest_rate, a.currency, fx), 0)
  // Balance-weighted: 6 % on Kč 5 000 does not move the blended rate like 6 % on Kč 500 000.
  const avgRate = totalCZK > 0 ? annualInterestCZK / totalCZK : null
  const today = todayISO()

  const positions = useMemo(() => buildPositions(app, fx, market, crypto), [app, fx, market, crypto])

  const archive = (a: BankAccount) =>
    schedule(a.id, a.name, () => updateScoped('bank_accounts', a.id, activeProfile?.id, { is_active: false }), reload)

  if (loading) return <LoadingShell />

  const columns: Column<BankAccount>[] = [
    { key: 'name', label: 'Account', sortValue: a => a.name, render: a => <>
      <div style={{ fontWeight: 500 }}>{a.name}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{a.institution}</div>
    </> },
    { key: 'type', label: 'Type', sortValue: a => a.account_type, render: a => <>
      <Badge variant="gray">{TYPE_LABEL[a.account_type] ?? a.account_type}</Badge>
      {a.maturity_date && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
          {a.account_type === 'fixed_deposit' ? 'matures' : 'fixed until'} {fmtISODate(a.maturity_date)}
          {a.maturity_date >= today && ` (${daysBetween(today, a.maturity_date)} d)`}
        </div>
      )}
    </> },
    { key: 'access', label: 'Access', sortValue: a => LIQUIDITY_TIERS.indexOf(cashTier(a, today)), render: a => TIER_LABEL[cashTier(a, today)] },
    { key: 'balance', label: 'Balance', numeric: true, sortValue: a => toCZK(a.balance, a.currency, fx), render: a => <>
      <div>{fmtNum(a.balance, 2)} {a.currency}</div>
      {a.currency !== 'CZK' && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtCZK(toCZK(a.balance, a.currency, fx))}</div>}
    </> },
    { key: 'rate', label: 'Rate', numeric: true, sortValue: a => a.interest_rate, render: a => fmtShare(a.interest_rate * 100, 2) },
    { key: 'interest', label: 'Interest / yr (gross)', numeric: true, sortValue: a => toCZK(a.balance * a.interest_rate, a.currency, fx),
      render: a => a.interest_rate > 0 ? fmtCZK(toCZK(a.balance * a.interest_rate, a.currency, fx)) : '—' },
    { key: 'actions', label: '', align: 'center', render: a => (
      <span style={{ whiteSpace: 'nowrap' }}>
        <button type="button" aria-label={`Deposit to ${a.name}`} title="Deposit / withdraw" onClick={() => setRecord({ kind: 'deposit', accountId: a.id })} style={actionBtn}>±</button>
        <button type="button" aria-label={`Record interest on ${a.name}`} title="Record interest" onClick={() => setRecord({ kind: 'interest', accountId: a.id })} style={{ ...actionBtn, marginLeft: 4 }}>%</button>
        <button type="button" aria-label={`Edit ${a.name}`} title="Edit account" onClick={() => setEditing(a)} style={{ ...actionBtn, marginLeft: 4 }}>✎</button>
        <button type="button" aria-label={`Archive ${a.name}`} title="Archive account" onClick={() => archive(a)} style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}>✕</button>
      </span>
    ) },
  ]

  const interestRows = bankInterest.map(i => ({ ...i, name: accounts.find(a => a.id === i.account_id)?.name ?? '—' }))

  return (
    <PageShell>
      {toast}
      {editing && <AccountModal account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {record && <RecordModal preset={record} onClose={() => setRecord(null)} onSaved={reload} />}

      <PageHeader
        eyebrow="Assets"
        accent="var(--c-cash)"
        title="Cash & savings"
        subtitle={<>Current accounts, savings and term deposits{fxTs && <> · FX {fxTs}</>}</>}
        actions={<>
          <button type="button" onClick={refreshFx} disabled={fxLoading} style={btnStyle('secondary')}>{fxLoading ? '⟳ FX…' : '↻ FX'}</button>
          {visible.length > 0 && <button type="button" onClick={() => setRecord({ kind: 'deposit' })} style={btnStyle('secondary')}>± Deposit / withdraw</button>}
          <button type="button" onClick={() => setEditing('new')} style={btnStyle('primary')}>+ Add account</button>
        </>}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon="▭"
          title="No bank accounts yet"
          body="Add your current account, savings accounts and term deposits. Term deposits with a maturity date are counted as locked money in your emergency runway until they mature."
          action={<button type="button" onClick={() => setEditing('new')} style={btnStyle('primary')}>+ Add an account</button>}
        />
      ) : <>
        <MetricCards cards={[
          { label: 'Total cash', value: fmtCZK(totalCZK), accent: 'var(--c-cash)', note: `${visible.length} accounts` },
          { label: 'Interest a year', value: fmtCZK(annualInterestCZK), accent: 'var(--c-income)',
            note: `gross · ≈ ${fmtCZK(annualInterestCZK * (1 - CZ_INTEREST_TAX))} after 15 % tax` },
          { label: 'Blended rate', value: avgRate != null ? fmtShare(avgRate * 100, 2) : '—', accent: 'var(--border3)', note: 'balance-weighted' },
        ]} />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ flex: '2 1 520px', minWidth: 0 }}>
            <Tabs label="Accounts" value={tab} onChange={setTab} tabs={[
              { key: 'savings', label: `Savings & term deposits (${savings.length})` },
              { key: 'current', label: `Current accounts (${current.length})` },
              { key: 'interest', label: `Interest log (${bankInterest.length})` },
            ]} />
            {tab !== 'interest' ? (
              <Panel padded={false}>
                {(tab === 'current' ? current : savings).length === 0
                  ? <div style={{ padding: 24, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>None yet.</div>
                  : <DataTable caption={tab === 'current' ? 'Current accounts' : 'Savings accounts and term deposits'}
                      columns={columns} rows={tab === 'current' ? current : savings} rowKey={a => a.id}
                      initialSort={{ key: 'balance', dir: 'desc' }} />}
              </Panel>
            ) : (
              <Panel padded={false}>
                {interestRows.length === 0
                  ? <div style={{ padding: 24, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
                      No interest logged. Use % on an account to record a payment — it updates the balance too.
                    </div>
                  : <DataTable caption="Interest received" rowKey={r => r.id} rows={interestRows} initialSort={{ key: 'date', dir: 'desc' }} columns={[
                      { key: 'acct', label: 'Account', sortValue: r => r.name, render: r => r.name },
                      { key: 'date', label: 'Date', sortValue: r => r.payment_date, render: r => fmtISODate(r.payment_date) },
                      { key: 'gross', label: 'Gross', numeric: true, sortValue: r => r.gross_amount, render: r => `${fmtNum(r.gross_amount, 2)} ${r.currency}` },
                      { key: 'tax', label: 'Tax', numeric: true, sortValue: r => r.tax_withheld, render: r => r.tax_withheld ? `−${fmtNum(r.tax_withheld, 2)}` : '—' },
                      { key: 'net', label: 'Net', numeric: true, sortValue: r => r.net_amount, render: r => <strong>{fmtNum(r.net_amount, 2)} {r.currency}</strong> },
                    ]} />}
              </Panel>
            )}
          </div>
        </div>
      </>}
    </PageShell>
  )
}

/** Add / edit a bank account. Balance edits are corrections; money moving in or out goes through Record. */
function AccountModal({ account, onClose, onSaved }: { account: BankAccount | null; onClose: () => void; onSaved: () => void }) {
  const { activeProfile } = useProfile()
  const [form, setForm] = useState({
    name: account?.name ?? '',
    institution: account?.institution ?? '',
    account_type: account?.account_type ?? 'savings',
    balance: account ? String(account.balance) : '',
    currency: account?.currency ?? 'CZK',
    interest_rate: account ? String(Number((account.interest_rate * 100).toFixed(3))) : '',
    maturity_date: account?.maturity_date ?? '',
    liquidity_tier: account?.liquidity_tier && account.liquidity_tier !== 'instant' ? account.liquidity_tier : '',
    notes: account?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name.trim() || !form.institution.trim()) { setError('Name and institution are required.'); return }
    const balance = parseDecimal(form.balance)
    if (balance == null) { setError('Enter the balance as a number (e.g. 250 000 or 1 234,56).'); return }
    const rate = form.interest_rate.trim() ? parsePercent(form.interest_rate) : 0
    if (rate == null || rate < 0 || rate > 1) { setError('Interest rate must be a percentage between 0 and 100.'); return }
    if (form.account_type === 'fixed_deposit' && !form.maturity_date) { setError('A term deposit needs a maturity date.'); return }
    const payload = {
      name: form.name.trim(),
      institution: form.institution.trim(),
      account_type: form.account_type,
      balance,
      currency: form.currency,
      interest_rate: rate,
      maturity_date: form.maturity_date || null,
      liquidity_tier: form.liquidity_tier || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    setSaving(true)
    const { error: err } = account
      ? await updateScoped('bank_accounts', account.id, activeProfile?.id, payload)
      : await insertScoped('bank_accounts', activeProfile?.id, [payload])
    setSaving(false)
    if (err) { setError(err); return }
    onSaved(); onClose()
  }

  return (
    <Modal title={account ? 'Edit account' : 'Add account'} onClose={onClose} width={520}>
      <ErrorBox msg={error} />
      <FormGrid>
        <Field label="Account name"><input style={inputStyle} value={form.name} placeholder="Spořicí účet" onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Institution"><input style={inputStyle} value={form.institution} placeholder="Fio banka" onChange={e => set('institution', e.target.value)} /></Field>
        <Field label="Type">
          <select style={inputStyle} value={form.account_type} onChange={e => set('account_type', e.target.value as BankAccount['account_type'])}>
            <option value="checking">Current account</option>
            <option value="savings">Savings</option>
            <option value="money_market">Money market</option>
            <option value="fixed_deposit">Term deposit</option>
          </select>
        </Field>
        <Field label="Currency">
          <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)} disabled={!!account}>
            <option>CZK</option><option>EUR</option><option>USD</option><option>GBP</option><option>CHF</option>
          </select>
        </Field>
        <Field label="Balance" hint={account ? 'Corrections only — record deposits and withdrawals with ±.' : undefined}>
          <NumberInput value={form.balance} onChange={v => set('balance', v)} placeholder="250 000" suffix={form.currency} />
        </Field>
        <Field label="Interest rate (% p.a.)">
          <NumberInput value={form.interest_rate} onChange={v => set('interest_rate', v)} placeholder="4,5" suffix="%" />
        </Field>
        {(form.account_type === 'fixed_deposit' || form.account_type === 'savings') && (
          <Field label={form.account_type === 'fixed_deposit' ? 'Maturity date' : 'Rate fixed until (optional)'}
            hint={form.account_type === 'fixed_deposit' ? 'Money is counted as locked until then.' : undefined}>
            <input style={inputStyle} type="date" value={form.maturity_date} onChange={e => set('maturity_date', e.target.value)} />
          </Field>
        )}
        <Field label="Access (optional override)" hint="Leave on automatic unless the bank's notice period differs.">
          <select style={inputStyle} value={form.liquidity_tier} onChange={e => set('liquidity_tier', e.target.value)}>
            <option value="">Automatic</option>
            {LIQUIDITY_TIERS.map(t => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Notes (optional)" span="2"><input style={inputStyle} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
      </FormGrid>
      <FormActions onCancel={onClose} onSubmit={save} label={account ? 'Save changes' : 'Add account'} saving={saving} />
    </Modal>
  )
}
