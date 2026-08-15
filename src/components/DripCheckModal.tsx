'use client'
import { useState } from 'react'
import { supabase, Holding } from '@/lib/supabase'
import { useProfile } from '@/lib/profile'
import { toCZK, fxRate } from '@/lib/fx'
import { todayISO, addDays, unixToISODate, fmtISODate } from '@/lib/date'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import Modal from './Modal'
import type { DividendSummary } from '@/app/api/market/dividends/route'

interface DripEvent {
  symbol: string
  name: string
  exDate: string
  payDate: string
  amountPerShare: number       // native currency per share
  currency: string
  sharesHeld: number
  grossNative: number          // e.g. USD 23.43
  grossCZK: number             // e.g. CZK 486.99
  whtNative: number            // e.g. USD 3.51
  whtCZK: number               // e.g. CZK 73.05
  netCZK: number               // e.g. CZK 413.94  ← what broker reinvests
  reinvestPriceNative: number  // live market price in native currency
  reinvestPriceCZK: number     // live price converted to CZK
  reinvestShares: number       // netCZK / reinvestPriceCZK
  alreadyLogged: boolean
}

const WHT_RATE = 0.15

export default function DripCheckModal({
  holdings,
  onClose,
  onSaved,
}: {
  holdings: Holding[]
  onClose: () => void
  onSaved: () => void
}) {
  const { activeProfile } = useProfile()
  const { fx } = useFx()
  const market = useMarketData()

  const [loading, setLoading]   = useState(false)
  const [events, setEvents]     = useState<DripEvent[]>([])
  const [checked, setChecked]   = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [done, setDone]         = useState<string[]>([])
  const [error, setError]       = useState('')

  const divPayers = holdings.filter(h => h.is_dividend_payer)

  const checkDividends = async () => {
    if (!activeProfile) { setError('No active profile selected.'); return }
    setLoading(true)
    setError('')

    try {
      // Fetch fresh market prices alongside dividend data so reinvest price is live
      await market.refresh(divPayers.map(h => h.symbol), true)

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

      const { data: existing, error: existingErr } = await supabase
        .from('dividends_received')
        .select('symbol, payment_date')
        .eq('profile_id', activeProfile.id)
      // Without this list a payment could be logged twice, double-counting the
      // income and the DRIP shares. Fail loudly rather than risk that.
      if (existingErr) throw new Error(`Could not read the dividend log: ${existingErr.message}`)
      const alreadyLogged = new Set((existing ?? []).map(d => `${d.symbol}::${d.payment_date}`))

      const today = todayISO()
      const ago90 = addDays(today, -90)
      const dripEvents: DripEvent[] = []

      for (const h of divPayers) {
        const s: DividendSummary = data.summaries[h.symbol]
        if (!s || s.error) continue

        const amountPerShare = s.lastDividendValue
        // Accept the ISO pay date as well as the Unix one. StockAnalysis only
        // supplies the ISO form, and the old code required the Unix field —
        // which meant DRIP silently found nothing for every SA-covered ticker,
        // i.e. essentially the whole portfolio.
        const payDateStr = s.lastDividendDateISO ?? unixToISODate(s.lastDividendDate)
        if (!amountPerShare || !payDateStr) continue

        // Only already-paid dividends can be reinvested
        if (payDateStr > today) continue
        if (payDateStr < ago90) continue

        // Prefer the reported ex-date; fall back to pay date − 21 days
        const exDateStr = s.exDividendDateISO && s.exDividendDateISO <= payDateStr
          ? s.exDividendDateISO
          : addDays(payDateStr, -21)

        // Dividends are declared in the security's own currency, which is not
        // always the currency the position was booked in.
        const divCurrency = s.currency || h.currency

        // --- Money amounts ---
        const grossNative = h.shares * amountPerShare
        const grossCZK    = toCZK(grossNative, divCurrency, fx)
        const whtNative   = grossNative * WHT_RATE
        const whtCZK      = grossCZK * WHT_RATE
        // Broker reinvests the CZK net amount
        const netCZK      = grossCZK - whtCZK

        // --- Reinvest price: live market price in its own ccy, converted to CZK ---
        // Falls back to avg_price if a live price is not available
        const reinvestPriceNative = market.getPrice(h.symbol, h.avg_price)
        const priceCurrency = market.hasPrice(h.symbol)
          ? market.getQuoteCurrency(h.symbol, h.currency)
          : h.currency
        const reinvestPriceCZK    = toCZK(reinvestPriceNative, priceCurrency, fx)

        // Shares = CZK net ÷ CZK price (matches broker behaviour)
        const reinvestShares = reinvestPriceCZK > 0 ? netCZK / reinvestPriceCZK : 0
        if (reinvestShares <= 0) continue

        dripEvents.push({
          symbol: h.symbol,
          name: h.name,
          exDate: exDateStr,
          payDate: payDateStr,
          amountPerShare,
          currency: divCurrency,
          sharesHeld: h.shares,
          grossNative,
          grossCZK,
          whtNative,
          whtCZK,
          netCZK,
          reinvestPriceNative,
          reinvestPriceCZK,
          reinvestShares,
          alreadyLogged: alreadyLogged.has(`${h.symbol}::${payDateStr}`),
        })
      }

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
    if (!activeProfile) return
    const holding = divPayers.find(h => h.symbol === ev.symbol)
    if (!holding) { setError(`${ev.symbol} is no longer in your holdings.`); return }

    // The cost basis is booked in the holding's currency, so the reinvested
    // amount has to be expressed in that same currency. Bail out rather than
    // guessing at a rate — a wrong one corrupts the cost basis permanently.
    const holdingRate = fxRate(holding.currency, fx)
    if (holdingRate == null) {
      setError(`No FX rate for ${holding.currency} — cannot compute the new cost basis for ${ev.symbol}.`)
      return
    }

    setApplying(ev.symbol)
    setError('')

    // Log the dividend payment
    const { error: logErr } = await supabase.from('dividends_received').insert([{
      symbol: ev.symbol,
      payment_date: ev.payDate,
      ex_date: ev.exDate,
      amount_per_share: ev.amountPerShare,
      shares_held: ev.sharesHeld,
      gross_amount: ev.grossNative,
      withholding_tax: ev.whtNative,
      currency: ev.currency,
      drip_shares_added: ev.reinvestShares,
      drip_price: ev.reinvestPriceNative,
      notes: `DRIP: ${ev.netCZK.toFixed(2)} CZK reinvested → +${ev.reinvestShares.toFixed(4)} shares @ ${ev.reinvestPriceNative.toFixed(2)} ${ev.currency} (${ev.reinvestPriceCZK.toFixed(2)} CZK)`,
      profile_id: activeProfile.id,
    }])

    if (logErr) {
      // Stop here: bumping the share count without logging the dividend would
      // leave the position overstated with no record of why.
      setError(`Could not log the ${ev.symbol} dividend: ${logErr.message}`)
      setApplying(null)
      return
    }

    // Update holding: add fractional shares, recalculate weighted avg price.
    // New avg = (old cost basis + reinvested amount) / new share count, all in
    // the holding's own currency.
    const newTotalShares = holding.shares + ev.reinvestShares
    const netInHoldingCcy = ev.netCZK / holdingRate
    const newAvgPrice = (holding.shares * holding.avg_price + netInHoldingCcy) / newTotalShares

    const { error: updErr } = await supabase.from('holdings').update({
      shares: newTotalShares,
      avg_price: newAvgPrice,
      updated_at: new Date().toISOString(),
    }).eq('id', holding.id)

    if (updErr) {
      setError(`Dividend logged, but the ${ev.symbol} position could not be updated: ${updErr.message}`)
      setApplying(null)
      onSaved()
      return
    }

    setDone(d => [...d, ev.symbol])
    setApplying(null)
    onSaved()
  }

  const pendingEvents = events.filter(e => !e.alreadyLogged && !done.includes(e.symbol))

  const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmt4 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  const fmtCZK = (n: number) => `Kč\u202f${n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <Modal title="Check dividends" subtitle="Recent payments · auto-reinvest (DRIP)" onClose={onClose} width={580}>
      {!checked ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
            Checks dividend data for your{' '}
            <strong>{divPayers.length} dividend-paying holdings</strong>.
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>
            Looks back 90 days for confirmed payments not yet logged.
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 20 }}>
            Reinvestment is calculated in <strong>CZK</strong> using live prices — matching IBKR&rsquo;s behaviour.
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
                  padding: '14px 16px', marginBottom: 10, background: 'var(--green-bg)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{ev.symbol}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>
                        paid {fmtISODate(ev.payDate)} · ex ~{fmtISODate(ev.exDate)}
                      </span>
                    </div>
                    <span style={{ fontWeight: 500, color: 'var(--green)', fontSize: 13 }}>
                      {fmt2(ev.amountPerShare)} {ev.currency}/share
                    </span>
                  </div>

                  {/* Calculation breakdown — matches broker statement */}
                  <div style={{
                    background: 'rgba(0,0,0,0.03)', borderRadius: 6,
                    padding: '10px 12px', marginBottom: 10,
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 16px',
                    fontSize: 11, color: 'var(--text2)',
                  }}>
                    <div>Shares held</div>
                    <div style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>{fmt4(ev.sharesHeld)}</div>

                    <div>Gross dividend</div>
                    <div style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>
                      {fmt2(ev.grossNative)} {ev.currency}
                      <span style={{ color: 'var(--text3)', marginLeft: 6 }}>({fmtCZK(ev.grossCZK)})</span>
                    </div>

                    <div>WHT {(WHT_RATE * 100).toFixed(0)}%</div>
                    <div style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace", color: 'var(--red)' }}>
                      −{fmt2(ev.whtNative)} {ev.currency}
                      <span style={{ color: 'var(--text3)', marginLeft: 6 }}>(−{fmtCZK(ev.whtCZK)})</span>
                    </div>

                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4, fontWeight: 600 }}>Net reinvested</div>
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4, textAlign: 'right', fontFamily: "'DM Mono', monospace", fontWeight: 600, color: 'var(--green)' }}>
                      {fmtCZK(ev.netCZK)}
                    </div>

                    <div style={{ color: 'var(--text3)' }}>Reinvest price</div>
                    <div style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace", color: 'var(--text3)' }}>
                      {fmt2(ev.reinvestPriceNative)} {ev.currency}
                      <span style={{ marginLeft: 6 }}>({fmtCZK(ev.reinvestPriceCZK)})</span>
                    </div>

                    <div style={{ fontWeight: 600 }}>New shares</div>
                    <div style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace", fontWeight: 600, color: 'var(--green)' }}>
                      +{fmt4(ev.reinvestShares)} shares
                    </div>
                  </div>

                  <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10 }}>
                    = {fmtCZK(ev.netCZK)} ÷ {fmtCZK(ev.reinvestPriceCZK)} per share
                    {market.state !== 'done' && ' · using avg price as fallback (refresh prices for live rate)'}
                  </div>

                  <button
                    onClick={() => applyDrip(ev)}
                    disabled={applying === ev.symbol}
                    style={{
                      padding: '7px 16px', borderRadius: 6,
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
              <span>{ev.symbol} · {fmtISODate(ev.payDate)} · {fmt2(ev.amountPerShare)} {ev.currency}/share</span>
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
