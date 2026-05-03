'use client'
import { useState } from 'react'
import { supabase, Holding } from '@/lib/supabase'
import Modal from './Modal'
import { DEFAULT_FX } from '@/lib/fx'
import { PRICES } from '@/lib/prices'

interface DripEvent {
  symbol: string
  exDate: string
  payDate: string
  amount: number
  currency: string
  sharesHeld: number
  grossAmount: number
  reinvestShares: number
  reinvestPrice: number
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
  const [loading, setLoading] = useState(false)
  const [events, setEvents] = useState<DripEvent[]>([])
  const [checked, setChecked] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [aiStatus, setAiStatus] = useState('')

  const divPayers = holdings.filter(h => h.is_dividend_payer)

  const checkDividends = async () => {
    setLoading(true)
    setAiStatus('Asking Claude to search for recent dividend payments…')

    const symbols = divPayers.map(h => h.symbol).join(', ')

    const prompt = `Search for recent confirmed dividend payments (paid in the last 90 days) for these stock tickers: ${symbols}

For each ticker that has had a confirmed dividend payment recently, return a JSON array with objects like:
{
  "symbol": "KO",
  "exDate": "2026-03-13",
  "payDate": "2026-04-01",
  "amount": 0.53,
  "currency": "USD"
}

Only include dividends that have actually been paid (not just declared). Return ONLY valid JSON array, no markdown, no extra text. If none found, return [].`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = await res.json()
      const textBlock = [...data.content].reverse().find((b: { type: string }) => b.type === 'text')

      if (!textBlock?.text) throw new Error('No response')

      const clean = textBlock.text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean) as Array<{
        symbol: string; exDate: string; payDate: string; amount: number; currency: string
      }>

      // Check which are already logged in our DB
      const { data: existing } = await supabase
        .from('dividends_received')
        .select('symbol, payment_date')

      const alreadyLogged = new Set(
        (existing ?? []).map(d => `${d.symbol}::${d.payment_date}`)
      )

      // Build DRIP events
      const dripEvents: DripEvent[] = parsed.map(d => {
        const holding = divPayers.find(h => h.symbol === d.symbol)
        if (!holding) return null
        const sharesHeld = holding.shares
        const grossAmount = sharesHeld * d.amount
        const price = PRICES[d.symbol] ?? holding.avg_price
        const reinvestShares = grossAmount / price
        return {
          ...d,
          sharesHeld,
          grossAmount,
          reinvestShares,
          reinvestPrice: price,
          alreadyLogged: alreadyLogged.has(`${d.symbol}::${d.payDate}`),
        } as DripEvent
      }).filter(Boolean) as DripEvent[]

      setEvents(dripEvents)
      setAiStatus('')
    } catch (e) {
      setAiStatus('Could not fetch dividend data. Please try again.')
      console.error(e)
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

    // 1. Log dividend received
    await supabase.from('dividends_received').insert([{
      symbol: ev.symbol,
      payment_date: ev.payDate,
      ex_date: ev.exDate,
      amount_per_share: ev.amount,
      shares_held: ev.sharesHeld,
      gross_amount: ev.grossAmount,
      withholding_tax: wht,
      currency: ev.currency,
      drip_shares_added: ev.reinvestShares,
      drip_price: ev.reinvestPrice,
      notes: `DRIP: reinvested ${ev.reinvestShares.toFixed(4)} shares @ ${ev.reinvestPrice}`,
    }])

    // 2. Update holding — add reinvested shares (weighted avg)
    const totalOldCost = holding.shares * holding.avg_price
    const newSharesFromDrip = net / ev.reinvestPrice // use net for reinvestment
    const totalNewShares = holding.shares + newSharesFromDrip
    const newAvgPrice = (totalOldCost + net) / totalNewShares

    await supabase.from('holdings').update({
      shares: totalNewShares,
      avg_price: newAvgPrice,
      updated_at: new Date().toISOString(),
    }).eq('id', holding.id)

    setDone(d => [...d, ev.symbol])
    setApplying(null)
    onSaved()
  }

  const pendingEvents = events.filter(e => !e.alreadyLogged && !done.includes(e.symbol))
  const whtRate = 0.15

  return (
    <Modal title="Check dividends" subtitle="Confirm payments and auto-reinvest (DRIP)" onClose={onClose} width={560}>
      {!checked ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
            Will search for confirmed dividend payments for <strong>{divPayers.length} dividend-paying holdings</strong> in the last 90 days.
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 20 }}>
            Uses Claude + web search to check Yahoo Finance and other sources.
          </div>
          {aiStatus && (
            <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 16 }}>{aiStatus}</div>
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
            {loading ? '⟳ Searching…' : '⟳ Check now'}
          </button>
        </div>
      ) : (
        <div>
          {aiStatus && (
            <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{aiStatus}</div>
          )}

          {events.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
              No recent confirmed dividends found for your holdings.
            </div>
          )}

          {pendingEvents.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500, marginBottom: 10 }}>
                {pendingEvents.length} dividend payment{pendingEvents.length > 1 ? 's' : ''} ready to apply
              </div>
              {pendingEvents.map(ev => (
                <div key={ev.symbol} style={{
                  border: '1px solid var(--green-bd)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  marginBottom: 10,
                  background: 'var(--green-bg)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{ev.symbol}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>
                        paid {ev.payDate} · ex {ev.exDate}
                      </span>
                    </div>
                    <span style={{ fontWeight: 500, color: 'var(--green)' }}>
                      {ev.amount} {ev.currency}/share
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, color: 'var(--text2)', marginBottom: 10 }}>
                    <div>Shares held: <strong>{ev.sharesHeld.toFixed(4)}</strong></div>
                    <div>Gross: <strong>{ev.grossAmount.toFixed(2)} {ev.currency}</strong></div>
                    <div>WHT (~{(whtRate * 100).toFixed(0)}%): <strong>−{(ev.grossAmount * whtRate).toFixed(2)}</strong></div>
                    <div>Net for reinvest: <strong>{(ev.grossAmount * (1 - whtRate)).toFixed(2)}</strong></div>
                    <div>Reinvest @ {ev.reinvestPrice} {ev.currency}</div>
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
              border: '1px solid var(--border)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 12, color: 'var(--text3)',
            }}>
              <span>{ev.symbol} · {ev.payDate}</span>
              <span style={{ color: 'var(--green)' }}>
                {done.includes(ev.symbol) ? '✓ Applied' : '✓ Already logged'}
              </span>
            </div>
          ))}

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              onClick={() => { setChecked(false); setEvents([]); setDone([]) }}
              style={{
                padding: '7px 14px', borderRadius: 6,
                border: '1px solid var(--border2)', background: 'var(--bg)',
                color: 'var(--text2)', fontSize: 12, cursor: 'pointer',
              }}
            >
              Check again
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '7px 14px', borderRadius: 6,
                border: '1px solid var(--green-bd)', background: 'var(--green-bg)',
                color: 'var(--green)', fontSize: 12, cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
