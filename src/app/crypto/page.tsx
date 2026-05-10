'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import { supabase, CryptoHolding } from '@/lib/supabase'
import { toCZK, fmtCZK } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'

const emptyForm = {
  coin_id: '',
  symbol: '',
  name: '',
  amount: '',
  avg_cost_usd: '',
  wallet_label: '',
  staking_apy: '0',
}

export default function CryptoPage() {
  const [crypto, setCrypto] = useState<CryptoHolding[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const { fx, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const prices = useCryptoPrices()

  const load = useCallback(async () => {
    const { data } = await supabase.from('crypto_holdings').select('*').order('avg_cost_usd', { ascending: false })
    if (data) setCrypto(data)
    setLoading(false)
    return data ?? []
  }, [])

  useEffect(() => {
    load().then(c => { if (c.length > 0) prices.refresh(c.map(cc => cc.coin_id)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalValueCZK = crypto.reduce((s, c) =>
    s + toCZK(prices.getPrice(c.coin_id, c.avg_cost_usd) * c.amount, 'USD', fx), 0)
  const totalCostCZK = crypto.reduce((s, c) =>
    s + toCZK(c.avg_cost_usd * c.amount, 'USD', fx), 0)
  const totalPLCZK = totalValueCZK - totalCostCZK
  const annualStakingCZK = crypto.reduce((s, c) => {
    const price = prices.getPrice(c.coin_id, c.avg_cost_usd)
    return s + toCZK(price * c.amount * c.staking_apy, 'USD', fx)
  }, 0)

  const resetForm = () => {
    setForm(emptyForm)
    setEditId(null)
  }

  const startEdit = (c: CryptoHolding) => {
    setForm({
      coin_id: c.coin_id,
      symbol: c.symbol,
      name: c.name,
      amount: String(c.amount),
      avg_cost_usd: String(c.avg_cost_usd),
      wallet_label: c.wallet_label ?? '',
      staking_apy: String((c.staking_apy * 100).toFixed(2)),
    })
    setEditId(c.id)
    setShowAdd(true)
  }

  const saveCrypto = async () => {
    if (!form.coin_id || !form.amount || !form.avg_cost_usd) return
    setSaving(true)
    const payload = {
      coin_id: form.coin_id.toLowerCase(),
      symbol: form.symbol.toUpperCase(),
      name: form.name,
      amount: parseFloat(form.amount),
      avg_cost_usd: parseFloat(form.avg_cost_usd),
      wallet_label: form.wallet_label || null,
      staking_apy: parseFloat(form.staking_apy) / 100 || 0,
      updated_at: new Date().toISOString(),
    }

    if (editId) {
      await supabase.from('crypto_holdings').update(payload).eq('id', editId)
    } else {
      await supabase.from('crypto_holdings').insert([payload])
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
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--purple)', marginBottom: 4, fontWeight: 600 }}>Digital Assets</div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>Crypto Holdings</h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refreshFx} style={btnSecondary}>{fxLoading ? '⟳' : '↻'} FX {fxTs && <span style={{ color: 'var(--green)', marginLeft: 4 }}>{fxTs}</span>}</button>
            <button onClick={() => prices.refresh(crypto.map(c => c.coin_id))} disabled={prices.state === 'loading'} style={btnSecondary}>
              {prices.state === 'loading' ? '⟳ Fetching…' : '↻ Prices'}
              {prices.state === 'done' && <span style={{ color: 'var(--purple)', marginLeft: 6 }}>✓</span>}
            </button>
            <button
              onClick={() => { resetForm(); setShowAdd(true) }}
              style={btnPrimary('var(--purple)', 'var(--purple-bd)', 'var(--purple-bg)')}
            >
              + Add holding
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Portfolio value', value: fmtCZK(totalValueCZK), accent: 'var(--purple)', note: `${crypto.length} assets` },
            { label: 'Unrealized P&L', value: (totalPLCZK >= 0 ? '+' : '') + fmtCZK(totalPLCZK), accent: totalPLCZK >= 0 ? 'var(--green)' : 'var(--red)', note: `${totalCostCZK > 0 ? ((totalPLCZK / totalCostCZK) * 100).toFixed(1) : 0}% on cost` },
            { label: 'Annual staking', value: annualStakingCZK > 0 ? fmtCZK(annualStakingCZK) : '—', accent: 'var(--amber)', note: 'Passive yield' },
            { label: 'Cost basis', value: fmtCZK(totalCostCZK), accent: 'var(--text3)', note: 'Total invested' },
          ].map((m, i) => (
            <div key={i} style={{ ...cardStyle, borderTop: `2px solid ${m.accent}` }}>
              <div style={labelStyle}>{m.label}</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4, color: m.accent === 'var(--purple)' ? 'var(--text)' : m.accent }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text4)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          <div style={tableHeader}><span style={tableHeaderLabel}>Holdings</span></div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Asset', 'Amount', 'Avg cost', 'Price', 'Value (CZK)', 'P&L', 'Staking APY', 'Wallet', ''].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i <= 1 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {crypto.map(c => {
                const price = prices.getPrice(c.coin_id, c.avg_cost_usd)
                const valueCZK = toCZK(price * c.amount, 'USD', fx)
                const costCZK = toCZK(c.avg_cost_usd * c.amount, 'USD', fx)
                const plCZK = valueCZK - costCZK
                const plPct = costCZK > 0 ? (plCZK / costCZK) * 100 : 0
                const chgPct = prices.getChange(c.coin_id)

                return (
                  <tr key={c.id} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')} onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <td style={tdL}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--purple)', fontFamily: "'DM Mono', monospace" }}>{c.symbol}</div>
                    </td>
                    <td style={tdL}>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{c.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>${c.avg_cost_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={tdR}>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {prices.state === 'loading' ? '…' : `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </div>
                      {chgPct !== null && (
                        <div style={{ fontSize: 10, color: chgPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontWeight: 500 }}>{fmtCZK(valueCZK)}</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: plCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {plCZK >= 0 ? '+' : ''}{fmtCZK(plCZK)}
                      <div style={{ fontSize: 10, opacity: 0.7 }}>{plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%</div>
                    </td>
                    <td style={{ ...tdR, color: c.staking_apy > 0 ? 'var(--amber)' : 'var(--text4)', fontFamily: "'DM Mono', monospace" }}>
                      {c.staking_apy > 0 ? `${(c.staking_apy * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ ...tdR, fontSize: 11 }}>
                      {c.wallet_label ? (
                        <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg4)', color: 'var(--text3)', border: '1px solid var(--border)' }}>
                          {c.wallet_label}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      {/* Edit button — was missing */}
                      <button
                        title="Edit holding"
                        onClick={() => startEdit(c)}
                        style={actionBtn}
                      >✎</button>
                      <button
                        title="Delete holding"
                        onClick={async () => {
                          if (!confirm(`Delete ${c.name}?`)) return
                          await supabase.from('crypto_holdings').delete().eq('id', c.id)
                          load()
                        }}
                        style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}
                      >✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Add / Edit form */}
        {showAdd && (
          <div style={{ background: 'var(--bg2)', border: `1px solid var(--purple-bd)`, borderRadius: 12, padding: '24px 28px' }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 600, marginBottom: 18 }}>
              {editId ? 'Edit holding' : 'Add crypto holding'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {/* CoinGecko ID — read-only when editing to avoid breaking price lookups */}
              <div style={{ gridColumn: '1/-1' }}>
                <div style={inputLabel}>
                  CoinGecko ID
                  {editId && <span style={{ color: 'var(--text4)', marginLeft: 6, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(locked — delete & re-add to change)</span>}
                </div>
                <input
                  style={{ ...inputStyle, opacity: editId ? 0.5 : 1, cursor: editId ? 'not-allowed' : 'text' }}
                  placeholder="bitcoin"
                  value={form.coin_id}
                  readOnly={!!editId}
                  onChange={e => !editId && setForm(p => ({ ...p, coin_id: e.target.value }))}
                />
                {!editId && <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 3 }}>From coingecko.com/coins/list</div>}
              </div>

              {[
                { label: 'Symbol', key: 'symbol', placeholder: 'BTC' },
                { label: 'Name', key: 'name', placeholder: 'Bitcoin' },
                { label: 'Amount held', key: 'amount', placeholder: '0.5', type: 'number' },
                { label: 'Avg cost (USD)', key: 'avg_cost_usd', placeholder: '45000', type: 'number' },
                { label: 'Staking APY (%)', key: 'staking_apy', placeholder: '0', type: 'number' },
                { label: 'Wallet / Exchange', key: 'wallet_label', placeholder: 'Ledger, Binance…' },
              ].map((f: any) => (
                <div key={f.key}>
                  <div style={inputLabel}>{f.label}</div>
                  <input
                    style={inputStyle}
                    type={f.type ?? 'text'}
                    placeholder={f.placeholder}
                    value={(form as any)[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => { setShowAdd(false); resetForm() }} style={btnSecondary}>Cancel</button>
              <button
                onClick={saveCrypto}
                disabled={saving}
                style={btnPrimary('var(--purple)', 'var(--purple-bd)', 'var(--purple-bg)')}
              >
                {saving ? 'Saving…' : editId ? 'Save changes' : 'Add holding'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

const cardStyle: React.CSSProperties = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }
const labelStyle: React.CSSProperties = { fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8, fontWeight: 500 }
const tableHeader: React.CSSProperties = { padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
const tableHeaderLabel: React.CSSProperties = { fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600 }
const th: React.CSSProperties = { fontSize: 9, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text4)', padding: '8px 14px', borderBottom: '1px solid var(--border)', fontWeight: 400 }
const tdL: React.CSSProperties = { padding: '9px 14px', borderBottom: '1px solid var(--border)' }
const tdR: React.CSSProperties = { padding: '9px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)', fontSize: 12 }
const actionBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border2)', borderRadius: 4, cursor: 'pointer',
  color: 'var(--text3)', fontSize: 12, width: 24, height: 24,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
}
const btnSecondary: React.CSSProperties = { padding: '7px 14px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: "'Inter', sans-serif", fontSize: 12 }
const btnPrimary = (color: string, bd: string, bg: string): React.CSSProperties => ({ padding: '7px 16px', borderRadius: 6, cursor: 'pointer', background: bg, border: `1px solid ${bd}`, color, fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 500 })
const inputLabel: React.CSSProperties = { fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 5, fontWeight: 500 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter', sans-serif", fontSize: 13, outline: 'none', boxSizing: 'border-box' }
