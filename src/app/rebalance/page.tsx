'use client'
import { useEffect, useMemo, useState } from 'react'
import Badge from '@/components/Badge'
import { PageShell, PageHeader, LoadingShell, EmptyState, Panel } from '@/components/PageShell'
import SetupNotice from '@/components/SetupNotice'
import { useAppData } from '@/hooks/useAppData'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { useProfile } from '@/lib/profile'
import { buildPositions } from '@/lib/portfolio'
import { computeDrift, allocateContribution, fullRebalanceTrades, targetsSum } from '@/lib/rebalance'
import { supabase, type TargetScope } from '@/lib/supabase'
import { fmtCZK } from '@/lib/fx'
import { tdR, tdL, th, btnStyle, actionBtn, inputStyle } from '@/lib/ui'

const SCOPES: { key: TargetScope; label: string }[] = [
  { key: 'asset_class', label: 'Asset class' },
  { key: 'sector', label: 'Sector' },
  { key: 'region', label: 'Region' },
  { key: 'symbol', label: 'Symbol' },
]

const STATUS_COLORS = { ok: 'var(--green)', watch: 'var(--amber)', breach: 'var(--red)' }

export default function RebalancePage() {
  const data = useAppData()
  const missingTables = data.missingTables.filter(t => t === 'allocation_targets')
  const { fx } = useFx()
  const market = useMarketData()
  const crypto = useCryptoPrices()
  const { activeProfile } = useProfile()

  const [scope, setScope] = useState<TargetScope>('asset_class')
  const [contribution, setContribution] = useState('20000')
  const [showFull, setShowFull] = useState(false)
  const [editTargets, setEditTargets] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [newBucket, setNewBucket] = useState('')

  const symbolKey = data.holdings.map(h => h.symbol).join(',')
  const coinKey = data.cryptoHoldings.map(c => c.coin_id).join(',')
  useEffect(() => { if (symbolKey) market.refresh(symbolKey.split(',')) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbolKey])
  useEffect(() => { if (coinKey) crypto.refresh(coinKey.split(',')) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coinKey])

  const positions = useMemo(
    () => buildPositions(data, fx, market, crypto),
    [data, fx, market, crypto]
  )

  const drift = useMemo(
    () => computeDrift(positions, data.allocationTargets, scope),
    [positions, data.allocationTargets, scope]
  )

  const amount = parseFloat(contribution)
  const split = useMemo(
    () => (isFinite(amount) && amount > 0 ? allocateContribution(drift, amount) : []),
    [drift, amount]
  )
  const trades = useMemo(() => fullRebalanceTrades(drift), [drift])
  const sum = targetsSum(data.allocationTargets, scope)
  const hasTargets = data.allocationTargets.some(t => t.scope === scope)

  // Buckets worth offering even when you hold none of them yet — you cannot set
  // a target for an asset class you are trying to start building otherwise.
  const suggestedBuckets = useMemo(() => {
    const present = new Set(drift.map(d => d.bucket))
    const candidates = scope === 'asset_class'
      ? ['stock', 'etf', 'cash', 'crypto', 'realestate']
      : scope === 'region'
        ? ['US', 'EU', 'CZ', 'UK', 'Global', 'EM']
        : scope === 'sector'
          ? Array.from(new Set(data.assetMetadata.map(m => m.sector).filter((x): x is string => !!x)))
          : data.holdings.map(h => h.symbol)
    return candidates.filter(c => !present.has(c))
  }, [scope, drift, data.assetMetadata, data.holdings])

  const saveTargets = async () => {
    if (!activeProfile) return
    setSaving(true)
    try {
      const rows = Object.entries(draft)
        .map(([bucket, pct]) => ({ bucket, value: parseFloat(pct) }))
        .filter(r => isFinite(r.value) && r.value >= 0)
        .map(r => ({
          profile_id: activeProfile.id, scope, bucket: r.bucket,
          target_pct: r.value / 100, band_pct: 0.05, updated_at: new Date().toISOString(),
        }))
      if (rows.length === 0) { setEditTargets(false); return }
      const { error } = await supabase.from('allocation_targets')
        .upsert(rows, { onConflict: 'profile_id,scope,bucket' })
      if (error) { alert(`Could not save targets: ${error.message}`); return }
      setEditTargets(false)
      setDraft({})
      data.reload()
    } finally {
      setSaving(false)
    }
  }

  const removeTarget = async (bucket: string) => {
    if (!activeProfile) return
    const { error } = await supabase.from('allocation_targets').delete()
      .eq('profile_id', activeProfile.id).eq('scope', scope).eq('bucket', bucket)
    if (error) { alert(`Could not remove: ${error.message}`); return }
    data.reload()
  }

  if (data.loading) return <LoadingShell label="Loading targets…" />

  const startEditing = () => {
    const initial: Record<string, string> = {}
    for (const row of drift) initial[row.bucket] = (row.targetPct * 100).toFixed(1)
    setDraft(initial)
    setEditTargets(true)
  }

  // Rows to render: everything you hold, plus any bucket added by hand during
  // this edit that has no position behind it yet.
  const editableRows = editTargets
    ? [
        ...drift,
        ...Object.keys(draft)
          .filter(b => !drift.some(d => d.bucket === b))
          .map(bucket => ({
            bucket, currentCZK: 0, currentPct: 0, targetPct: 0,
            driftPct: 0, bandPct: 0.05, status: 'ok' as const, deltaCZK: 0,
          })),
      ]
    : drift

  const addBucket = (bucket: string) => {
    const clean = bucket.trim()
    if (!clean) return
    setDraft(d => ({ ...d, [clean]: d[clean] ?? '0' }))
    setNewBucket('')
    setEditTargets(true)
  }

  return (
    <PageShell maxWidth={1100}>
      <PageHeader
        title="Rebalance"
        subtitle="Drift against target weights, and where to put new money"
        actions={
          <button onClick={editTargets ? saveTargets : startEditing}
            disabled={saving} style={btnStyle(editTargets ? 'primary' : 'secondary')}>
            {saving ? 'Saving…' : editTargets ? 'Save targets' : '✎ Edit targets'}
          </button>
        }
      />

      <SetupNotice tables={missingTables} />

      {/* Scope tabs */}
      <div style={{ display: 'flex', border: '1px solid var(--border2)', borderRadius: 6, overflow: 'hidden', marginBottom: 16, width: 'fit-content' }}>
        {SCOPES.map(s => (
          <button key={s.key} onClick={() => { setScope(s.key); setEditTargets(false) }} style={{
            padding: '6px 16px', border: 'none', cursor: 'pointer', fontSize: 12,
            background: scope === s.key ? 'var(--green-bg)' : 'var(--bg2)',
            color: scope === s.key ? 'var(--green)' : 'var(--text3)',
            fontFamily: "'Geist', sans-serif",
            borderRight: s.key !== 'symbol' ? '1px solid var(--border2)' : 'none',
          }}>{s.label}</button>
        ))}
      </div>

      {positions.length === 0 ? (
        <EmptyState icon="⚖" title="No positions to rebalance"
          body="Add holdings, cash, crypto or property first — rebalancing needs something to weigh." />
      ) : !hasTargets && !editTargets ? (
        <EmptyState
          icon="⚖"
          title={`No ${SCOPES.find(s => s.key === scope)!.label.toLowerCase()} targets set`}
          body={
            <>
              Set the weights you are aiming for and this page will show how far the portfolio has
              drifted, and how to steer it back by directing new contributions — without selling,
              which can realize taxable gains and break the Czech 3-year time test.
            </>
          }
          action={<button onClick={startEditing} style={btnStyle('primary')}>Set targets</button>}
        />
      ) : (
        <>
          {/* Contribution allocator — the centrepiece */}
          <div style={{
            background: 'var(--bg2)', border: '1px solid var(--green-bd)', borderRadius: 12,
            padding: '20px 24px', marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--green)', fontWeight: 600, marginBottom: 12 }}>
              Where should new money go?
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>I have</span>
              <input
                type="number" value={contribution} onChange={e => setContribution(e.target.value)}
                style={{ ...inputStyle, width: 160, fontSize: 16, fontFamily: "'DM Mono', monospace" }}
              />
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>CZK to invest</span>
            </div>

            {split.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.7 }}>
                {!isFinite(amount) || amount <= 0
                  ? 'Enter an amount to see the suggested split.'
                  : 'Nothing is underweight against target, so there is no gap to fill. Consider whether the targets still reflect what you want.'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Bucket', 'Buy', 'Share of contribution', 'Weight after'].map((h, i) => (
                      <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {split.map(s => {
                    const target = drift.find(d => d.bucket === s.bucket)
                    return (
                      <tr key={s.bucket}>
                        <td style={tdL}><span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{s.bucket}</span></td>
                        <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--green)', fontWeight: 500 }}>
                          {fmtCZK(s.amountCZK)}
                        </td>
                        <td style={{ ...tdR, color: 'var(--text3)' }}>
                          {((s.amountCZK / amount) * 100).toFixed(1)}%
                        </td>
                        <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>
                          {(s.newPct * 100).toFixed(1)}%
                          {target && (
                            <span style={{ fontSize: 10, color: 'var(--text4)', marginLeft: 5 }}>
                              → {(target.targetPct * 100).toFixed(0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  <tr style={{ background: 'var(--bg3)' }}>
                    <td style={{ ...tdL, fontWeight: 600, borderTop: '1px solid var(--border)' }}>Total</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontWeight: 600, borderTop: '1px solid var(--border)' }}>
                      {fmtCZK(split.reduce((s, r) => s + r.amountCZK, 0))}
                    </td>
                    <td colSpan={2} style={{ borderTop: '1px solid var(--border)' }} />
                  </tr>
                </tbody>
              </table>
            )}
            <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text4)', lineHeight: 1.6 }}>
              Allocations below 2 000 CZK are dropped and redistributed — not worth a trade fee.
              No sells are ever suggested here.
            </div>
          </div>

          {/* Drift */}
          <Panel
            title="Drift against target"
            right={
              <span style={{ fontSize: 10, color: Math.abs(sum - 1) < 0.005 ? 'var(--green)' : 'var(--amber)' }}>
                targets sum to {(sum * 100).toFixed(1)}%
              </span>
            }
            padded={false}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Bucket', 'Current', 'Current %', 'Target %', 'Drift', 'To target', ''].map((h, i) => (
                    <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {editableRows.map(row => (
                  <tr key={row.bucket}>
                    <td style={tdL}>
                      <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{row.bucket}</span>
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(row.currentCZK)}</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{(row.currentPct * 100).toFixed(1)}%</td>
                    <td style={{ ...tdR }}>
                      {editTargets ? (
                        <input
                          type="number" step="0.1"
                          value={draft[row.bucket] ?? ''}
                          onChange={e => setDraft(d => ({ ...d, [row.bucket]: e.target.value }))}
                          style={{ ...inputStyle, width: 70, textAlign: 'right', padding: '4px 6px', fontSize: 11 }}
                        />
                      ) : (
                        <span style={{ fontFamily: "'DM Mono', monospace" }}>{(row.targetPct * 100).toFixed(1)}%</span>
                      )}
                    </td>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                      {/* Diverging bar from centre: left = under target, right = over */}
                      <div style={{ position: 'relative', height: 6, background: 'var(--bg3)', borderRadius: 3 }}>
                        <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--border2)' }} />
                        <div style={{
                          position: 'absolute', top: 0, bottom: 0, borderRadius: 3,
                          background: STATUS_COLORS[row.status], opacity: 0.85,
                          left: row.driftPct >= 0 ? '50%' : `${50 - Math.min(Math.abs(row.driftPct) * 100 * 2, 50)}%`,
                          width: `${Math.min(Math.abs(row.driftPct) * 100 * 2, 50)}%`,
                        }} />
                      </div>
                      <div style={{ fontSize: 9, textAlign: 'center', marginTop: 3, color: STATUS_COLORS[row.status] }}>
                        {row.driftPct >= 0 ? '+' : ''}{(row.driftPct * 100).toFixed(1)}pp
                      </div>
                    </td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: row.deltaCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {row.deltaCZK >= 0 ? '+' : ''}{fmtCZK(row.deltaCZK)}
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                      {row.targetPct > 0 && !editTargets && (
                        <button title="Remove target" onClick={() => removeTarget(row.bucket)}
                          style={{ ...actionBtn, color: 'var(--red)' }}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {editTargets && (
              <div style={{
                padding: '12px 18px', borderTop: '1px solid var(--border)',
                display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>Add a bucket you don&rsquo;t hold yet:</span>
                {suggestedBuckets.slice(0, 8).map(b => (
                  <button key={b} onClick={() => addBucket(b)} style={{
                    padding: '3px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                    background: 'var(--bg3)', border: '1px solid var(--border2)',
                    color: 'var(--text2)', textTransform: 'capitalize',
                  }}>+ {b}</button>
                ))}
                <input
                  placeholder="or type one" value={newBucket}
                  onChange={e => setNewBucket(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addBucket(newBucket) }}
                  style={{ ...inputStyle, width: 140, padding: '4px 8px', fontSize: 11 }}
                />
              </div>
            )}
          </Panel>

          {/* Full rebalance behind a toggle */}
          <Panel
            title="Full rebalance (includes sells)"
            right={
              <button onClick={() => setShowFull(f => !f)} style={{ ...btnStyle('secondary'), padding: '4px 12px', fontSize: 11 }}>
                {showFull ? 'Hide' : 'Show'}
              </button>
            }
          >
            {!showFull ? (
              <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.7 }}>
                Hidden by default. Selling to rebalance realizes gains, which are taxable and can
                break the Czech 3-year time test — directing new contributions is usually the
                cheaper way to the same place.
              </div>
            ) : trades.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                Every bucket is within one trade ticket of its target. Nothing worth doing.
              </div>
            ) : (
              <>
                <div style={{
                  background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)', borderRadius: 7,
                  padding: '10px 14px', marginBottom: 14, fontSize: 11, color: 'var(--amber)', lineHeight: 1.6,
                }}>
                  ⚠ Sells may realize taxable gains. In Czechia, disposing of securities held under
                  three years forfeits the time-test exemption on that lot.
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>{['Bucket', 'Action', 'Amount'].map((h, i) => (
                      <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {trades.map(t => (
                      <tr key={t.bucket}>
                        <td style={tdL}><span style={{ textTransform: 'capitalize' }}>{t.bucket}</span></td>
                        <td style={{ ...tdR }}>
                          <Badge variant={t.action === 'buy' ? 'green' : 'red'}>{t.action}</Badge>
                        </td>
                        <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(t.amountCZK)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Panel>
        </>
      )}
    </PageShell>
  )
}
