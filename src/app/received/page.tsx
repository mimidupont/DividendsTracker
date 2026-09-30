'use client'
import { useMemo, useState } from 'react'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, Tabs } from '@/components/PageShell'
import Badge from '@/components/Badge'
import RecordModal, { type RecordPreset } from '@/components/RecordModal'
import DataTable, { type Column } from '@/components/DataTable'
import { useAppData } from '@/hooks/useAppData'
import { useFx } from '@/hooks/useFx'
import { fmtCZK, fmtNum } from '@/lib/fx'
import { fmtISODate, todayISO, yearOf } from '@/lib/date'
import { paymentCZK } from '@/lib/dividends'
import { czkOf } from '@/lib/transactions'
import { btnStyle } from '@/lib/ui'

type Stream = 'dividend' | 'interest' | 'coupon' | 'rent'

interface IncomeRow {
  id: string
  stream: Stream
  source: string
  date: string
  grossCZK: number
  taxCZK: number
  netCZK: number
  currency: string
  frozen: boolean
  detail?: string
}

const STREAM_LABEL: Record<Stream, string> = { dividend: 'Dividend', interest: 'Interest', coupon: 'Coupon', rent: 'Rent' }
const STREAM_COLOR: Record<Stream, string> = {
  dividend: 'var(--c-stocks)', interest: 'var(--c-cash)', coupon: 'var(--c-bond)', rent: 'var(--c-realestate)',
}

/**
 * Every payment received, across income streams. Converted at the rate on the
 * payment date where recorded, so a year's total no longer moves every time
 * the koruna does — which is also what the Czech return needs.
 */
export default function ReceivedPage() {
  const { dividendsReceived, bankInterest, bankAccounts, transactions, loading, reload } = useAppData()
  const { fx } = useFx()
  const [record, setRecord] = useState<RecordPreset | null>(null)
  const [tab, setTab] = useState<'all' | Stream>('all')
  const [year, setYear] = useState<'all' | number>(yearOf(todayISO()))

  const rows: IncomeRow[] = useMemo(() => {
    const out: IncomeRow[] = []
    for (const d of dividendsReceived) {
      const g = paymentCZK(d, fx, 'gross')
      const n = paymentCZK(d, fx, 'net')
      out.push({
        id: `d-${d.id}`, stream: 'dividend', source: d.symbol, date: d.payment_date,
        grossCZK: g.czk, taxCZK: g.czk - n.czk, netCZK: n.czk, currency: d.currency, frozen: g.frozen,
        detail: `${fmtNum(d.shares_held, 4)} sh × ${fmtNum(d.amount_per_share, 4)} ${d.currency}${d.drip_shares_added ? ` · DRIP +${fmtNum(d.drip_shares_added, 4)} sh` : ''}`,
      })
    }
    const accountName = new Map(bankAccounts.map(a => [a.id, a.name]))
    for (const i of bankInterest) {
      const g = paymentCZK({ gross_amount: i.gross_amount, withholding_tax: i.tax_withheld, currency: i.currency, fx_rate_czk: i.fx_rate_czk }, fx, 'gross')
      const n = paymentCZK({ gross_amount: i.gross_amount, withholding_tax: i.tax_withheld, currency: i.currency, fx_rate_czk: i.fx_rate_czk }, fx, 'net')
      out.push({
        id: `i-${i.id}`, stream: 'interest', source: accountName.get(i.account_id) ?? 'Bank account', date: i.payment_date,
        grossCZK: g.czk, taxCZK: g.czk - n.czk, netCZK: n.czk, currency: i.currency, frozen: g.frozen,
      })
    }
    // Coupons and rent live in the ledger only (interest on bank accounts is
    // taken from the interest log above, so it is not counted twice).
    for (const t of transactions) {
      const stream: Stream | null = t.type === 'interest' && t.asset_class === 'bond' ? 'coupon'
        : t.type === 'rent' ? 'rent' : null
      if (!stream) continue
      const gross = Math.abs(czkOf(t))
      const tax = (t.tax ?? 0) * (t.fx_rate_czk || 1)
      out.push({
        id: `t-${t.id}`, stream, source: t.symbol ?? t.notes ?? STREAM_LABEL[stream], date: t.txn_date,
        grossCZK: gross, taxCZK: tax, netCZK: gross - tax, currency: t.currency, frozen: true,
      })
    }
    return out.sort((a, b) => b.date.localeCompare(a.date))
  }, [dividendsReceived, bankInterest, bankAccounts, transactions, fx])

  const years = Array.from(new Set(rows.map(r => yearOf(r.date)))).sort((a, b) => b - a)
  const shown = rows.filter(r => (tab === 'all' || r.stream === tab) && (year === 'all' || yearOf(r.date) === year))
  const sum = (k: 'grossCZK' | 'taxCZK' | 'netCZK', list = shown) => list.reduce((s, r) => s + r[k], 0)
  const unfrozen = shown.filter(r => !r.frozen).length

  if (loading) return <LoadingShell />

  const columns: Column<IncomeRow>[] = [
    { key: 'date', label: 'Date', sortValue: r => r.date, render: r => fmtISODate(r.date) },
    { key: 'stream', label: 'Type', sortValue: r => r.stream, render: r => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: STREAM_COLOR[r.stream] }} />
        {STREAM_LABEL[r.stream]}
      </span>
    ) },
    { key: 'source', label: 'Source', sortValue: r => r.source, render: r => <>
      <div style={{ fontWeight: 500 }}>{r.source}</div>
      {r.detail && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.detail}</div>}
    </> },
    { key: 'gross', label: 'Gross (CZK)', numeric: true, sortValue: r => r.grossCZK, render: r => fmtCZK(r.grossCZK, 2) },
    { key: 'tax', label: 'Tax withheld', numeric: true, sortValue: r => r.taxCZK, render: r => r.taxCZK > 0 ? `−${fmtCZK(r.taxCZK, 2)}` : '—' },
    { key: 'net', label: 'Net (CZK)', numeric: true, sortValue: r => r.netCZK, render: r => <strong>{fmtCZK(r.netCZK, 2)}</strong> },
    { key: 'ccy', label: 'Paid in', align: 'right', render: r => <>
      <Badge variant="gray">{r.currency}</Badge>
      {!r.frozen && <span title="No payment-date rate recorded — converted at today's rate" style={{ marginLeft: 4, color: 'var(--text3)', fontSize: 10 }}>today&apos;s rate</span>}
    </> },
  ]

  return (
    <PageShell>
      {record && <RecordModal preset={record} onClose={() => setRecord(null)} onSaved={reload} />}
      <PageHeader
        eyebrow="Income"
        title="Received"
        subtitle="Dividends, interest, coupons and rent — converted at the rate on the day each was paid"
        actions={<>
          <button type="button" onClick={() => setRecord({ kind: 'interest' })} style={btnStyle('secondary')}>+ Interest</button>
          <button type="button" onClick={() => setRecord({ kind: 'dividend' })} style={btnStyle('primary')}>+ Dividend</button>
        </>}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="↓"
          title="No income logged yet"
          body={<>Log dividends as they arrive (or use “Check dividends” on Stocks &amp; ETFs to find and reinvest recent ones),
            and record bank interest and bond coupons with Record.</>}
          action={<button type="button" onClick={() => setRecord({ kind: 'dividend' })} style={btnStyle('primary')}>+ Log a dividend</button>}
        />
      ) : <>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tabs label="Income type" value={tab} onChange={setTab} tabs={[
            { key: 'all', label: 'All' }, { key: 'dividend', label: 'Dividends' }, { key: 'interest', label: 'Interest' },
            { key: 'coupon', label: 'Coupons' }, { key: 'rent', label: 'Rent' },
          ]} />
          <label style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>
            Year{' '}
            <select value={String(year)} onChange={e => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg2)' }}>
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>

        <MetricCards cards={[
          { label: 'Gross', value: fmtCZK(sum('grossCZK')), accent: 'var(--c-income)', note: `${shown.length} payments` },
          { label: 'Tax withheld', value: sum('taxCZK') > 0 ? `−${fmtCZK(sum('taxCZK'))}` : fmtCZK(0), accent: 'var(--red)' },
          { label: 'Net received', value: fmtCZK(sum('netCZK')), accent: 'var(--green)' },
          ...(['dividend', 'interest', 'coupon', 'rent'] as Stream[])
            .filter(s => tab === 'all' && shown.some(r => r.stream === s))
            .map(s => ({ label: `${STREAM_LABEL[s]}s, net`, value: fmtCZK(sum('netCZK', shown.filter(r => r.stream === s))), accent: STREAM_COLOR[s] })),
        ]} />
        {unfrozen > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
            ⓘ {unfrozen} older payment{unfrozen > 1 ? 's have' : ' has'} no payment-date rate and {unfrozen > 1 ? 'are' : 'is'} converted at today&apos;s rate
            — {unfrozen > 1 ? 'their' : 'its'} CZK value will move with the koruna.
          </div>
        )}

        <Panel title="Payments" padded={false}>
          {shown.length === 0
            ? <div style={{ padding: 24, color: 'var(--text3)', fontSize: 12, textAlign: 'center' }}>Nothing in this view.</div>
            : <DataTable caption="Income payments" columns={columns} rows={shown} rowKey={r => r.id} initialSort={{ key: 'date', dir: 'desc' }} />}
        </Panel>
      </>}
    </PageShell>
  )
}
