'use client'
import { useEffect, useState, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import Badge from '@/components/Badge'
import { supabase, Holding } from '@/lib/supabase'

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
  const [events, setEvents] = useState<ExDivEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('holdings').select('*').eq('is_dividend_payer', true).order('symbol')
      .then(({ data }) => { if (data) setHoldings(data) })
  }, [])

  const fetchExDates = useCallback(async () => {
    if (holdings.length === 0) return
    setLoading(true)
    setError('')
    const symbols = holdings.map(h => h.symbol).join(', ')

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{
            role: 'user',
            content: `Search for upcoming ex-dividend dates and next dividend payment details for these tickers: ${symbols}.
For each ticker that has an upcoming ex-dividend date (within the next 90 days), return a JSON array:
[{"symbol":"KO","exDate":"2026-06-13","payDate":"2026-07-01","amount":0.53,"currency":"USD"},...]
Return ONLY valid JSON array. No markdown. If none found for a ticker, skip it.`,
          }],
        }),
      })
      const data = await res.json()
      const textBlock = [...data.content].reverse().find((b: { type: string }) => b.type === 'text')
      if (!textBlock?.text) throw new Error('No response')

      const clean = textBlock.text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean) as Array<{
        symbol: string; exDate: string; payDate: string; amount: number; currency: string
      }>

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const enriched: ExDivEvent[] = parsed.map(e => {
        const holding = holdings.find(h => h.symbol === e.symbol)
        const exDateObj = new Date(e.exDate)
        const daysUntil = Math.round((exDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        return {
          ...e,
          name: holding?.name ?? e.symbol,
          daysUntil,
        }
      }).sort((a, b) => a.daysUntil - b.daysUntil)

      setEvents(enriched)
    } catch (e) {
      console.error(e)
      setError('Could not fetch ex-dividend dates. Please try again.')
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [holdings])

  useEffect(() => {
    if (holdings.length > 0 && !fetched) fetchExDates()
  }, [holdings, fetched, fetchExDates])

  const urgencyColor = (days: number) => {
    if (days < 0)  return 'var(--text4)'
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

  const fmtD = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

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
              Upcoming ex-dates for your {holdings.length} dividend-paying holdings
              {loading && <span style={{ color: 'var(--amber)', marginLeft: 8 }}>⟳ Searching…</span>}
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
          >
            ↻ Refresh
          </button>
        </div>

        {error && (
          <div style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-bd)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12 }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>⟳ Fetching ex-dividend dates…</div>
            <div style={{ fontSize: 12 }}>Using Claude + web search to find upcoming dates for {holdings.length} tickers</div>
          </div>
        )}

        {!loading && fetched && events.length === 0 && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>
            No upcoming ex-dividend dates found in the next 90 days.
          </div>
        )}

        {!loading && events.length > 0 && (
          <>
            {/* Urgent strip */}
            {events.filter(e => e.daysUntil >= 0 && e.daysUntil <= 14).length > 0 && (
              <div style={{
                background: 'var(--amber-bg)',
                border: '1px solid var(--amber-bd)',
                borderRadius: 10,
                padding: '14px 18px',
                marginBottom: 14,
              }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--amber)', marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  ⚡ Action needed — ex-dates within 14 days
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {events.filter(e => e.daysUntil >= 0 && e.daysUntil <= 14).map(e => (
                    <div key={e.symbol} style={{
                      background: 'var(--bg2)', border: '1px solid var(--amber-bd)',
                      borderRadius: 7, padding: '8px 14px', fontSize: 12,
                    }}>
                      <strong>{e.symbol}</strong>
                      <span style={{ color: 'var(--text3)', marginLeft: 8 }}>ex {fmtD(e.exDate)}</span>
                      <span style={{ color: 'var(--amber)', marginLeft: 8 }}>{e.daysUntil === 0 ? 'TODAY' : `${e.daysUntil}d`}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Full table */}
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg3)' }}>
                    {['Company', 'Ex-date', 'Pay date', 'Amount / share', 'CCY', 'Time left'].map((h, i) => (
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
                      <td style={{ ...tdR, color: urgencyColor(e.daysUntil), fontWeight: e.daysUntil <= 7 ? 600 : 400 }}>
                        {fmtD(e.exDate)}
                      </td>
                      <td style={tdR}>{fmtD(e.payDate)}</td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {e.amount.toFixed(4)}
                      </td>
                      <td style={tdR}>
                        <Badge variant={e.currency === 'USD' ? 'gray' : e.currency === 'EUR' ? 'blue' : 'amber'}>
                          {e.currency}
                        </Badge>
                      </td>
                      <td style={{ ...tdR }}>
                        {urgencyBadge(e.daysUntil)}
                      </td>
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
  padding: '10px 14px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'right',
  color: 'var(--text2)',
  fontSize: 12,
}
