'use client'
import { useMemo, useState } from 'react'
import Badge from '@/components/Badge'
import TransactionModal from '@/components/TransactionModal'
import { PageShell, PageHeader, LoadingShell, EmptyState, MetricCards, Panel, orDash, DASH } from '@/components/PageShell'
import SetupNotice from '@/components/SetupNotice'
import { useAppData } from '@/hooks/useAppData'
import { useFx } from '@/hooks/useFx'
import { useProfile } from '@/lib/profile'
import { supabase, type Transaction, type TransactionType } from '@/lib/supabase'
import { fmtCZK, fmtNum, toCZK } from '@/lib/fx'
import { fmtISODate, todayISO, yearOf } from '@/lib/date'
import { summarise, runningBalance, realizedPL } from '@/lib/transactions'
import { tdR, tdL, th, btnStyle, actionBtn } from '@/lib/ui'

const TYPE_COLORS: Record<TransactionType, string> = {
  buy: 'var(--green)', sell: 'var(--red)',
  deposit: 'var(--blue)', withdrawal: 'var(--amber)',
  dividend: 'var(--green)', interest: 'var(--blue)', rent: 'var(--teal)',
  fee: 'var(--red)', tax: 'var(--red)',
  transfer: 'var(--text3)', adjustment: 'var(--text3)',
}

const ALL_TYPES = Object.keys(TYPE_COLORS) as TransactionType[]

export default function TransactionsPage() {
  const { transactions, holdings, dividendsReceived, loading, reload, missingTables } = useAppData()
  const { activeProfile } = useProfile()
  const { fx } = useFx()

  const [editing, setEditing] = useState<Transaction | null>(null)
  const [showAdd, setShowAdd] = useState(false)
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
  const lots = useMemo(() => realizedPL(transactions), [transactions])

  const remove = async (t: Transaction) => {
    if (!confirm(`Delete this ${t.type} on ${fmtISODate(t.txn_date)}? This cannot be undone.`)) return
    const { error } = await supabase.from('transactions').delete().eq('id', t.id)
    if (error) { alert(`Could not delete: ${error.message}`); return }
    reload()
  }

  /**
   * Backfill from existing holdings and dividends so the ledger is not empty
   * for someone who has been using the app already. Idempotent: rows are
   * tagged and skipped on a second run.
   */
  const seedFromHoldings = async () => {
    if (!activeProfile) return
    if (!confirm('Create transaction rows from your existing holdings and logged dividends?')) return
    setSeeding(true)
    try {
      const existing = new Set(
        transactions.filter(t => t.notes === 'backfilled')
          .map(t => `${t.type}::${t.symbol}::${t.txn_date}`)
      )
      const rows: Record<string, unknown>[] = []

      for (const h of holdings) {
        const date = h.purchase_date ?? todayISO()
        const key = `buy::${h.symbol}::${date}`
        if (existing.has(key)) continue
        rows.push({
          profile_id: activeProfile.id, txn_date: date, type: 'buy', asset_class: 'stock',
          symbol: h.symbol, asset_id: h.id, quantity: h.shares, price: h.avg_price,
          amount: -(h.shares * h.avg_price), currency: h.currency,
          fx_rate_czk: toCZK(1, h.currency, fx), is_external: false, notes: 'backfilled',
        })
      }

      for (const d of dividendsReceived) {
        const key = `dividend::${d.symbol}::${d.payment_date}`
        if (existing.has(key)) continue
        rows.push({
          profile_id: activeProfile.id, txn_date: d.payment_date, type: 'dividend',
          asset_class: 'stock', symbol: d.symbol, quantity: d.shares_held,
          price: d.amount_per_share, amount: d.gross_amount, tax: d.withholding_tax ?? 0,
          currency: d.currency, fx_rate_czk: toCZK(1, d.currency, fx),
          is_external: false, notes: 'backfilled',
        })
      }

      if (rows.length === 0) { alert('Nothing new to backfill — the ledger already covers these.'); return }
      const { error } = await supabase.from('transactions').insert(rows)
      if (error) { alert(`Backfill failed: ${error.message}`); return }
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
      {(showAdd || editing) && (
        <TransactionModal
          transaction={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSaved={() => { setShowAdd(false); setEditing(null); reload() }}
        />
      )}

      <PageHeader
        title="Transactions"
        subtitle={
          <>
            Every movement of money, so growth can be told apart from deposits.
            {' '}{transactions.length} rows · CZK frozen at transaction date
          </>
        }
        actions={
          <>
            <button onClick={seedFromHoldings} disabled={seeding} style={btnStyle('secondary')}>
              {seeding ? 'Seeding…' : '↺ Seed from holdings'}
            </button>
            <button onClick={() => setShowAdd(true)} style={btnStyle('primary')}>+ Add transaction</button>
          </>
        }
      />

      <SetupNotice tables={missingTables.filter(t => t === 'transactions')} />

      <MetricCards
        columns={5}
        cards={[
          { label: `${currentYear} contributed`, value: fmtCZK(summary.totalContributedCZK), accent: 'var(--blue)', note: 'external money in' },
          { label: `${currentYear} withdrawn`, value: fmtCZK(summary.totalWithdrawnCZK), accent: 'var(--amber)', note: 'external money out' },
          { label: 'Net contributed', value: fmtCZK(summary.netContributedCZK), accent: 'var(--blue)', note: 'in minus out' },
          {
            label: `Realized P&L ${currentYear}`,
            value: fmtCZK(summary.realizedPLCZK),
            accent: summary.realizedPLCZK >= 0 ? 'var(--green)' : 'var(--red)',
            color: summary.realizedPLCZK >= 0 ? 'var(--green)' : 'var(--red)',
            note: `${lots.filter(l => yearOf(l.sellDate) === currentYear).length} lots sold`,
          },
          { label: `Fees ${currentYear}`, value: fmtCZK(summary.feesCZK), accent: 'var(--red)', note: `tax ${fmtCZK(summary.taxCZK)}` },
        ]}
      />

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
              Add rows manually, or seed the ledger from the holdings and dividends you have
              already recorded.
            </>
          }
          action={
            <button onClick={seedFromHoldings} disabled={seeding} style={btnStyle('primary')}>
              {seeding ? 'Seeding…' : '↺ Seed from existing holdings'}
            </button>
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
                  <button key={t} onClick={() => toggleType(t)} style={{
                    padding: '3px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
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
                style={{ ...inputSm }} title="From date" />
              <span style={{ color: 'var(--text4)', fontSize: 11 }}>to</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                style={{ ...inputSm }} title="To date" />
              <input placeholder="symbol" value={symbolFilter}
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
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text4)' }}>
                {filtered.length} of {transactions.length}
              </span>
            </div>
          </Panel>

          <Panel title="Ledger" padded={false}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Date', 'Type', 'Asset', 'Qty', 'Price', 'Amount', 'CZK', 'Fee', 'Balance', ''].map((h, i) => (
                      <th key={h} style={{ ...th, textAlign: i <= 2 ? 'left' : i === 9 ? 'center' : 'right' }}>{h}</th>
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
                    const czk = isFinite(t.amount_czk) ? t.amount_czk : t.amount * t.fx_rate_czk
                    return (
                      <tr key={t.id}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <td style={tdL}>{fmtISODate(t.txn_date)}</td>
                        <td style={tdL}>
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 4,
                            background: TYPE_COLORS[t.type] + '18', color: TYPE_COLORS[t.type],
                            border: `1px solid ${TYPE_COLORS[t.type]}30`, textTransform: 'capitalize',
                          }}>{t.type}</span>
                          {t.is_external && (
                            <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--text4)' }} title="External: money crossing the boundary of your wealth">ext</span>
                          )}
                        </td>
                        <td style={tdL}>
                          <span style={{ fontWeight: 500 }}>{t.symbol ?? '—'}</span>
                          {t.notes && <div style={{ fontSize: 9, color: 'var(--text4)' }}>{t.notes}</div>}
                        </td>
                        <td style={tdR}>{orDash(t.quantity, n => fmtNum(n, 4))}</td>
                        <td style={tdR}>{orDash(t.price, n => fmtNum(n, 2))}</td>
                        <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: t.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {t.amount >= 0 ? '+' : ''}{fmtNum(t.amount, 2)} <span style={{ fontSize: 9, color: 'var(--text4)' }}>{t.currency}</span>
                        </td>
                        <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(czk, 0)}</td>
                        <td style={{ ...tdR, color: 'var(--text4)' }}>{t.fee ? fmtNum(t.fee, 2) : '—'}</td>
                        <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--text3)' }}>
                          {fmtCZK(balances.get(t.id) ?? 0, 0)}
                        </td>
                        <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button title="Edit" onClick={() => setEditing(t)} style={actionBtn}>✎</button>
                          <button title="Delete" onClick={() => remove(t)} style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}>✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {lots.length > 0 && (
            <Panel title="Realized lots" right={<Badge variant="gray">FIFO</Badge>} padded={false}>
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
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Symbol', 'Sold', 'Shares', 'Cost', 'Proceeds', 'Gain', 'Gain (CZK)', 'of which FX', 'Held'].map((h, i) => (
                      <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
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
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: l.gainLocal >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {l.gainLocal >= 0 ? '+' : ''}{fmtNum(l.gainLocal, 2)} {l.currency}
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: l.gainCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {fmtCZK(l.gainCZK, 0)}
                      </td>
                      <td
                        style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--text3)' }}
                        title="Cost converted at the rate on the buy date, proceeds at the rate on the sell date. This column is the difference the koruna made."
                      >
                        {Math.abs(l.fxGainCZK) < 1 ? DASH : fmtCZK(l.fxGainCZK, 0)}
                      </td>
                      <td style={tdR}>
                        {Math.round(l.holdingDays / 30)}mo
                        {l.passesTimeTest && (
                          <span style={{ marginLeft: 5 }} title="Held 3+ years — passes the Czech time test">
                            <Badge variant="green">3y</Badge>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
  fontFamily: "'Inter', sans-serif", outline: 'none',
}
