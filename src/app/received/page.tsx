'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import LogDividendModal from '@/components/LogDividendModal'
import { supabase, DividendReceived } from '@/lib/supabase'

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const FX: Record<string, number> = { USD: 1, EUR: 1.09, CZK: 0.04667 }

export default function ReceivedPage() {
  const [dividends, setDividends] = useState<DividendReceived[]>([])
  const [showModal, setShowModal] = useState(false)

  const load = async () => {
    const { data } = await supabase.from('dividends_received').select('*').order('payment_date', { ascending: false })
    if (data) setDividends(data)
  }

  useEffect(() => { load() }, [])

  const totalGrossUSD = dividends.reduce((s, d) => s + d.gross_amount * (FX[d.currency] ?? 1), 0)
  const totalWHT = dividends.reduce((s, d) => s + d.withholding_tax * (FX[d.currency] ?? 1), 0)
  const totalNetUSD = totalGrossUSD - totalWHT

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      {showModal && <LogDividendModal onClose={() => setShowModal(false)} onSaved={load} />}
      <main style={{ marginLeft: 220, flex: 1, padding: '32px 36px', maxWidth: 1000 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 300, letterSpacing: -0.5 }}>Dividends received</div>
          <button onClick={() => setShowModal(true)} style={{ padding: '8px 16px', borderRadius: 6, cursor: 'pointer', background: 'var(--green-bg)', border: '1px solid var(--green-bd)', color: 'var(--green)', fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
            + Log dividend
          </button>
        </div>

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'YTD gross', value: `$${totalGrossUSD.toFixed(2)}` },
            { label: 'Withholding tax', value: `-$${totalWHT.toFixed(2)}`, red: true },
            { label: 'YTD net received', value: `$${totalNetUSD.toFixed(2)}`, green: true },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 400, color: m.green ? 'var(--green)' : m.red ? 'var(--red)' : 'var(--text)' }}>{m.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Symbol', 'Payment date', 'Shares', 'Per share', 'Gross', 'WHT', 'Net', 'CCY'].map((h, i) => (
                  <th key={h} style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', padding: '10px 14px', textAlign: i < 2 ? 'left' : 'right', borderBottom: '1px solid var(--border)', fontWeight: 400, background: 'var(--bg3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dividends.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '24px 14px', color: 'var(--text3)', textAlign: 'center' }}>No dividends logged yet.</td></tr>
              )}
              {dividends.map(d => (
                <tr key={d.id}>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500, color: 'var(--text)' }}>{d.symbol}</td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>{fmtDate(d.payment_date)}</td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{d.shares_held}</td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)' }}>{d.amount_per_share}</td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--green)' }}>+{d.gross_amount.toFixed(2)}</td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--red)' }}>−{d.withholding_tax.toFixed(2)}</td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontWeight: 500, color: 'var(--text)' }}>{d.net_amount.toFixed(2)}</td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                    <Badge variant={d.currency === 'USD' ? 'gray' : d.currency === 'EUR' ? 'blue' : 'amber'}>{d.currency}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
