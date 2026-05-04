'use client'
import { useState } from 'react'
import { supabase, Holding } from '@/lib/supabase'
import Modal from './Modal'
import type { DividendSummary } from '@/app/api/market/dividends/route'

interface DripEvent {
  symbol: string
  name: string
  exDate: string
  payDate: string
  amount: number       // per share
  currency: string
  sharesHeld: number
  grossAmount: number
  reinvestPrice: number
  reinvestShares: number
  alreadyLogged: boolean
}

export default function DripCheckModal({
  holdings,
  onClose,
  onSaved,
}: {
  holdings: Holding[]
  onClose: () => void
  onSaved: () => void
}) {
  const [loading, setLoading]   = useState(false)
  const [events, setEvents]     = useState<DripEvent[]>([])
  const [checked, setChecked]   = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [done, setDone]         = useState<string[]>([])
  const [error, setError]       = useState('')

  const divPayers = holdings.filter(h => h.is_dividend_payer)

  const checkDividends = async () => {
    setLoading(true)
    setError('')

    try {
      // Fetch dividend summaries from Yahoo Finance
      const res = await fetch('/api/market/dividends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: divPayers.map(h => h.symbol) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? `HTTP ${res.status}`)
      }

      const data = await res.json() as { summaries: Record<string, DividendSummary> }

      // Check which payments are already logged in DB
      const { data: existing } = await supabase
        .from('dividends_received')
        .select('symbol, payment_date')
      const alreadyLogged = new Set((existing ?? []).map(d => `${d.symbol}::${d.payment_date}`))

      const today   = new Date()
      const ago90   = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)

      const dripEvents: DripEvent[] = []

      for (const h of divPayers) {
        const s: DividendSummary = data.summaries[h.symbol]
        if (!s || s.error) continue

        // lastDividendValue = most recent actual per-share payment
        const amount = s.lastDividendValue
        const lastDivTs = s.lastDividendDate
        if (!amount || !lastDivTs) continue

        const payDate = new Date(lastDivTs * 1000)
        if (payDate < ago90) continue  // too old

        // Estimate ex-date as ~3 weeks before pay date
        const exDate = new Date(payDate.getTime() - 21 * 24 * 60 * 60 * 1000)

        const payDateStr = payDate.toISOString().slice(0, 10)
        const exDateStr  = exDate.toISOString().slice(0, 10)

        const grossAmount = h.shares * amount
        const reinvestPrice = h.avg_price  // fallback; ideally current price

        dripEvents.push({
          symbol: h.symbol,
          name: h.name,
          exDate: exDateStr,
          payDate: payDateStr,
          amount,
          currency: h.currency,
          sharesHeld: h.shares,
          grossAmount,
          reinvestPrice,
          reinvestShares: grossAmount / reinvestPrice,
          alreadyLogged: alreadyLogged.has(`${h.symbol}::${payDateStr}`),
        })
      }

      // Sort: unlogged first, then by payDate desc
      dripEvents.sort((a, b) => {
        if (a.alreadyLogged !== b.alreadyLogged) return a.alreadyLogged ? 1 : -1
        return b.payDate.localeCompare(a.payDate)
      })

      setEvents(dripEvents)
    } catch (e) {
      setError(`Could not fetch dividend data: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
      setChecked(true)
    }
  }

  const applyDrip = async (ev: DripEvent) => {
    setApplying(ev.symbol)
    const holding = divPayers.find(h => h.symbol === ev.symbol)!
    const wht = ev.grossAmount * 0.15
    const net = ev.grossAmount - wht

    await supabase.from('dividends_received').insert([{
      symbol: ev.symbol,
      payment_date: ev.payDate,
      ex_date: ev.exDate,
      amount_per_share: ev.amount,
      shares_held: ev.sharesHeld,
      gross_amount: ev.grossAmount,
      withholding_tax: wht,
      currency: ev.currency,
      drip_shares_added: net / ev.reinvestPrice,
      drip_price: ev.reinvestPrice,
      notes: `DRIP: reinvested ${(net / ev.reinvestPrice).toFixed(4)} shares @ ${ev.reinvestPrice}`,
    }])

    const newShares  = net / ev.reinvestPrice
    const totalShares = holding.shares + newShares
    const newAvg     = (holding.shares * holding.avg_price + net) / totalShares

    await supabase.from('holdings').update({
      shares: totalShares,
      avg_price: newAvg,
      updated_at: new Date().toISOString(),
    }).eq('id', holding.id)

    setDone(d => [...d, ev.symbol])
    setApplying(null)
    onSaved()
  }

  const pendingEvents = events.filter(e => !e.alreadyLogged && !done.includes(e.symbol))
  const whtRate = 0.15

  return (
    <Modal title="Check dividends" subtitle="Recent payments · auto-reinvest (DRIP)" onClose={onClose} width={560}>
      {!checked ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
            Checks Yahoo Finance for recent dividend payments across your{' '}
            <strong>{divPayers.length} dividend-paying holdings</strong>.
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 20 }}>
            Looks back 90 days for confirmed payments not yet logged.
          </div>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 16,
              background: 'var(--red-bg)', border: '1px solid var(--red-bd)',
              borderRadius: 6, padding: '8px 12px' }}>
              {error}
            </div>
          )}
          <button
            onClick={checkDividends}
            disabled={loading}
            style={{
              padding: '10px 24px', borderRadius: 8,
              background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
              color: 'var(--green)', fontSize: 13, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? '⟳ Checking…' : '⟳ Check now'}
          </button>
        </div>
      ) : (
        <div>
          {error && (
            <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12,
              background: 'var(--red-bg)', border: '1px solid var(--red-bd)',
              borderRadius: 6, padding: '8px 12px' }}>
              {error}
            </div>
          )}

          {events.length === 0 && !error && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
              No recent confirmed dividends found in the last 90 days.
            </div>
          )}

          {pendingEvents.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500, marginBottom: 10 }}>
                {pendingEvents.length} payment{pendingEvents.length > 1 ? 's' : ''} ready to log
              </div>
              {pendingEvents.map(ev => (
                <div key={ev.symbol} style={{
                  border: '1px solid var(--green-bd)', borderRadius: 8,
                  padding: '12px 14px', marginBottom: 10, background: 'var(--green-bg)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{ev.symbol}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>
                        paid {ev.payDate} · ex ~{ev.exDate}
                      </span>
                    </div>
                    <span style={{ fontWeight: 500, color: 'var(--green)' }}>
                      {ev.amount.toFixed(4)} {ev.currency}/share
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, color: 'var(--text2)', marginBottom: 10 }}>
                    <div>Shares held: <strong>{ev.sharesHeld.toFixed(4)}</strong></div>
                    <div>Gross: <strong>{ev.grossAmount.toFixed(2)} {ev.currency}</strong></div>
                    <div>WHT (~{(whtRate * 100).toFixed(0)}%): <strong>−{(ev.grossAmount * whtRate).toFixed(2)}</strong></div>
                    <div>Net: <strong>{(ev.grossAmount * (1 - whtRate)).toFixed(2)}</strong></div>
                    <div>Reinvest @ {ev.reinvestPrice.toFixed(2)} {ev.currency}</div>
                    <div style={{ color: 'var(--green)', fontWeight: 600 }}>
                      +{((ev.grossAmount * (1 - whtRate)) / ev.reinvestPrice).toFixed(4)} new shares
                    </div>
                  </div>
                  <button
                    onClick={() => applyDrip(ev)}
                    disabled={applying === ev.symbol}
                    style={{
                      padding: '6px 14px', borderRadius: 6,
                      background: 'var(--green)', border: 'none',
                      color: '#fff', fontSize: 12, fontWeight: 500,
                      cursor: applying === ev.symbol ? 'not-allowed' : 'pointer',
                      opacity: applying === ev.symbol ? 0.7 : 1,
                    }}
                  >
                    {applying === ev.symbol ? 'Applying…' : 'Apply DRIP →'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {events.filter(e => e.alreadyLogged || done.includes(e.symbol)).map(ev => (
            <div key={ev.symbol} style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 12, color: 'var(--text3)',
            }}>
              <span>{ev.symbol} · {ev.payDate} · {ev.amount.toFixed(4)} {ev.currency}/share</span>
              <span style={{ color: 'var(--green)' }}>
                {done.includes(ev.symbol) ? '✓ Applied' : '✓ Already logged'}
              </span>
            </div>
          ))}

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              onClick={() => { setChecked(false); setEvents([]); setDone([]); setError('') }}
              style={{
                padding: '7px 14px', borderRadius: 6,
                border: '1px solid var(--border2)', background: 'var(--bg)',
                color: 'var(--text2)', fontSize: 12, cursor: 'pointer',
              }}
            >Check again</button>
            <button onClick={onClose} style={{
              padding: '7px 14px', borderRadius: 6,
              border: '1px solid var(--green-bd)', background: 'var(--green-bg)',
              color: 'var(--green)', fontSize: 12, cursor: 'pointer',
            }}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
