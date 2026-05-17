'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAppData } from '@/hooks/useAppData'
import Sidebar from '@/components/Sidebar'
import { toCZK, fmtCZK, fmtDate } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'

const TYPE_LABELS: Record<string, string> = { residential: 'Residential', commercial: 'Commercial', land: 'Land', reit: 'REIT' }
const TYPE_COLORS: Record<string, string> = { residential: 'var(--teal)', commercial: 'var(--amber)', land: 'var(--green)', reit: 'var(--blue)' }

export default function RealEstatePage() {
  const { realEstate: properties, loading, reload } = useAppData()
  const [showAdd, setShowAdd] = useState(false)

  const totalValueCZK = properties.reduce((s, p) => s + toCZK(p.current_value * (p.ownership_pct / 100), p.currency, fx), 0)
  const totalPurchaseCZK = properties.reduce((s, p) => s + toCZK(p.purchase_price * (p.ownership_pct / 100), p.currency, fx), 0)
  const totalMortgageCZK = properties.reduce((s, p) => s + toCZK(p.mortgage_balance, p.currency, fx), 0)
  const totalEquityCZK = totalValueCZK - totalMortgageCZK
  const totalRentalCZK = properties.reduce((s, p) => s + toCZK(p.monthly_rent * 12 * (p.ownership_pct / 100), p.currency, fx), 0)
  const totalGainCZK = totalValueCZK - totalPurchaseCZK

  const saveProperty = async () => {
    if (!form.name || !form.purchase_price || !form.current_value) return
    setSaving(true)
    const payload = {
      name: form.name,
      property_type: form.property_type,
      address: form.address || null,
      purchase_price: parseFloat(form.purchase_price),
      current_value: parseFloat(form.current_value),
      currency: form.currency,
      purchase_date: form.purchase_date || null,
      monthly_rent: parseFloat(form.monthly_rent) || 0,
      mortgage_balance: parseFloat(form.mortgage_balance) || 0,
      mortgage_rate: parseFloat(form.mortgage_rate) / 100 || 0,
      monthly_mortgage: parseFloat(form.monthly_mortgage) || 0,
      ownership_pct: parseFloat(form.ownership_pct) || 100,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    }
    if (editId) {
      await supabase.from('real_estate').update(payload).eq('id', editId)
    } else {
      await supabase.from('real_estate').insert([payload])
    }
    setSaving(false)
    setShowAdd(false)
    setEditId(null)
    resetForm()
    reload()
  }

  const resetForm = () => setForm({ name: '', property_type: 'residential', address: '', purchase_price: '', current_value: '', currency: 'CZK', purchase_date: '', monthly_rent: '0', mortgage_balance: '0', mortgage_rate: '0', monthly_mortgage: '0', ownership_pct: '100', notes: '' })

  const startEdit = (p: RealEstate) => {
    setForm({
      name: p.name, property_type: p.property_type, address: p.address ?? '',
      purchase_price: String(p.purchase_price), current_value: String(p.current_value),
      currency: p.currency, purchase_date: p.purchase_date ?? '',
      monthly_rent: String(p.monthly_rent), mortgage_balance: String(p.mortgage_balance),
      mortgage_rate: String(p.mortgage_rate * 100), monthly_mortgage: String(p.monthly_mortgage),
      ownership_pct: String(p.ownership_pct), notes: p.notes ?? '',
    })
    setEditId(p.id)
    setShowAdd(true)
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
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '32px 40px', maxWidth: 1200 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 4, fontWeight: 600 }}>Real Estate</div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>Properties</h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refreshFx} style={btnSecondary}>{fxLoading ? '⟳' : '↻'} FX</button>
            <button onClick={() => { resetForm(); setEditId(null); setShowAdd(true) }} style={btnPrimary('var(--teal)', 'var(--teal-bd)', 'var(--teal-bg)')}>+ Add property</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Market value', value: fmtCZK(totalValueCZK), accent: 'var(--teal)', note: `${properties.length} properties` },
            { label: 'Net equity', value: fmtCZK(totalEquityCZK), accent: 'var(--green)', note: `${totalValueCZK > 0 ? ((totalEquityCZK / totalValueCZK) * 100).toFixed(0) : 0}% of value` },
            { label: 'Mortgage debt', value: fmtCZK(totalMortgageCZK), accent: 'var(--red)', note: 'Outstanding balance' },
            { label: 'Annual rental income', value: totalRentalCZK > 0 ? fmtCZK(totalRentalCZK) : '—', accent: 'var(--amber)', note: `${properties.filter(p => p.monthly_rent > 0).length} rentals` },
          ].map((m, i) => (
            <div key={i} style={{ ...cardStyle, borderTop: `2px solid ${m.accent}` }}>
              <div style={labelStyle}>{m.label}</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text4)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        {/* Property cards */}
        <div style={{ display: 'grid', gap: 14, marginBottom: 16 }}>
          {properties.map(p => {
            const valueCZK = toCZK(p.current_value * (p.ownership_pct / 100), p.currency, fx)
            const purchaseCZK = toCZK(p.purchase_price * (p.ownership_pct / 100), p.currency, fx)
            const mortgageCZK = toCZK(p.mortgage_balance, p.currency, fx)
            const equityCZK = valueCZK - mortgageCZK
            const gainCZK = valueCZK - purchaseCZK
            const gainPct = purchaseCZK > 0 ? (gainCZK / purchaseCZK) * 100 : 0
            const monthlyRentCZK = toCZK(p.monthly_rent, p.currency, fx)
            const ltvPct = valueCZK > 0 ? (mortgageCZK / valueCZK) * 100 : 0
            const yieldPct = valueCZK > 0 ? (p.monthly_rent * 12 / p.current_value) * 100 : 0
            const typeColor = TYPE_COLORS[p.property_type] ?? 'var(--teal)'

            return (
              <div key={p.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 26px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 17, fontWeight: 700 }}>{p.name}</span>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: typeColor + '18', color: typeColor, border: `1px solid ${typeColor}30` }}>
                        {TYPE_LABELS[p.property_type]}
                      </span>
                      {p.is_primary_residence && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--blue-bg)', color: 'var(--blue)', border: '1px solid var(--blue-bd)' }}>Primary</span>}
                    </div>
                    {p.address && <div style={{ fontSize: 11, color: 'var(--text4)' }}>{p.address}</div>}
                    {p.purchase_date && <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 2 }}>Purchased {fmtDate(p.purchase_date)}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => startEdit(p)} style={btnSecondary}>✎ Edit</button>
                    <button onClick={async () => { if (!confirm(`Delete "${p.name}"?`)) return; await supabase.from('real_estate').delete().eq('id', p.id); reload() }} style={{ ...btnSecondary, color: 'var(--red)' }}>✕</button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16 }}>
                  {[
                    { label: 'Market value', value: fmtCZK(valueCZK), sub: `${p.current_value.toLocaleString()} ${p.currency}`, color: 'var(--teal)' },
                    { label: 'Net equity', value: fmtCZK(equityCZK), sub: `${(100 - ltvPct).toFixed(0)}% owned`, color: 'var(--green)' },
                    { label: 'Capital gain', value: (gainCZK >= 0 ? '+' : '') + fmtCZK(gainCZK), sub: `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%`, color: gainCZK >= 0 ? 'var(--green)' : 'var(--red)' },
                    { label: 'Mortgage', value: mortgageCZK > 0 ? fmtCZK(mortgageCZK) : '—', sub: mortgageCZK > 0 ? `${(p.mortgage_rate * 100).toFixed(2)}% rate` : 'No mortgage', color: 'var(--red)' },
                    { label: 'Monthly rent', value: p.monthly_rent > 0 ? fmtCZK(monthlyRentCZK) : '—', sub: p.monthly_rent > 0 ? `Yield ${yieldPct.toFixed(1)}%` : 'Owner occupied', color: 'var(--amber)' },
                    { label: 'Ownership', value: `${p.ownership_pct}%`, sub: `${p.currency} asset`, color: 'var(--text2)' },
                  ].map((stat, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text4)', marginBottom: 4, fontWeight: 500 }}>{stat.label}</div>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 500, color: stat.color }}>{stat.value}</div>
                      <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 2 }}>{stat.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Equity bar */}
                {p.mortgage_balance > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--bg4)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${100 - ltvPct}%`, background: 'var(--teal)', opacity: 0.7, borderRadius: 2, transition: 'width 0.5s ease' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text4)' }}>
                      <span>Equity {(100 - ltvPct).toFixed(0)}%</span>
                      <span>LTV {ltvPct.toFixed(0)}%</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Add/Edit form */}
        {showAdd && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--teal-bd)', borderRadius: 14, padding: '26px 30px' }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
              {editId ? 'Edit property' : 'Add property'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: '1/-1' }}>
                <div style={inputLabel}>Property name</div>
                <input style={inputStyle} placeholder="e.g. Prague Flat – Žižkov" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              {[
                { label: 'Type', key: 'property_type', type: 'select', options: [['residential', 'Residential'], ['commercial', 'Commercial'], ['land', 'Land'], ['reit', 'REIT']] },
                { label: 'Currency', key: 'currency', type: 'select', options: [['CZK', 'CZK'], ['EUR', 'EUR'], ['USD', 'USD']] },
                { label: 'Purchase price', key: 'purchase_price', placeholder: '2800000', type: 'number' },
                { label: 'Current value', key: 'current_value', placeholder: '3400000', type: 'number' },
                { label: 'Monthly rent', key: 'monthly_rent', placeholder: '0', type: 'number' },
                { label: 'Mortgage balance', key: 'mortgage_balance', placeholder: '0', type: 'number' },
                { label: 'Mortgage rate (%)', key: 'mortgage_rate', placeholder: '0', type: 'number' },
                { label: 'Monthly mortgage', key: 'monthly_mortgage', placeholder: '0', type: 'number' },
                { label: 'Ownership (%)', key: 'ownership_pct', placeholder: '100', type: 'number' },
                { label: 'Purchase date', key: 'purchase_date', type: 'date' },
              ].map((f: any) => (
                <div key={f.key}>
                  <div style={inputLabel}>{f.label}</div>
                  {f.type === 'select' ? (
                    <select style={inputStyle} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}>
                      {f.options.map(([v, l]: string[]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  ) : (
                    <input style={inputStyle} type={f.type} placeholder={f.placeholder} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                  )}
                </div>
              ))}
              <div style={{ gridColumn: '1/-1' }}>
                <div style={inputLabel}>Address (optional)</div>
                <input style={inputStyle} placeholder="Brno-střed" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => { setShowAdd(false); setEditId(null); resetForm() }} style={btnSecondary}>Cancel</button>
              <button onClick={saveProperty} disabled={saving} style={btnPrimary('var(--teal)', 'var(--teal-bd)', 'var(--teal-bg)')}>
                {saving ? 'Saving…' : editId ? 'Save changes' : 'Add property'}
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
const btnSecondary: React.CSSProperties = { padding: '7px 14px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: "'Inter', sans-serif", fontSize: 12 }
const btnPrimary = (color: string, bd: string, bg: string): React.CSSProperties => ({ padding: '7px 16px', borderRadius: 6, cursor: 'pointer', background: bg, border: `1px solid ${bd}`, color, fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 500 })
const inputLabel: React.CSSProperties = { fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 5, fontWeight: 500 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter', sans-serif", fontSize: 13, outline: 'none', boxSizing: 'border-box' }
