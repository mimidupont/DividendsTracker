'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import { supabase, BankAccount, BankInterestReceived } from '@/lib/supabase'
import { toCZK, fmtCZK, fmtDate } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: 'Savings',
  checking: 'Checking',
  money_market: 'Money Market',
  fixed_deposit: 'Term Deposit',
}

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  savings: 'var(--blue)',
  checking: 'var(--text3)',
  money_market: 'var(--green)',
  fixed_deposit: 'var(--amber)',
}

const emptyForm = {
  name: '',
  institution: '',
  account_type: 'savings',
  balance: '',
  currency: 'CZK',
  interest_rate: '',
  notes: '',
}

export default function CashPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [interest, setInterest] = useState<BankInterestReceived[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const { fx, fxLoading, fxTs, refresh: refreshFx } = useFx()

  const load = useCallback(async () => {
    const [a, i] = await Promise.all([
      supabase.from('bank_accounts').select('*').eq('is_active', true).order('balance', { ascending: false }),
      supabase.from('bank_interest_received').select('*').order('payment_date', { ascending: false }).limit(20),
    ])
    if (a.data) setAccounts(a.data)
    if (i.data) setInterest(i.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const totalCZK = accounts.reduce((s, a) => s + toCZK(a.balance, a.currency, fx), 0)
  const annualInterestCZK = accounts.reduce((s, a) => s + toCZK(a.balance * a.interest_rate, a.currency, fx), 0)
  const avgRate = accounts.length > 0 ? accounts.reduce((s, a) => s + a.interest_rate, 0) / accounts.length : 0

  const resetForm = () => { setForm(emptyForm); setEditId(null) }

  const startEdit = (a: BankAccount) => {
    setForm({
      name: a.name,
      institution: a.institution,
      account_type: a.account_type,
      balance: String(a.balance),
      currency: a.currency,
      interest_rate: String((a.interest_rate * 100).toFixed(2)),
      notes: a.notes ?? '',
    })
    setEditId(a.id)
    setShowAdd(true)
  }

  const saveAccount = async () => {
    if (!form.name || !form.institution || !form.balance) return
    setSaving(true)
    const payload = {
      name: form.name,
      institution: form.institution,
      account_type: form.account_type,
      balance: parseFloat(form.balance),
      currency: form.currency,
      interest_rate: parseFloat(form.interest_rate) / 100 || 0,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    }
    if (editId) {
      await supabase.from('bank_accounts').update(payload).eq('id', editId)
    } else {
      await supabase.from('bank_accounts').insert([payload])
    }
    setSaving(false)
    setShowAdd(false)
    resetForm()
    load()
  }

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>Loading…</main>
    </div>
  )

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '32px 40px', maxWidth: 1100 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 4, fontWeight: 600 }}>Cash & Savings</div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>Bank Accounts</h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refreshFx} disabled={fxLoading} style={btnSecondary}>{fxLoading ? '⟳' : '↻'} FX {fxTs && <span style={{ color: 'var(--green)', marginLeft: 4 }}>{fxTs}</span>}</button>
            <button onClick={() => { resetForm(); setShowAdd(true) }} style={btnPrimary('var(--blue)', 'var(--blue-bd)', 'var(--blue-bg)')}>+ Add account</button>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total cash', value: fmtCZK(totalCZK), accent: 'var(--blue)', note: `${accounts.length} accounts` },
            { label: 'Annual interest', value: fmtCZK(annualInterestCZK), accent: 'var(--amber)', note: `Avg rate ${(avgRate * 100).toFixed(2)}%` },
            { label: 'Monthly interest', value: fmtCZK(annualInterestCZK / 12, 0), accent: 'var(--green)', note: 'Est. passive income' },
          ].map((m, i) => (
            <div key={i} style={{ ...cardStyle, borderTop: `2px solid ${m.accent}` }}>
              <div style={labelStyle}>{m.label}</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text4)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        {/* Accounts list */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          <div style={tableHeader}>
            <span style={tableHeaderLabel}>Account overview</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Account', 'Type', 'Balance', 'Rate', 'Est. annual interest', 'CCY', ''].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i <= 1 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => {
                const balCZK = toCZK(a.balance, a.currency, fx)
                const annualCZK = toCZK(a.balance * a.interest_rate, a.currency, fx)
                const typeColor = ACCOUNT_TYPE_COLORS[a.account_type] ?? 'var(--text3)'
                return (
                  <tr key={a.id} style={trStyle} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={tdL}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{a.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text4)' }}>{a.institution}</div>
                    </td>
                    <td style={tdL}>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: typeColor + '18', color: typeColor, border: `1px solid ${typeColor}30` }}>
                        {ACCOUNT_TYPE_LABELS[a.account_type]}
                      </span>
                    </td>
                    <td style={tdR}>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13 }}>{a.balance.toLocaleString('cs-CZ')}</div>
                      <div style={{ fontSize: 10, color: 'var(--text4)' }}>{fmtCZK(balCZK)}</div>
                    </td>
                    <td style={{ ...tdR, color: a.interest_rate > 0.04 ? 'var(--green)' : a.interest_rate > 0.02 ? 'var(--amber)' : 'var(--text3)', fontFamily: "'DM Mono', monospace" }}>
                      {(a.interest_rate * 100).toFixed(2)}%
                    </td>
                    <td style={{ ...tdR, color: 'var(--amber)', fontFamily: "'DM Mono', monospace" }}>
                      {annualCZK > 0 ? `~${fmtCZK(annualCZK)}` : '—'}
                    </td>
                    <td style={tdR}>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--bg4)', color: 'var(--text3)', border: '1px solid var(--border)' }}>
                        {a.currency}
                      </span>
                    </td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      <button
                        title="Edit account"
                        onClick={() => startEdit(a)}
                        style={actionBtn}
                      >✎</button>
                      <button
                        title="Delete account"
                        onClick={async () => {
                          if (!confirm(`Delete "${a.name}"?`)) return
                          await supabase.from('bank_accounts').update({ is_active: false }).eq('id', a.id)
                          load()
                        }}
                        style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}
                      >✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg3)' }}>
                <td colSpan={2} style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, borderTop: '1px solid var(--border)' }}>Total</td>
                <td style={{ ...tdR, borderTop: '1px solid var(--border)', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>{fmtCZK(totalCZK)}</td>
                <td style={{ ...tdR, borderTop: '1px solid var(--border)', fontFamily: "'DM Mono', monospace" }}>{(avgRate * 100).toFixed(2)}%</td>
                <td style={{ ...tdR, borderTop: '1px solid var(--border)', fontFamily: "'DM Mono', monospace", color: 'var(--amber)', fontWeight: 600 }}>~{fmtCZK(annualInterestCZK)}</td>
                <td colSpan={2} style={{ borderTop: '1px solid var(--border)' }} />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Add / Edit form */}
        {showAdd && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--blue-bd)', borderRadius: 12, padding: '24px 28px', marginBottom: 16 }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 600, marginBottom: 18 }}>
              {editId ? 'Edit account' : 'Add bank account'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[
                { label: 'Account name', key: 'name', placeholder: 'e.g. Spořicí účet' },
                { label: 'Institution', key: 'institution', placeholder: 'e.g. Raiffeisen Bank' },
              ].map(f => (
                <div key={f.key}>
                  <div style={inputLabel}>{f.label}</div>
                  <input style={inputStyle} placeholder={f.placeholder} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                </div>
              ))}
              <div>
                <div style={inputLabel}>Account type</div>
                <select style={inputStyle} value={form.account_type} onChange={e => setForm(p => ({ ...p, account_type: e.target.value }))}>
                  <option value="savings">Savings</option>
                  <option value="checking">Checking</option>
                  <option value="money_market">Money Market</option>
                  <option value="fixed_deposit">Term Deposit</option>
                </select>
              </div>
              <div>
                <div style={inputLabel}>Currency</div>
                <select style={inputStyle} value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
                  <option>CZK</option><option>EUR</option><option>USD</option><option>GBP</option>
                </select>
              </div>
              <div>
                <div style={inputLabel}>Balance</div>
                <input style={inputStyle} type="number" placeholder="250000" value={form.balance} onChange={e => setForm(p => ({ ...p, balance: e.target.value }))} />
              </div>
              <div>
                <div style={inputLabel}>Interest rate (%)</div>
                <input style={inputStyle} type="number" step="0.1" placeholder="4.5" value={form.interest_rate} onChange={e => setForm(p => ({ ...p, interest_rate: e.target.value }))} />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <div style={inputLabel}>Notes (optional)</div>
                <input style={inputStyle} placeholder="e.g. Fixed until Dec 2025" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => { setShowAdd(false); resetForm() }} style={btnSecondary}>Cancel</button>
              <button onClick={saveAccount} disabled={saving} style={btnPrimary('var(--blue)', 'var(--blue-bd)', 'var(--blue-bg)')}>
                {saving ? 'Saving…' : editId ? 'Save changes' : 'Add account'}
              </button>
            </div>
          </div>
        )}

        {/* Interest received log */}
        {interest.length > 0 && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={tableHeader}><span style={tableHeaderLabel}>Interest received</span></div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Account', 'Date', 'Gross', 'Tax', 'Net'].map((h, i) => (
                    <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {interest.map(i => {
                  const acct = accounts.find(a => a.id === i.account_id)
                  return (
                    <tr key={i.id} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={tdL}>{acct?.name ?? '—'}</td>
                      <td style={tdR}>{fmtDate(i.payment_date)}</td>
                      <td style={{ ...tdR, color: 'var(--green)', fontFamily: "'DM Mono', monospace" }}>+{i.gross_amount.toFixed(2)} {i.currency}</td>
                      <td style={{ ...tdR, color: 'var(--red)', fontFamily: "'DM Mono', monospace" }}>−{i.tax_withheld.toFixed(2)}</td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontWeight: 500 }}>{i.net_amount.toFixed(2)} {i.currency}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 12, padding: '18px 20px',
}
const labelStyle: React.CSSProperties = {
  fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
  color: 'var(--text3)', marginBottom: 8, fontWeight: 500,
}
const tableHeader: React.CSSProperties = {
  padding: '12px 18px', borderBottom: '1px solid var(--border)',
  background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
}
const tableHeaderLabel: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600,
}
const th: React.CSSProperties = {
  fontSize: 9, letterSpacing: '0.09em', textTransform: 'uppercase',
  color: 'var(--text4)', padding: '8px 14px', borderBottom: '1px solid var(--border)', fontWeight: 400,
}
const tdL: React.CSSProperties = { padding: '9px 14px', borderBottom: '1px solid var(--border)' }
const tdR: React.CSSProperties = { padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)', fontSize: 12 }
const trStyle: React.CSSProperties = { transition: 'background 0.1s' }
const actionBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border2)', borderRadius: 4, cursor: 'pointer',
  color: 'var(--text3)', fontSize: 12, width: 24, height: 24,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
}
const btnSecondary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg3)', border: '1px solid var(--border2)',
  color: 'var(--text2)', fontFamily: "'Inter', sans-serif", fontSize: 12,
}
const btnPrimary = (color: string, bd: string, bg: string): React.CSSProperties => ({
  padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
  background: bg, border: `1px solid ${bd}`, color,
  fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 500,
})
const inputLabel: React.CSSProperties = {
  fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em',
  textTransform: 'uppercase', display: 'block', marginBottom: 5, fontWeight: 500,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: '1px solid var(--border2)', background: 'var(--bg)',
  color: 'var(--text)', fontFamily: "'Inter', sans-serif", fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
