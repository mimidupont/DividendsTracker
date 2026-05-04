'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, Holding } from '@/lib/supabase'
import type { DividendSummary } from '@/app/api/market/dividends/route'

interface ExDivEvent {
  symbol: string
  name: string
  exDate: string
  payDate: string
  amount: number
  currency: string
  daysUntil: number
}

export default function CalendarPage() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [events, setEvents]     = useState<ExDivEvent[]>([])
  const [loading, setLoading]   = useState(false)
  const [fetched, setFetched]   = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    supabase.from('holdings').select('*').eq('is_dividend_payer', true).order('symbol')
      .then(({ data }) => { if (data) setHoldings(data) })
  }, [])

  const fetchExDates = useCallback(async () => {
    if (holdings.length === 0) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/market/dividends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: holdings.map(h => h.symbol) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? `HTTP ${res.status}`)
      }

      const data = await res.json() as { summaries: Record<string, DividendSummary> }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const in90  = new Date(today.getTime() + 90  * 24 * 60 * 60 * 1000)
      const ago30 = new Date(today.getTime() - 30  * 24 * 60 * 60 * 1000)

      const results: ExDivEvent[] = []

      for (const h of holdings) {
        const s: DividendSummary = data.summaries[h.symbol]
        if (!s || s.error || !s.exDividendDate) continue

        const exDate = new Date(s.exDividendDate * 1000)
        exDate.setHours(0, 0, 0, 0)
        if (exDate < ago30 || exDate > in90) continue

        const daysUntil = Math.round((exDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

        // Per-payment amount: use lastDividendValue if available,
        // otherwise divide annual rate by estimated frequency
        const freq = s.payoutFrequency ?? 4
        const amount =
          s.lastDividendValue ??
          (s.trailingAnnualDividendRate ? s.trailingAnnualDividendRate / freq : null)
        if (!amount) continue

        // Estimate pay date: ~3 weeks after ex-date for US stocks
        const payDate = new Date(exDate.getTime() + 21 * 24 * 60 * 60 * 1000)

        results.push({
          symbol: h.symbol,
          name: h.name,
          exDate: exDate.toISOString().slice(0, 10),
          payDate: payDate.toISOString().slice(0, 10),
          amount,
          currency: h.currency,
          daysUntil,
        })
      }

      results.sort((a, b) => a.daysUntil - b.daysUntil)
      setEvents(results)
    } catch (e) {
      setError(`Could not fetch ex-dividend dates: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [holdings])

  useEffect(() => {
    if (holdings.length > 0 && !fetched) fetchExDates()
  }, [holdings, fetched, fetchExDates])

  const urgencyColor = (days: number) => {
    if (days < 0)   return 'var(--text4)'
    if (days <= 7)  return 'var(--red)'
    if (days <= 21) return 'var(--amber)'
    return 'var(--green)'
  }

  const urgencyBadge = (days: number) => {
    if (days < 0)   return <Badge variant="gray">passed</Badge>
    if (days === 0) return <Badge variant="red">TODAY</Badge>
    if (days <= 7)  return <Badge variant="red">in {days}d</Badge>
    if (days <= 21) return <Badge variant="amber">in {days}d</Badge>
    return <Badge variant="green">in {days}d</Badge>
  }

  const fmtD = (s: string) =>
    new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '28px 36px', maxWidth: 900 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, fontWeight: 400, letterSpacing: -0.5 }}>
              Ex-dividend calendar
            </h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
              Upcoming ex-dates for your {holdings.length} dividend-paying holdings · via Yahoo Finance
              {loading && <span style={{ color: 'var(--amber)', marginLeft: 8 }}>⟳ Fetching…</span>}
            </div>
          </div>
          <button
            onClick={() => { setFetched(false); setEvents([]) }}
            disabled={loading}
            style={{
              padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
              background: 'var(--bg2)', border: '1px solid var(--border2)',
              color: 'var(--text2)', fontSize: 12, opacity: loading ? 0.6 : 1,
            }}
          >↻ Refresh</button>
        </div>

        {error && (
          <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-bd)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12 }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>⟳ Fetching ex-dividend dates…</div>
            <div style={{ fontSize: 12 }}>Checking {holdings.length} tickers via Yahoo Finance</div>
          </div>
        )}

        {!loading && fetched && events.length === 0 && !error && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>
            No upcoming ex-dividend dates found in the next 90 days.
          </div>
        )}

        {!loading && events.length > 0 && (
          <>
            {events.filter(e => e.daysUntil >= 0 && e.daysUntil <= 14).length > 0 && (
              <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)', borderRadius: 10, padding: '14px 18px', marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--amber)', marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  ⚡ Action needed — ex-dates within 14 days
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {events.filter(e => e.daysUntil >= 0 && e.daysUntil <= 14).map(e => (
                    <div key={e.symbol} style={{ background: 'var(--bg2)', border: '1px solid var(--amber-bd)', borderRadius: 7, padding: '8px 14px', fontSize: 12 }}>
                      <strong>{e.symbol}</strong>
                      <span style={{ color: 'var(--text3)', marginLeft: 8 }}>ex {fmtD(e.exDate)}</span>
                      <span style={{ color: 'var(--amber)', marginLeft: 8 }}>{e.daysUntil === 0 ? 'TODAY' : `${e.daysUntil}d`}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg3)' }}>
                    {['Company', 'Ex-date', 'Est. pay date', 'Div / share', 'CCY', 'Time left'].map((h, i) => (
                      <th key={h} style={{
                        fontSize: 9, letterSpacing: '0.09em', textTransform: 'uppercase',
                        color: 'var(--text3)', padding: '9px 14px',
                        textAlign: i === 0 ? 'left' : 'right',
                        borderBottom: '1px solid var(--border)', fontWeight: 400,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map(e => (
                    <tr key={e.symbol}
                      onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg3)')}
                      onMouseLeave={ev => (ev.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 500 }}>{e.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{e.symbol}</div>
                      </td>
                      <td style={{ ...tdR, color: urgencyColor(e.daysUntil), fontWeight: e.daysUntil <= 7 ? 600 : 400 }}>{fmtD(e.exDate)}</td>
                      <td style={{ ...tdR, color: 'var(--text3)' }}>{fmtD(e.payDate)} <span style={{ fontSize: 10 }}>~est.</span></td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{e.amount.toFixed(4)}</td>
                      <td style={tdR}>
                        <Badge variant={e.currency === 'USD' ? 'gray' : e.currency === 'EUR' ? 'blue' : 'amber'}>{e.currency}</Badge>
                      </td>
                      <td style={tdR}>{urgencyBadge(e.daysUntil)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

const tdR: React.CSSProperties = {
  padding: '10px 14px', borderBottom: '1px solid var(--border)',
  textAlign: 'right', color: 'var(--text2)', fontSize: 12,
}
