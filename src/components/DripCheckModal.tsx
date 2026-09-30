'use client'
import { useState } from 'react'
import { supabase, type Holding, type AssetMetadata } from '@/lib/supabase'
import { useProfile } from '@/lib/profile'
import { fxRate, fetchHistoricalFx, normalizeCurrencyCode, fmtNum } from '@/lib/fx'
import { todayISO, addDays, unixToISODate, fmtISODate } from '@/lib/date'
import { useFx } from '@/hooks/useFx'
import { useMarketData, exchangesFor } from '@/hooks/useMarketData'
import { recordEvent } from '@/lib/db'
import { whtRateFor } from '@/lib/tax'
import { sharesAsOf } from '@/lib/dividends'
import { parseDecimal } from '@/lib/parse'
import Modal from './Modal'
import { ErrorBox, NumberInput, Notice, inputStyle } from './FormFields'
import type { DividendSummary } from '@/app/api/market/dividends/route'

interface DripEvent {
  symbol: string
  exDate: string
  payDate: string
  amountPerShare: number
  /** Currency the dividend was declared in; '' when the provider did not say. */
  currency: string
  sharesAtEx: number
  /** Shares bought after the ex-date — they did not earn this dividend. */
  sharesAfterEx: number
  whtRate: number
  whtBasis: string
  alreadyLogged: boolean
}

interface EditState { wht: string; price: string; currency: string }

const fmtCZK2 = (n: number) => `Kč ${n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Finds paid dividends not yet logged and reinvests them (DRIP).
 *
 * Shares are counted as of the ex-date (later purchases did not earn the
 * payment), money is converted at the pay-date rate, withholding defaults to
 * the issuer country's treaty rate, and the result is written through
 * record_event — dividend row, new lot and ledger rows together.
 */
export default function DripCheckModal({
  holdings,
  metadata = [],
  onClose,
  onSaved,
}: {
  holdings: Holding[]
  metadata?: AssetMetadata[]
  onClose: () => void
  onSaved: () => void
}) {
  const { activeProfile } = useProfile()
  const { fx } = useFx()
  const market = useMarketData()

  const [loading, setLoading]   = useState(false)
  const [events, setEvents]     = useState<DripEvent[]>([])
  const [edits, setEdits]       = useState<Record<string, EditState>>({})
  const [payFx, setPayFx]       = useState<Record<string, Record<string, number>>>({})
  const [checked, setChecked]   = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [done, setDone]         = useState<string[]>([])
  const [error, setError]       = useState('')

  const divPayers = holdings.filter(h => h.is_dividend_payer)
  const key = (e: DripEvent) => `${e.symbol}::${e.payDate}`

  const checkDividends = async () => {
    if (!activeProfile) { setError('No active profile selected.'); return }
    setLoading(true)
    setError('')

    try {
      await market.refresh(divPayers.map(h => h.symbol), true)

      const res = await fetch('/api/market/dividends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: divPayers.map(h => h.symbol), exchanges: exchangesFor(divPayers.map(h => h.symbol)) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { summaries: Record<string, DividendSummary> }

      const [{ data: existing, error: existingErr }, { data: lots, error: lotsErr }] = await Promise.all([
        supabase.from('dividends_received').select('symbol, payment_date').eq('profile_id', activeProfile.id),
        supabase.from('holding_lots').select('symbol, shares, purchase_date').eq('profile_id', activeProfile.id),
      ])
      // Without this list a payment could be logged twice, double-counting the
      // income and the DRIP shares. Fail loudly rather than risk that.
      if (existingErr) throw new Error(`Could not read the dividend log: ${existingErr.message}`)
      if (lotsErr) throw new Error(`Could not read purchase lots: ${lotsErr.message}`)
      const alreadyLogged = new Set((existing ?? []).map(d => `${d.symbol}::${d.payment_date}`))

      const today = todayISO()
      const ago90 = addDays(today, -90)
      const found: DripEvent[] = []

      for (const h of divPayers) {
        const s: DividendSummary = data.summaries[h.symbol]
        if (!s || s.error) continue
        const amountPerShare = s.lastDividendValue
        const payDate = s.lastDividendDateISO ?? unixToISODate(s.lastDividendDate)
        if (!amountPerShare || !payDate || payDate > today || payDate < ago90) continue
        const exDate = s.exDividendDateISO && s.exDividendDateISO <= payDate
          ? s.exDividendDateISO
          : addDays(payDate, -21)

        const { atDate, after } = sharesAsOf(h, (lots ?? []).filter(l => l.symbol === h.symbol), exDate)
        if (atDate <= 0) continue
        const meta = metadata.find(m => m.symbol.toUpperCase() === h.symbol.toUpperCase())
        const wht = whtRateFor(meta)

        found.push({
          symbol: h.symbol, exDate, payDate, amountPerShare,
          currency: s.currency ? normalizeCurrencyCode(s.currency) : '',
          sharesAtEx: atDate, sharesAfterEx: after,
          whtRate: wht.rate,
          whtBasis: wht.basis === 'country' ? `issuer country ${meta?.country}` : wht.basis === 'region' ? `region ${meta?.region}` : 'US treaty default',
          alreadyLogged: alreadyLogged.has(`${h.symbol}::${payDate}`),
        })
      }

      // Pay-date FX for every pay date involved (one request per date).
      const dates = Array.from(new Set(found.filter(e => !e.alreadyLogged).map(e => e.payDate)))
      const rates: Record<string, Record<string, number>> = {}
      await Promise.all(dates.map(async d => {
        const h = await fetchHistoricalFx(d)
        if (h) rates[d] = h.rates
      }))
      setPayFx(rates)

      const initialEdits: Record<string, EditState> = {}
      for (const e of found) {
        const h = divPayers.find(x => x.symbol === e.symbol)!
        initialEdits[key(e)] = {
          wht: String(Number((e.whtRate * 100).toFixed(3))),
          price: String(market.getPrice(h.symbol, h.avg_price)),
          currency: e.currency,
        }
      }
      setEdits(initialEdits)

      found.sort((a, b) =>
        a.alreadyLogged !== b.alreadyLogged ? (a.alreadyLogged ? 1 : -1) : b.payDate.localeCompare(a.payDate))
      setEvents(found)
    } catch (e) {
      setError(`Could not fetch dividend data: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
      setChecked(true)
    }
  }

  /** Everything the card shows and the write needs, from the editable inputs. */
  const compute = (ev: DripEvent) => {
    const h = divPayers.find(x => x.symbol === ev.symbol)
    const ed = edits[key(ev)]
    if (!h || !ed) return null
    const divCcy = ed.currency
    const whtPct = parseDecimal(ed.wht)
    const reinvestPrice = parseDecimal(ed.price)
    const priceCcy = market.hasPrice(h.symbol) ? normalizeCurrencyCode(market.getQuoteCurrency(h.symbol, h.currency)) : normalizeCurrencyCode(h.currency)
    const rates = payFx[ev.payDate]
    const divRate = divCcy ? (rates ? fxRate(divCcy, rates) : null) : null
    const holdingRate = rates ? fxRate(h.currency, rates) : null
    // Reinvest price is today's quote; convert it at today's rate.
    const priceRate = fxRate(priceCcy, fx)
    if (!divCcy || whtPct == null || whtPct < 0 || whtPct > 100 || reinvestPrice == null || reinvestPrice <= 0 ||
        divRate == null || holdingRate == null || priceRate == null) {
      return { h, ok: false as const, divRate, holdingRate }
    }
    const grossNative = ev.sharesAtEx * ev.amountPerShare
    const whtNative = grossNative * whtPct / 100
    const netCZK = (grossNative - whtNative) * divRate
    const reinvestPriceCZK = reinvestPrice * priceRate
    const reinvestShares = netCZK / reinvestPriceCZK
    // Cost basis of the new shares, in the position's own currency at the
    // pay-date rate: what the reinvested money actually was.
    const dripPriceHoldingCcy = netCZK / holdingRate / reinvestShares
    return {
      h, ok: true as const, divCcy, grossNative, whtNative, netCZK, reinvestPrice, priceCcy,
      reinvestPriceCZK, reinvestShares, dripPriceHoldingCcy, divRate, holdingRate,
    }
  }

  const applyDrip = async (ev: DripEvent) => {
    const c = compute(ev)
    if (!c || !c.ok) { setError(`Fill in the missing figures for ${ev.symbol} first.`); return }
    setApplying(key(ev))
    setError('')
    const { error: err } = await recordEvent(activeProfile?.id, {
      kind: 'dividend', asset_class: 'stock',
      date: ev.payDate, currency: c.divCcy, fx_rate_czk: c.divCcy === 'CZK' ? 1 : c.divRate!,
      symbol: ev.symbol, ex_date: ev.exDate,
      amount_per_share: ev.amountPerShare, shares_held: ev.sharesAtEx,
      gross: c.grossNative, tax: c.whtNative,
      drip_shares: c.reinvestShares, drip_price: c.dripPriceHoldingCcy,
      drip_fx_rate_czk: c.holdingRate,
      notes: `DRIP: ${c.netCZK.toFixed(2)} CZK → +${c.reinvestShares.toFixed(4)} sh @ ${c.reinvestPrice.toFixed(2)} ${c.priceCcy}`,
    })
    setApplying(null)
    if (err) { setError(`${ev.symbol}: ${err}`); return }
    setDone(d => [...d, key(ev)])
    onSaved()
  }

  const setEdit = (ev: DripEvent, patch: Partial<EditState>) =>
    setEdits(e => ({ ...e, [key(ev)]: { ...e[key(ev)], ...patch } }))

  const pendingEvents = events.filter(e => !e.alreadyLogged && !done.includes(key(e)))
  const cell = { textAlign: 'right' as const, fontFamily: "'DM Mono', monospace" }

  return (
    <Modal title="Check dividends" subtitle="Recent payments · reinvest (DRIP)" onClose={onClose} width={600}>
      {!checked ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
            Checks your <strong>{divPayers.length} dividend-paying holdings</strong> for payments in the last 90 days that are not logged yet.
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 20, lineHeight: 1.6 }}>
            Shares are counted as of the ex-date, money is converted at the pay-date rate,
            and withholding defaults to the issuer country&apos;s treaty rate — every figure is editable before you apply.
          </div>
          <ErrorBox msg={error} />
          <button
            type="button"
            onClick={checkDividends}
            disabled={loading}
            style={{
              padding: '10px 24px', borderRadius: 8,
              background: 'var(--green-bg)', border: '1px solid var(--green-bd)',
              color: 'var(--green)', fontSize: 13, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? '⟳ Checking…' : '⟳ Check now'}
          </button>
        </div>
      ) : (
        <div>
          <ErrorBox msg={error} />

          {events.length === 0 && !error && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
              No confirmed dividends found in the last 90 days.
            </div>
          )}

          {pendingEvents.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500, marginBottom: 10 }}>
                {pendingEvents.length} payment{pendingEvents.length > 1 ? 's' : ''} ready to log
              </div>
              {pendingEvents.map(ev => {
                const c = compute(ev)
                const ed = edits[key(ev)]
                return (
                  <div key={key(ev)} style={{
                    border: '1px solid var(--green-bd)', borderRadius: 8,
                    padding: '14px 16px', marginBottom: 10, background: 'var(--green-bg)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{ev.symbol}</span>
                        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>
                          paid {fmtISODate(ev.payDate)} · ex {fmtISODate(ev.exDate)}
                        </span>
                      </div>
                      <span className="num" style={{ fontWeight: 500, color: 'var(--green)', fontSize: 13 }}>
                        {fmtNum(ev.amountPerShare, 4)} {ed?.currency || '?'}/share
                      </span>
                    </div>

                    {!ev.currency && (
                      <Notice>
                        The data provider did not report this dividend&apos;s currency. Choose it:{' '}
                        <select aria-label={`Dividend currency for ${ev.symbol}`} style={{ ...inputStyle, width: 90, display: 'inline-block', padding: '2px 6px' }}
                          value={ed?.currency ?? ''} onChange={e => setEdit(ev, { currency: e.target.value })}>
                          <option value="">—</option>
                          {['USD', 'EUR', 'CZK', 'GBP', 'CHF'].map(x => <option key={x}>{x}</option>)}
                        </select>
                      </Notice>
                    )}
                    {ev.sharesAfterEx > 0 && (
                      <Notice tone="gray">
                        {fmtNum(ev.sharesAfterEx, 4)} shares bought after the ex-date are excluded.
                      </Notice>
                    )}

                    <div style={{
                      background: 'rgba(0,0,0,0.03)', borderRadius: 6, padding: '10px 12px', marginBottom: 10,
                      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 11, color: 'var(--text2)',
                      alignItems: 'center',
                    }}>
                      <div>Shares at ex-date</div>
                      <div style={cell}>{fmtNum(ev.sharesAtEx, 4)}</div>

                      <div>Gross dividend</div>
                      <div style={cell}>{c?.ok ? `${fmtNum(c.grossNative, 2)} ${c.divCcy}` : '—'}</div>

                      <label htmlFor={`wht-${key(ev)}`}>Withholding % <span style={{ color: 'var(--text3)' }}>({ev.whtBasis})</span></label>
                      <div><NumberInput id={`wht-${key(ev)}`} value={ed?.wht ?? ''} onChange={v => setEdit(ev, { wht: v })} suffix="%" /></div>

                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4, fontWeight: 600 }}>Net reinvested</div>
                      <div style={{ ...cell, borderTop: '1px solid var(--border)', paddingTop: 4, fontWeight: 600, color: 'var(--green)' }}>
                        {c?.ok ? fmtCZK2(c.netCZK) : '—'}
                        {c?.ok && c.divCcy !== 'CZK' && <span style={{ color: 'var(--text3)', fontWeight: 400, marginLeft: 6 }}>@ {fmtNum(c.divRate!, 4)} on pay date</span>}
                      </div>

                      <label htmlFor={`px-${key(ev)}`}>Reinvest price <span style={{ color: 'var(--text3)' }}>(today&apos;s quote — use your fill)</span></label>
                      <div><NumberInput id={`px-${key(ev)}`} value={ed?.price ?? ''} onChange={v => setEdit(ev, { price: v })} suffix={c?.ok ? c.priceCcy : undefined} /></div>

                      <div style={{ fontWeight: 600 }}>New shares</div>
                      <div style={{ ...cell, fontWeight: 600, color: 'var(--green)' }}>
                        {c?.ok ? `+${fmtNum(c.reinvestShares, 4)}` : '—'}
                      </div>
                    </div>

                    {c && !c.ok && (
                      <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 8 }}>
                        {c.divRate == null || c.holdingRate == null
                          ? 'No ECB rate for the pay date — cannot convert without guessing.'
                          : 'Check the currency, withholding and price above.'}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => applyDrip(ev)}
                      disabled={applying === key(ev) || !c?.ok}
                      style={{
                        padding: '7px 16px', borderRadius: 6, background: 'var(--green)', border: 'none',
                        color: '#fff', fontSize: 12, fontWeight: 500,
                        cursor: applying === key(ev) || !c?.ok ? 'not-allowed' : 'pointer',
                        opacity: applying === key(ev) || !c?.ok ? 0.6 : 1,
                      }}
                    >
                      {applying === key(ev) ? 'Applying…' : 'Log & reinvest →'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {events.filter(e => e.alreadyLogged || done.includes(key(e))).map(ev => (
            <div key={key(ev)} style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text3)',
            }}>
              <span>{ev.symbol} · {fmtISODate(ev.payDate)} · {fmtNum(ev.amountPerShare, 4)}/share</span>
              <span style={{ color: 'var(--green)' }}>{done.includes(key(ev)) ? '✓ Applied' : '✓ Already logged'}</span>
            </div>
          ))}

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button"
              onClick={() => { setChecked(false); setEvents([]); setDone([]); setError('') }}
              style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 12, cursor: 'pointer' }}
            >Check again</button>
            <button type="button" onClick={onClose} style={{
              padding: '7px 14px', borderRadius: 6, border: '1px solid var(--green-bd)', background: 'var(--green-bg)',
              color: 'var(--green)', fontSize: 12, cursor: 'pointer',
            }}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
