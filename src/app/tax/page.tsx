'use client'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, DividendReceived } from '@/lib/supabase'
import { toCZK, fmtCZK, fmtDate, DEFAULT_FX } from '@/lib/fx'

// Czech WHT treaty rates by country of stock exchange/company
const WHT_RATES: Record<string, { rate: number; country: string }> = {
  USD: { rate: 0.15, country: 'United States' },
  EUR: { rate: 0.15, country: 'EU (varies)' },
  CZK: { rate: 0.15, country: 'Czech Republic' },
  GBP: { rate: 0.00, country: 'United Kingdom' },
}

export default function TaxPage() {
  const [dividends, setDividends] = useState<DividendReceived[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const fx = DEFAULT_FX

  useEffect(() => {
    supabase.from('dividends_received').select('*').order('payment_date', { ascending: false })
      .then(({ data }) => { if (data) setDividends(data) })
  }, [])

  const years = Array.from(new Set(dividends.map(d => new Date(d.payment_date).getFullYear()))).sort((a, b) => b - a)
  const filtered = dividends.filter(d => new Date(d.payment_date).getFullYear() === year)

  // Group by currency
  const byCcy: Record<string, DividendReceived[]> = {}
  filtered.forEach(d => {
    if (!byCcy[d.currency]) byCcy[d.currency] = []
    byCcy[d.currency].push(d)
  })

  const totalGrossCZK = filtered.reduce((s, d) => s + toCZK(d.gross_amount, d.currency, fx), 0)
  const totalWHTCZK   = filtered.reduce((s, d) => s + toCZK(d.withholding_tax, d.currency, fx), 0)
  const totalNetCZK   = totalGrossCZK - totalWHTCZK

  // Czech tax: 15% on gross, minus WHT already paid (can credit up to Czech rate)
  const czechTaxDue = Math.max(0, totalGrossCZK * 0.15 - totalWHTCZK)

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 960 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>
              Tax summary
            </h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
              For Czech daňové přiznání (tax return) · Dividend income
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {years.map(y => (
              <button key={y} onClick={() => setYear(y)} style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                background: year === y ? 'var(--green-bg)' : 'var(--bg2)',
                border: `1px solid ${year === y ? 'var(--green-bd)' : 'var(--border2)'}`,
                color: year === y ? 'var(--green)' : 'var(--text2)',
              }}>
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Gross dividends', value: fmtCZK(totalGrossCZK, 2), accent: 'var(--green)', note: 'Report on § 8 income' },
            { label: 'WHT paid abroad', value: `−${fmtCZK(totalWHTCZK, 2)}`, accent: 'var(--amber)', note: 'Creditable against Czech tax' },
            { label: 'Net received', value: fmtCZK(totalNetCZK, 2), accent: 'var(--blue)', note: 'After withholding tax' },
            { label: 'Est. Czech tax due', value: fmtCZK(czechTaxDue, 2), accent: czechTaxDue > 0 ? 'var(--red)' : 'var(--green)', note: '15% gross minus WHT credit' },
          ].map((m, i) => (
            <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: m.accent, opacity: 0.8 }} />
              <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, fontWeight: 400, marginBottom: 4 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        {/* Notice */}
        <div style={{
          background: 'var(--blue-bg)', border: '1px solid var(--blue-bd)', borderRadius: 8,
          padding: '10px 14px', marginBottom: 18, fontSize: 12, color: 'var(--blue)',
        }}>
          ⓘ <strong>Czech tax note:</strong> Foreign dividends are taxed at 15% (§ 8 ZDP). WHT paid abroad is creditable up to the Czech rate.
          Always verify with a tax advisor — this is an estimate only.
        </div>

        {/* By currency breakdown */}
        {Object.entries(byCcy).map(([ccy, items]) => {
          const grossCZK = items.reduce((s, d) => s + toCZK(d.gross_amount, d.currency, fx), 0)
          const whtCZK   = items.reduce((s, d) => s + toCZK(d.withholding_tax, d.currency, fx), 0)
          const info = WHT_RATES[ccy]

          return (
            <div key={ccy} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ padding: '11px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge variant={ccy === 'USD' ? 'gray' : ccy === 'EUR' ? 'blue' : 'amber'}>{ccy}</Badge>
                  {info && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{info.country} · WHT {(info.rate * 100).toFixed(0)}%</span>}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  <span>Gross: <strong style={{ color: 'var(--green)' }}>{fmtCZK(grossCZK, 2)}</strong></span>
                  <span>WHT: <strong style={{ color: 'var(--red)' }}>−{fmtCZK(whtCZK, 2)}</strong></span>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Symbol', 'Payment date', 'Gross', 'WHT', 'Net (CZK)', 'Notes'].map((h, i) => (
                      <th key={h} style={{
                        fontSize: 9, letterSpacing: '0.09em', textTransform: 'uppercase',
                        color: 'var(--text3)', padding: '7px 14px',
                        textAlign: i === 0 ? 'left' : i === 5 ? 'left' : 'right',
                        borderBottom: '1px solid var(--border)', fontWeight: 400,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(d => (
                    <tr key={d.id}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontWeight: 500 }}>{d.symbol}</td>
                      <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text2)', fontSize: 12 }}>{fmtDate(d.payment_date)}</td>
                      <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--green)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {d.gross_amount.toFixed(2)} {d.currency}
                      </td>
                      <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--red)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        −{d.withholding_tax.toFixed(2)} {d.currency}
                      </td>
                      <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {fmtCZK(toCZK(d.net_amount, d.currency, fx), 2)}
                      </td>
                      <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text3)', fontSize: 11 }}>
                        {d.notes ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>
            No dividend income recorded for {year}.
          </div>
        )}

      </main>
    </div>
  )
}
