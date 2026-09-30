'use client'
import { useMemo, useState } from 'react'
import Badge from '@/components/Badge'
import TransactionModal from '@/components/TransactionModal'
import RecordModal from '@/components/RecordModal'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, Tabs, orDash, DASH } from '@/components/PageShell'
import SetupNotice from '@/components/SetupNotice'
import { useUndoableDelete } from '@/components/UndoToast'
import { Notice } from '@/components/FormFields'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import type { Transaction, TransactionType } from '@/lib/supabase'
import { fmtCZK, fmtSignedCZK, fmtNum, fetchHistoricalFx, fxRate, normalizeCurrencyCode } from '@/lib/fx'
import { fmtISODate, todayISO, yearOf } from '@/lib/date'
import { summarise, runningBalance, realizedPL, czkOf, backfillRows, backfillKey } from '@/lib/transactions'
import { deleteScoped, insertScoped } from '@/lib/db'
import { czechTaxView, CZ_PROCEEDS_EXEMPTION_CZK, CZ_TIME_TEST_CAP_CZK } from '@/lib/tax'
import { tdR, tdL, th, btnStyle, actionBtn, signColor } from '@/lib/ui'

/** Neutral type colours — gains/losses are carried by the sign of the amount, not the badge. */
const TYPE_COLORS: Record<TransactionType, string> = {
  buy: 'var(--text2)', sell: 'var(--text2)',
  deposit: 'var(--c-cash)', withdrawal: 'var(--c-cash)',
  dividend: 'var(--c-income)', interest: 'var(--c-income)', rent: 'var(--c-income)',
  fee: 'var(--text3)', tax: 'var(--text3)',
  transfer: 'var(--text3)', adjustment: 'var(--text3)', split: 'var(--text3)',
}

const ALL_TYPES = Object.keys(TYPE_COLORS) as TransactionType[]

export default function TransactionsPage() {
  const { transactions: allTxns, holdings, holdingLots, dividendsReceived, loading, reload, missingTables } = useAppData()
  const { activeProfile } = useProfile()
  const { schedule, pendingIds, toast } = useUndoableDelete()
  const transactions = useMemo(() => allTxns.filter(t => !pendingIds.has(t.id)), [allTxns, pendingIds])

  const [editing, setEditing] = useState<Transaction | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [recording, setRecording] = useState(false)
  const [method, setMethod] = useState<'fifo' | 'avg'>('fifo')
  const [notice, setNotice] = useState<string | null>(null)
  const [taxYear, setTaxYear] = useState(yearOf(todayISO()))
  const [typeFilter, setTypeFilter] = useState<TransactionType[]>([])
  const [externalOnly, setExternalOnly] = useState(false)
  const [symbolFilter, setSymbolFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [seeding, setSeeding] = useState(false)

  const currentYear = yearOf(todayISO())

  const filtered = useMemo(() => transactions.filter(t => {
    if (typeFilter.length > 0 && !typeFilter.includes(t.type)) return false
    if (externalOnly && !t.is_external) return false
    if (symbolFilter && !(t.symbol ?? '').toLowerCase().includes(symbolFilter.toLowerCase())) return false
    if (fromDate && t.txn_date < fromDate) return false
    if (toDate && t.txn_date > toDate) return false
    return true
  }), [transactions, typeFilter, externalOnly, symbolFilter, fromDate, toDate])

  // Summaries always run over the full history: realized P&L needs the buy
  // rows that establish cost basis, which a filtered view would hide.
  const summary = useMemo(() => summarise(transactions, currentYear), [transactions, currentYear])
  const balances = useMemo(() => runningBalance(transactions), [transactions])
  const lots = useMemo(() => realizedPL(transactions, method), [transactions, method])

  // Deleting a ledger row does not undo its effect on a position or balance —
  // that is what editing the position/account is for.
  const remove = (t: Transaction) =>
    schedule(t.id, `${t.type} ${t.symbol ?? ''} ${fmtISODate(t.txn_date)}`,
      () => deleteScoped('transactions', t.id, activeProfile?.id), reload)

  /**
   * Backfill from existing holdings, purchase lots and logged dividends so the
   * ledger is not empty for someone who has been using the app already. One
   * buy per lot at that date's ECB rate; idempotent on a second run.
   */
  const seedFromHoldings = async () => {
    if (!activeProfile) return
    setSeeding(true)
    setNotice(null)
    try {
      const today = todayISO()
      const dates = new Set<string>()
      for (const l of holdingLots) if (l.purchase_date && l.fx_rate_czk == null) dates.add(l.purchase_date)
      for (const h of holdings) if (h.purchase_date) dates.add(h.purchase_date)
      for (const d of dividendsReceived) if (d.fx_rate_czk == null) dates.add(d.payment_date)
      const tables: Record<string, Record<string, number> | null> = {}
      const list = Array.from(dates)
      for (let i = 0; i < list.length; i += 6) {
        await Promise.all(list.slice(i, i + 6).map(async d => { tables[d] = (await fetchHistoricalFx(d))?.rates ?? null }))
      }
      const existingKeys = new Set(allTxns.filter(t => (t.notes ?? '').startsWith('backfilled'))
        .map(t => backfillKey(t.type, t.symbol, t.txn_date, t.quantity)))
      const { rows, skipped } = backfillRows({
        holdings, lots: holdingLots, dividends: dividendsReceived, existingKeys, today,
        rateOn: (ccy, date) => normalizeCurrencyCode(ccy) === 'CZK' ? 1 : tables[date] ? fxRate(ccy, tables[date]!) : null,
      })
      if (rows.length === 0 && skipped.length === 0) { setNotice('Nothing new to backfill — the ledger already covers these.'); return }
      const { error } = await insertScoped('transactions', activeProfile.id, rows)
      if (error) { setNotice(`Backfill failed: ${error}`); return }
      setNotice(`Added ${rows.length} rows at the exchange rate of each date.` +
        (skipped.length ? ` ${skipped.length} skipped — no historical rate for ${skipped.slice(0, 3).map(s => `${s.what} ${s.date}`).join(', ')}${skipped.length > 3 ? '…' : ''}. Add those by hand.` : ''))
      reload()
    } finally {
      setSeeding(false)
    }
  }

  if (loading) return <LoadingShell label="Loading ledger…" />

  const toggleType = (t: TransactionType) =>
    setTypeFilter(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])

  return (
    <PageShell>
      {toast}
      {recording && <RecordModal onClose={() => setRecording(false)} onSaved={reload} />}
      {(showAdd || editing) && (
        <TransactionModal
          transaction={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSaved={() => { setShowAdd(false); setEditing(null); reload() }}
        />
      )}

      <PageHeader
        eyebrow="Overview"
        title="Activity"
        subtitle={<>Every movement of money, so growth can be told apart from deposits · {transactions.length} rows · CZK frozen at each row&apos;s date</>}
        actions={<>
          <button type="button" onClick={seedFromHoldings} disabled={seeding} style={btnStyle('secondary')}>
            {seeding ? 'Seeding…' : '↺ Backfill from holdings'}
          </button>
          <button type="button" onClick={() => setShowAdd(true)} style={btnStyle('secondary')} title="Ledger-only row (rent, transfer, correction)">+ Ledger row</button>
          <button type="button" onClick={() => setRecording(true)} style={btnStyle('primary')}>+ Record</button>
        </>}
      />

      <SetupNotice tables={missingTables.filter(t => t === 'transactions')} />
      {notice && <Notice tone="blue">{notice}</Notice>}

      {transactions.length > 0 && (
        <MetricCards
          cards={[
            { label: `${currentYear} paid in`, value: fmtCZK(summary.totalContributedCZK), accent: 'var(--c-cash)', note: 'external money in' },
            { label: `${currentYear} taken out`, value: fmtCZK(summary.totalWithdrawnCZK), accent: 'var(--c-cash)', note: 'external money out' },
            { label: 'Net paid in', value: fmtSignedCZK(summary.netContributedCZK), accent: 'var(--c-cash)', note: 'in minus out' },
            {
              label: `Realised P&L ${currentYear}`,
              value: fmtSignedCZK(summary.realizedPLCZK),
              accent: signColor(summary.realizedPLCZK),
              color: signColor(summary.realizedPLCZK),
              note: `${lots.filter(l => yearOf(l.sellDate) === currentYear).length} lots sold`,
            },
            { label: `Fees ${currentYear}`, value: fmtCZK(summary.feesCZK), accent: 'var(--border3)', note: `tax ${fmtCZK(summary.taxCZK)}` },
          ]}
        />
      )}

      {transactions.length === 0 ? (
        <EmptyState
          icon="⇄"
          title="No transactions yet"
          body={
            <>
              Without a cash-flow record, a rise in net worth cannot be separated into
              &ldquo;the market went up&rdquo; and &ldquo;I paid money in&rdquo; — which is what
              makes an honest return figure possible.
              <br /><br />
              Use <strong>Record</strong> for buys, sells, dividends and deposits from now on — it updates the
              position and the ledger together. For what you already hold, backfill the ledger from your
              purchase lots (at each date&apos;s exchange rate).
            </>
          }
          action={
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <button type="button" onClick={seedFromHoldings} disabled={seeding} style={btnStyle('secondary')}>
                {seeding ? 'Seeding…' : '↺ Backfill from holdings'}
              </button>
              <button type="button" onClick={() => setRecording(true)} style={btnStyle('primary')}>+ Record</button>
            </span>
          }
        />
      ) : (
        <>
          {/* Filters */}
          <Panel title="Filters">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {ALL_TYPES.map(t => {
                const on = typeFilter.includes(t)
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => toggleType(t)} style={{
                    padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                    textTransform: 'capitalize',
                    background: on ? 'var(--bg4)' : 'var(--bg)',
                    border: `1px solid ${on ? TYPE_COLORS[t] : 'var(--border2)'}`,
                    color: on ? TYPE_COLORS[t] : 'var(--text3)',
                  }}>{t}</button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                style={{ ...inputSm }} aria-label="From date" />
              <span style={{ color: 'var(--text3)', fontSize: 11 }}>to</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                style={{ ...inputSm }} aria-label="To date" />
              <input placeholder="symbol" aria-label="Symbol" value={symbolFilter}
                onChange={e => setSymbolFilter(e.target.value)} style={{ ...inputSm, width: 110 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text3)', cursor: 'pointer' }}>
                <input type="checkbox" checked={externalOnly} onChange={e => setExternalOnly(e.target.checked)}
                  style={{ accentColor: 'var(--green)' }} />
                external only
              </label>
              {(typeFilter.length > 0 || externalOnly || symbolFilter || fromDate || toDate) && (
                <button
                  onClick={() => { setTypeFilter([]); setExternalOnly(false); setSymbolFilter(''); setFromDate(''); setToDate('') }}
                  style={{ ...btnStyle('secondary'), padding: '4px 10px', fontSize: 11 }}
                >Clear</button>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>
                {filtered.length} of {transactions.length}
              </span>
            </div>
          </Panel>

          <Panel title="Ledger" padded={false}>
            <div className="table-wrap" style={{ maxHeight: 640 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <caption className="sr-only">Transaction ledger</caption>
                <thead>
                  <tr>
                    {['Date', 'Type', 'Asset', 'Qty', 'Price', 'Amount', 'CZK', 'Fee', 'Running total', ''].map((h, i) => (
                      <th key={h || 'actions'} scope="col" style={{ ...th, textAlign: i <= 2 ? 'left' : i === 9 ? 'center' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                      No rows match these filters.
                    </td></tr>
                  )}
                  {filtered.map(t => {
                    const czk = czkOf(t)
                    return (
                      <tr key={t.id}>
                        <td style={tdL}>{fmtISODate(t.txn_date)}</td>
                        <td style={tdL}>
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 4,
                            background: TYPE_COLORS[t.type] + '18', color: TYPE_COLORS[t.type],
                            border: `1px solid ${TYPE_COLORS[t.type]}30`, textTransform: 'capitalize',
                          }}>{t.type}</span>
                          {t.is_external && (
                            <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--text3)' }} title="External: money crossing the boundary of your wealth">external</span>
                          )}
                        </td>
                        <td style={tdL}>
                          <span style={{ fontWeight: 500 }}>{t.symbol ?? '—'}</span>
                          {t.notes && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{t.notes}</div>}
                        </td>
                        <td style={tdR}>{orDash(t.quantity, n => fmtNum(n, 4))}</td>
                        <td style={tdR}>{orDash(t.price, n => fmtNum(n, 2))}</td>
                        <td className="num" style={{ ...tdR }}>
                          {t.amount > 0 ? '+' : t.amount < 0 ? '−' : ''}{fmtNum(Math.abs(t.amount), 2)} <span style={{ fontSize: 10, color: 'var(--text3)' }}>{t.currency}</span>
                        </td>
                        <td className="num" style={{ ...tdR }}>{fmtSignedCZK(czk)}</td>
                        <td className="num" style={{ ...tdR, color: 'var(--text3)' }}>{t.fee ? fmtNum(t.fee, 2) : '—'}</td>
                        <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--text3)' }}>
                          {fmtCZK(balances.get(t.id) ?? 0, 0)}
                        </td>
                        <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button type="button" aria-label={`Edit ${t.type} on ${fmtISODate(t.txn_date)}`} title="Edit ledger row" onClick={() => setEditing(t)} style={actionBtn}>✎</button>
                          <button type="button" aria-label={`Delete ${t.type} on ${fmtISODate(t.txn_date)}`} title="Delete ledger row (does not change the position)" onClick={() => remove(t)} style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}>✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {lots.length > 0 && (
            <TaxPanel transactions={transactions} year={taxYear} setYear={setTaxYear}
              years={Array.from(new Set(lots.map(l => yearOf(l.sellDate)))).sort((a, b) => b - a)} />
          )}

          {lots.length > 0 && (
            <Panel title="Realised lots" right={
              <Tabs label="Matching method" value={method} onChange={setMethod}
                tabs={[{ key: 'fifo', label: 'FIFO' }, { key: 'avg', label: 'Average cost' }]} />
            } padded={false}>
              {lots.some(l => l.basisIncomplete) && (
                <div style={{
                  background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)',
                  color: 'var(--amber)', padding: '9px 14px', margin: '0 0 2px',
                  fontSize: 11, lineHeight: 1.6,
                }}>
                  ⚠ Some sales have no matching purchase in the ledger, so their cost basis is
                  counted as zero and realized P&amp;L is overstated for those rows. Add the original
                  buy transactions to correct it — the affected rows are marked below.
                </div>
              )}
              <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <caption className="sr-only">Realised lots</caption>
                <thead>
                  <tr>
                    {['Symbol', 'Sold', 'Shares', 'Cost', 'Proceeds', 'Gain', 'Gain (CZK)', 'of which FX', 'Held'].map((h, i) => (
                      <th key={h} scope="col" style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lots.slice(0, 25).map((l, i) => (
                    <tr key={i}>
                      <td style={tdL}>
                        {l.symbol}
                        {l.basisIncomplete && (
                          <span
                            style={{ marginLeft: 5 }}
                            title="No purchase on record for these shares, so the cost basis is counted as zero and the gain is overstated. Add the original buy to fix it."
                          >
                            <Badge variant="amber">no basis</Badge>
                          </span>
                        )}
                      </td>
                      <td style={tdR}>{fmtISODate(l.sellDate)}</td>
                      <td style={tdR}>{fmtNum(l.shares, 4)}</td>
                      <td style={tdR}>{fmtNum(l.costLocal, 2)}</td>
                      <td style={tdR}>{fmtNum(l.proceedsLocal, 2)}</td>
                      <td className="num" style={{ ...tdR, color: signColor(l.gainLocal) }}>
                        {l.gainLocal > 0 ? '+' : l.gainLocal < 0 ? '−' : ''}{fmtNum(Math.abs(l.gainLocal), 2)} {l.currency}
                      </td>
                      <td className="num" style={{ ...tdR, color: signColor(l.gainCZK) }}>
                        {fmtSignedCZK(l.gainCZK)}
                      </td>
                      <td
                        style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--text3)' }}
                        title="Cost converted at the rate on the buy date, proceeds at the rate on the sell date. This column is the difference the koruna made."
                      >
                        {Math.abs(l.fxGainCZK) < 1 ? DASH : fmtSignedCZK(l.fxGainCZK)}
                      </td>
                      <td style={tdR}>
                        {Math.round(l.holdingDays / 30)}mo
                        {l.passesTimeTest && (
                          <span style={{ marginLeft: 5 }} title="Held more than 3 years — meets the Czech time test (§4(1)(w) ZDP). Confirm with a tax adviser.">
                            <Badge variant="green">&gt;3y</Badge>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </PageShell>
  )
}

const inputSm: React.CSSProperties = {
  padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border2)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 11,
  fontFamily: "'Inter', sans-serif",
}


function TaxPanel({ transactions, year, setYear, years }: {
  transactions: Transaction[]; year: number; setYear: (y: number) => void; years: number[]
}) {
  const view = useMemo(() => czechTaxView(transactions, year), [transactions, year])
  const label = { stock: 'Securities', crypto: 'Crypto', bond: 'Bonds' } as const
  return (
    <Panel title={`Czech tax view · ${year}`} right={
      <select aria-label="Tax year" value={year} onChange={e => setYear(Number(e.target.value))}
        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg2)', fontSize: 12 }}>
        {Array.from(new Set([year, ...years])).sort((a, b) => b - a).map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    }>
      {view.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>No sales recorded in {year}.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {view.map(v => (
            <div key={v.assetClass} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, fontSize: 12 }}>
              <div><div style={{ color: 'var(--text3)', fontSize: 11 }}>{label[v.assetClass]} · gross proceeds</div>
                <div className="num">{fmtCZK(v.proceedsCZK)}</div>
                <div style={{ fontSize: 11, color: v.underProceedsLimit ? 'var(--green)' : 'var(--text3)' }}>
                  {v.underProceedsLimit ? `≤ ${fmtCZK(CZ_PROCEEDS_EXEMPTION_CZK)} — gains may be exempt (§4(1)(x))` : `over the ${fmtCZK(CZ_PROCEEDS_EXEMPTION_CZK)} limit`}
                </div></div>
              <div><div style={{ color: 'var(--text3)', fontSize: 11 }}>Held &gt; 3 years (time test)</div>
                <div className="num" style={{ color: signColor(v.timeTestedGainCZK) }}>{fmtSignedCZK(v.timeTestedGainCZK)}</div>
                {v.timeTestedProceedsCZK > CZ_TIME_TEST_CAP_CZK && <div style={{ fontSize: 11, color: 'var(--amber)' }}>proceeds above the 40 M CZK cap</div>}</div>
              <div><div style={{ color: 'var(--text3)', fontSize: 11 }}>Held ≤ 3 years</div>
                <div className="num" style={{ color: signColor(v.otherGainCZK) }}>{fmtSignedCZK(v.otherGainCZK)}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{v.underProceedsLimit ? 'exempt under the value test' : 'taxable (§10)'}</div></div>
              {v.incompleteLots > 0 && <div style={{ fontSize: 11, color: 'var(--amber)' }}>⚠ {v.incompleteLots} lot{v.incompleteLots > 1 ? 's' : ''} without a recorded purchase — gain overstated</div>}
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
            Informational — how the app reads the value test and the 3-year time test; not tax advice. Gains are in CZK with each
            leg at its own date&apos;s rate (ECB reference rates; the Czech return may require ČNB rates or the annual uniform rate).
            Confirm with a tax adviser.
          </div>
        </div>
      )}
    </Panel>
  )
}
