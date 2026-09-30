'use client'
import { exchangesFor } from '@/hooks/useMarketData'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAppData } from '@/hooks/useAppData'
import { PageShell, PageHeader, EmptyState, Panel, Tabs } from '@/components/PageShell'
import Badge from '@/components/Badge'
import type { DividendSummary } from '@/app/api/market/dividends/route'
import { todayISO, addDays, daysBetween, unixToISODate, fmtISODate } from '@/lib/date'
import { futureCashFlows } from '@/lib/bonds'
import { fmtNum } from '@/lib/fx'
import { btnStyle, th, tdR, tdL } from '@/lib/ui'

type Kind = 'exdiv' | 'coupon' | 'maturity' | 'deposit'

interface CalEvent {
  id: string
  kind: Kind
  title: string
  subtitle: string
  date: string
  /** Second date (pay date for an ex-dividend event). */
  payDate?: string
  payDateEstimated?: boolean
  amount: string
  daysUntil: number
}

const KIND_LABEL: Record<Kind, string> = {
  exdiv: 'Ex-dividend', coupon: 'Coupon', maturity: 'Bond matures', deposit: 'Deposit matures',
}
const KIND_COLOR: Record<Kind, string> = {
  exdiv: 'var(--c-stocks)', coupon: 'var(--c-bond)', maturity: 'var(--c-bond)', deposit: 'var(--c-cash)',
}

/**
 * What is coming up in the next 90 days: ex-dividend dates, bond coupons and
 * maturities, and term deposits unlocking.
 */
export default function CalendarPage() {
  const [divEvents, setDivEvents] = useState<CalEvent[]>([])
  const [loading, setLoading]     = useState(false)
  const [fetched, setFetched]     = useState(false)
  const [error, setError]         = useState('')
  const [filter, setFilter]       = useState<'all' | Kind>('all')
  const app = useAppData()
  const payers = app.holdings.filter(h => h.is_dividend_payer)
  const inFlightRef = useRef(false)
  const today = todayISO()
  const in90 = addDays(today, 90)

  const fetchExDates = useCallback(async () => {
    if (payers.length === 0 || inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/market/dividends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: payers.map(h => h.symbol), exchanges: exchangesFor(payers.map(h => h.symbol)) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { summaries: Record<string, DividendSummary> }
      const ago30 = addDays(today, -30)
      const out: CalEvent[] = []
      for (const h of payers) {
        const s = data.summaries[h.symbol]
        if (!s || s.error) continue
        const exDate = s.exDividendDateISO ?? unixToISODate(s.exDividendDate)
        if (!exDate || exDate < ago30 || exDate > in90) continue
        const freq = s.payoutFrequency ?? 4
        const amount = s.lastDividendValue ?? (s.trailingAnnualDividendRate ? s.trailingAnnualDividendRate / freq : null)
        if (!amount) continue
        const providerPay = s.payDividendDateISO
        const payDateEstimated = !providerPay || providerPay < exDate
        out.push({
          id: `ex-${h.symbol}`, kind: 'exdiv', title: h.name, subtitle: h.symbol, date: exDate,
          payDate: payDateEstimated ? addDays(exDate, 21) : providerPay!, payDateEstimated,
          amount: `${fmtNum(amount, 4)} ${s.currency || '?'}/sh`,
          daysUntil: daysBetween(today, exDate),
        })
      }
      setDivEvents(out)
    } catch (e) {
      setError(`Could not fetch ex-dividend dates: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      inFlightRef.current = false
      setLoading(false)
      setFetched(true)
    }
  }, [payers, today, in90])

  const symbolKey = payers.map(h => h.symbol).join(',')
  useEffect(() => {
    if (symbolKey && !fetched) fetchExDates()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey, fetched])

  // Bond coupons/maturities and term deposits come from your own data — no fetch.
  const localEvents = useMemo(() => {
    const out: CalEvent[] = []
    for (const b of app.bondHoldings) {
      if (b.quantity <= 0) continue
      for (const cf of futureCashFlows(b, today)) {
        if (cf.date > in90) continue
        out.push({
          id: `b-${b.id}-${cf.date}-${cf.isPrincipal ? 'p' : 'c'}`,
          kind: cf.isPrincipal ? 'maturity' : 'coupon',
          title: b.name, subtitle: b.isin, date: cf.date,
          amount: `${fmtNum(cf.amount * b.quantity, 2)} ${b.currency}`,
          daysUntil: daysBetween(today, cf.date),
        })
      }
    }
    for (const a of app.bankAccounts) {
      if (a.account_type !== 'fixed_deposit' || !a.maturity_date) continue
      if (a.maturity_date < today || a.maturity_date > in90) continue
      out.push({
        id: `td-${a.id}`, kind: 'deposit', title: a.name, subtitle: a.institution, date: a.maturity_date,
        amount: `${fmtNum(a.balance, 0)} ${a.currency}`, daysUntil: daysBetween(today, a.maturity_date),
      })
    }
    return out
  }, [app.bondHoldings, app.bankAccounts, today, in90])

  const events = [...divEvents, ...localEvents]
    .filter(e => filter === 'all' || e.kind === filter)
    .sort((a, b) => a.date.localeCompare(b.date))
  const soon = events.filter(e => e.daysUntil >= 0 && e.daysUntil <= 14)

  const whenChip = (days: number) =>
    days < 0 ? <Badge variant="gray">passed</Badge>
      : days === 0 ? <Badge variant="blue">today</Badge>
      : <Badge variant={days <= 14 ? 'blue' : 'gray'}>in {days} d</Badge>

  const nothingToTrack = payers.length === 0 && app.bondHoldings.length === 0 &&
    !app.bankAccounts.some(a => a.account_type === 'fixed_deposit')

  return (
    <PageShell>
      <PageHeader
        eyebrow="Income"
        title="Upcoming"
        subtitle={<>Next 90 days: ex-dividend dates, bond coupons and maturities, term deposits
          {loading && <span style={{ color: 'var(--amber)' }}> · ⟳ fetching dividend dates…</span>}</>}
        actions={payers.length > 0 && (
          <button type="button" onClick={() => { setFetched(false); setDivEvents([]) }} disabled={loading} style={btnStyle('secondary')}>↻ Refresh</button>
        )}
      />

      {error && <div role="alert" style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid var(--red-bd)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12 }}>{error}</div>}

      {nothingToTrack ? (
        <EmptyState
          icon="▦"
          title="Nothing to put on the calendar yet"
          body={<>Ex-dividend dates appear for holdings marked as dividend payers (edit a position on{' '}
            <Link href="/holdings">Stocks &amp; ETFs</Link>). Bond coupons and maturities come from <Link href="/bonds">Bonds</Link>,
            term-deposit maturities from <Link href="/cash">Cash &amp; savings</Link>.</>}
        />
      ) : <>
        <Tabs label="Event type" value={filter} onChange={setFilter} tabs={[
          { key: 'all', label: 'All' }, { key: 'exdiv', label: 'Ex-dividend' }, { key: 'coupon', label: 'Coupons' },
          { key: 'maturity', label: 'Maturities' }, { key: 'deposit', label: 'Deposits' },
        ]} />

        {soon.length > 0 && (
          <Panel title="Next 14 days">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {soon.map(e => (
                <div key={e.id} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 7, padding: '8px 12px', fontSize: 12 }}>
                  <span aria-hidden="true" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: KIND_COLOR[e.kind], marginRight: 6 }} />
                  <strong>{e.subtitle}</strong>
                  <span style={{ color: 'var(--text3)', marginLeft: 8 }}>{KIND_LABEL[e.kind].toLowerCase()} {fmtISODate(e.date)}</span>
                  <span style={{ marginLeft: 8 }}>{e.daysUntil === 0 ? 'today' : `in ${e.daysUntil} d`}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {events.length === 0 && !loading ? (
          <EmptyState icon="▦" title="Nothing in the next 90 days" body="Check back later, or switch the filter above." />
        ) : (
          <Panel title="Calendar" padded={false}>
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <caption className="sr-only">Upcoming income events</caption>
                <thead>
                  <tr>
                    {['Event', 'What', 'Date', 'Pay date', 'Amount', 'When'].map((h, i) => (
                      <th key={h} scope="col" style={{ ...th, textAlign: i < 2 ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map(e => (
                    <tr key={e.id}>
                      <td style={tdL}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: KIND_COLOR[e.kind] }} />
                          {KIND_LABEL[e.kind]}
                        </span>
                      </td>
                      <td style={tdL}>
                        <div style={{ fontWeight: 500 }}>{e.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.subtitle}</div>
                      </td>
                      <td style={tdR}>{fmtISODate(e.date)}</td>
                      <td style={tdR}>
                        {e.payDate ? <>{fmtISODate(e.payDate)}{e.payDateEstimated && <span title="Estimated as ex-date + 21 days" style={{ fontSize: 10, color: 'var(--text3)' }}> ~est.</span>}</> : '—'}
                      </td>
                      <td className="num" style={tdR}>{e.amount}</td>
                      <td style={tdR}>{whenChip(e.daysUntil)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </>}
    </PageShell>
  )
}
