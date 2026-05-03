'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import LogDividendModal from '@/components/LogDividendModal'
import { supabase, DividendReceived } from '@/lib/supabase'
import { toCZK, fmtCZK, fmtDate, DEFAULT_FX } from '@/lib/fx'

export default function ReceivedPage() {
  const [dividends, setDividends] = useState<DividendReceived[]>([])
  const [showModal, setShowModal] = useState(false)
  const fx = DEFAULT_FX

  const load = async () => {
    const { data } = await supabase.from('dividends_received').select('*').order('payment_date', { ascending: false })
    if (data) setDividends(data)
  }

  useEffect(() => { load() }, [])

  const totalGrossCZK = dividends.reduce((s, d) => s + toCZK(d.gross_amount, d.currency, fx), 0)
  const totalWHT_CZK  = dividends.reduce((s, d) => s + toCZK(d.withholding_tax, d.currency, fx), 0)
  const totalNetCZK   = totalGrossCZK - totalWHT_CZK

  const currentYear = new Date().getFullYear()
  const ytd = dividends.filter(d => new Date(d.payment_date).getFullYear() === currentYear)
  const ytdCZK = ytd.reduce((s, d) => s + toCZK(d.gross_amount, d.currency, fx), 0)

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      {showModal && <LogDividendModal onClose={() => setShowModal(false)} onSaved={load} />}
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 1060 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>
              Dividends received
            </h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{dividends.length} payments logged</div>
          </div>
          <button onClick={() => setShowModal(true)} style={{
            padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
            background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
            color: 'var(--green)', fontFamily: "'Geist', sans-serif", fontSize: 12, fontWeight: 500,
          }}>
            + Log dividend
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: `${currentYear} YTD gross`, value: fmtCZK(ytdCZK, 2), accent: 'var(--green)' },
            { label: 'All-time gross', value: fmtCZK(totalGrossCZK, 2), accent: 'var(--green)' },
            { label: 'Withholding tax', value: `−${fmtCZK(totalWHT_CZK, 2)}`, accent: 'var(--red)' },
            { label: 'All-time net', value: fmtCZK(totalNetCZK, 2), accent: 'var(--blue)' },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.8 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400 }}>{m.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                {['Symbol', 'Payment date', 'Shares', 'Per share', 'Gross (CZK)', 'WHT (CZK)', 'Net (CZK)', 'DRIP', 'CCY'].map((h, i) => (
                  <th key={h} style={{
                    fontSize: 9, letterSpacing: '0.09em', textTransform: 'uppercase',
                    color: 'var(--text3)', padding: '9px 13px',
                    textAlign: i < 2 ? 'left' : 'right',
                    borderBottom: '1px solid var(--border)', fontWeight: 400,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dividends.length === 0 && (
                <tr><td colSpan={9} style={{ padding: '24px', color: 'var(--text3)', textAlign: 'center' }}>No dividends logged yet.</td></tr>
              )}
              {dividends.map(d => (
                <tr key={d.id}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td style={{ padding: '9px 13px', borderBottom: '1px solid var(--border)', fontWeight: 500 }}>{d.symbol}</td>
                  <td style={{ padding: '9px 13px', borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>{fmtDate(d.payment_date)}</td>
                  <td style={tdR}>{d.shares_held}</td>
                  <td style={tdR}>{d.amount_per_share}</td>
                  <td style={{ ...tdR, color: 'var(--green)', fontFamily: "'DM Mono', monospace" }}>+{fmtCZK(toCZK(d.gross_amount, d.currency, fx), 2)}</td>
                  <td style={{ ...tdR, color: 'var(--red)', fontFamily: "'DM Mono', monospace" }}>−{fmtCZK(toCZK(d.withholding_tax, d.currency, fx), 2)}</td>
                  <td style={{ ...tdR, fontWeight: 500, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(toCZK(d.net_amount, d.currency, fx), 2)}</td>
                  <td style={tdR}>
                    {d.drip_shares_added ? (
                      <Badge variant="green">+{d.drip_shares_added.toFixed(4)} sh</Badge>
                    ) : <span style={{ color: 'var(--text4)' }}>—</span>}
                  </td>
                  <td style={tdR}>
                    <Badge variant={d.currency === 'USD' ? 'gray' : d.currency === 'EUR' ? 'blue' : 'amber'}>
                      {d.currency}
                    </Badge>
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

const tdR: React.CSSProperties = {
  padding: '9px 13px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'right',
  color: 'var(--text2)',
  fontSize: 12,
}
