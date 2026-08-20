'use client'
import { useMemo, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import SetupNotice from '@/components/SetupNotice'
import { supabase, Bond, BondType, DayCount } from '@/lib/supabase'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import { useFx } from '@/hooks/useFx'
import { toCZK, fmtCZK, fmtNum, fmtDate, DASH } from '@/lib/fx'
import {
  valueBond, bondTotals, upcomingCoupons, parseISO, accruedInterestOn, splitAllInPrice,
  BOND_TYPE_LABELS, BOND_TYPE_COLORS, COUPON_FREQUENCY_LABELS,
  type BondValuation,
} from '@/lib/bonds'
import {
  cardStyle, cardLabelStyle, tableHeader, tableHeaderLabel,
  th, tdL, tdR, actionBtn, btnSecondary, btnPrimary, inputStyle, inputLabel,
} from '@/lib/ui'

const ACCENT = 'var(--blue)'

const emptyForm = {
  name: '',
  issuer: '',
  isin: '',
  bond_type: 'government' as BondType,
  country: '',
  currency: 'EUR',
  face_value: '1',
  quantity: '',
  purchase_price_pct: '100',
  /**
   * Whether `purchase_price_pct` as typed includes the coupon couru.
   * Not stored — the database always holds a clean price; this only says how to
   * read what was entered, and many retail contract notes quote all-in.
   */
  price_basis: 'clean' as 'clean' | 'all_in',
  current_price_pct: '',
  coupon_rate: '',
  coupons_per_year: '1',
  day_count: 'ACT/ACT' as DayCount,
  issue_date: '',
  maturity_date: '',
  purchase_date: '',
  accrued_at_purchase: '',
  withholding_tax_pct: '',
  is_inflation_linked: false,
  index_ratio: '1',
  notes: '',
}

type Form = typeof emptyForm

/**
 * Defaults for a French government bond. An OAT is quoted per €1 of nominal,
 * pays one coupon a year and accrues ACT/ACT — every one of which differs from
 * what a US corporate issue would want, so guessing them wrong is silent and
 * expensive.
 */
const OAT_PRESET: Partial<Form> = {
  issuer: 'République Française (AFT)',
  bond_type: 'government',
  country: 'FR',
  currency: 'EUR',
  face_value: '1',
  coupons_per_year: '1',
  day_count: 'ACT/ACT',
}

export default function BondsPage() {
  const { bonds, loading, reload, missingTables } = useAppData()
  const { activeProfile } = useProfile()
  const { fx, fxLoading, fxTs, refresh: refreshFx } = useFx()

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [form, setForm]         = useState<Form>(emptyForm)
  const [saving, setSaving]     = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const valuations = useMemo(() => bonds.map(b => valueBond(b)), [bonds])
  const coupons    = useMemo(() => upcomingCoupons(bonds, 12), [bonds])

  // Per-bond CZK figures. The bond maths runs in each bond's own currency and
  // is converted once here — mixing currencies inside the yield or duration
  // calculation would be meaningless.
  const rows = useMemo(() => valuations.map(v => ({
    v,
    valueCZK: toCZK(v.dirtyValue, v.bond.currency, fx),
    costCZK:  toCZK(v.costValue, v.bond.currency, fx),
    couponCZK: toCZK(v.annualCouponNet, v.bond.currency, fx),
    // Kept apart all the way to the screen. A capital loss and accrued coupon
    // routinely point in opposite directions, and one netted number reads as
    // a mystery profit on a bond trading below what you paid for it.
    pricePLCZK:  toCZK(v.pricePL, v.bond.currency, fx),
    incomePLCZK: toCZK(v.incomePL, v.bond.currency, fx),
  })), [valuations, fx])

  const totalValueCZK  = rows.reduce((s, r) => s + r.valueCZK, 0)
  const totalCostCZK   = rows.reduce((s, r) => s + r.costCZK, 0)
  const totalCouponCZK = rows.reduce((s, r) => s + r.couponCZK, 0)
  const pricePLCZK     = rows.reduce((s, r) => s + r.pricePLCZK, 0)
  const incomePLCZK    = rows.reduce((s, r) => s + r.incomePLCZK, 0)
  const plCZK          = totalValueCZK - totalCostCZK

  // Positions whose cost basis is missing the coupon couru paid at purchase,
  // which overstates their gain by exactly that amount.
  const unrecordedCouru = rows.filter(r => r.v.unrecordedAccruedAtPurchase != null)


  // Yield and duration are weighted by each line's own value in its own
  // currency, which is only comparable once everything is in CZK. Re-weight
  // against the CZK values rather than reusing bondTotals' native-currency ones.
  const weightedBy = (pick: (v: BondValuation) => number | null): number | null => {
    let acc = 0, weight = 0
    for (const r of rows) {
      const value = pick(r.v)
      if (value == null || r.valueCZK <= 0) continue
      acc += value * r.valueCZK
      weight += r.valueCZK
    }
    return weight > 0 ? acc / weight : null
  }
  const avgYTM      = weightedBy(v => v.ytm)
  const avgDuration = weightedBy(v => v.modifiedDuration)
  const nativeTotals = bondTotals(valuations)

  // What a 100bp rise in yields would cost the book, in CZK.
  const rateRiskCZK = avgDuration != null ? totalValueCZK * avgDuration * 0.01 : null

  // ── Maturity ladder: nominal redeeming per calendar year ───────────────────
  const ladder = useMemo(() => {
    const byYear: Record<string, number> = {}
    for (const r of rows) {
      const year = r.v.bond.maturity_date.slice(0, 4)
      byYear[year] = (byYear[year] ?? 0) + toCZK(r.v.nominal, r.v.bond.currency, fx)
    }
    return Object.entries(byYear)
      .map(([year, czk]) => ({ year, czk }))
      .sort((a, b) => a.year.localeCompare(b.year))
  }, [rows, fx])
  const ladderMax = ladder.reduce((m, l) => Math.max(m, l.czk), 0)

  // ── Form ───────────────────────────────────────────────────────────────────

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const resetForm = () => { setForm(emptyForm); setEditId(null); setFormError(null) }

  const startAdd = () => { resetForm(); setShowForm(true) }

  /**
   * `couru` prefills the form for a position whose coupon couru went
   * unrecorded. `basis` says how to read the price already stored:
   *
   *   'clean'  — the couru was paid on top, so cost rises by it
   *   'all_in' — the couru was already inside the price, so the price is
   *              restated downwards and the total paid does not move
   *
   * Only the contract note settles which, so both are offered and neither is
   * applied until saved.
   */
  const startEdit = (b: Bond, couru?: { amount: number; basis: 'clean' | 'all_in' }) => {
    setForm({
      name: b.name,
      issuer: b.issuer ?? '',
      isin: b.isin ?? '',
      bond_type: b.bond_type,
      country: b.country ?? '',
      currency: b.currency,
      face_value: String(b.face_value),
      quantity: String(b.quantity),
      purchase_price_pct: String(b.purchase_price_pct),
      // What is stored is always clean, whatever was typed to produce it — so
      // restating a dirty price means re-entering it as all-in and letting the
      // save path split it.
      price_basis: couru?.basis === 'all_in' ? 'all_in' : 'clean',
      current_price_pct: b.current_price_pct == null ? '' : String(b.current_price_pct),
      coupon_rate: String(+(b.coupon_rate * 100).toFixed(6)),
      coupons_per_year: String(b.coupons_per_year),
      day_count: b.day_count,
      issue_date: b.issue_date ?? '',
      maturity_date: b.maturity_date,
      purchase_date: b.purchase_date ?? '',
      accrued_at_purchase: couru != null
        ? couru.amount.toFixed(2)
        : String(b.accrued_at_purchase ?? 0),
      withholding_tax_pct: String(+((b.withholding_tax_pct ?? 0) * 100).toFixed(4)),
      is_inflation_linked: b.is_inflation_linked,
      index_ratio: String(b.index_ratio ?? 1),
      notes: b.notes ?? '',
    })
    setEditId(b.id)
    setFormError(null)
    setShowForm(true)
  }

  const saveBond = async () => {
    if (!activeProfile) { setFormError('No active profile.'); return }

    const nOr = (raw: string, fallback: number): number => {
      const n = parseFloat(raw)
      return isFinite(n) ? n : fallback
    }

    if (!form.name.trim()) { setFormError('Give the bond a name.'); return }
    if (!form.maturity_date) { setFormError('A maturity date is required — every bond figure is derived from it.'); return }
    if (!parseISO(form.maturity_date)) { setFormError('Maturity date is not a valid date.'); return }

    const quantity = parseFloat(form.quantity)
    if (!isFinite(quantity) || quantity <= 0) { setFormError('Quantity must be a positive number.'); return }

    const faceValue = parseFloat(form.face_value)
    if (!isFinite(faceValue) || faceValue <= 0) { setFormError('Face value must be a positive number.'); return }

    const purchasePct = parseFloat(form.purchase_price_pct)
    if (!isFinite(purchasePct) || purchasePct <= 0) {
      setFormError('Purchase price is a percentage of par — 92.5 means 92.5%.')
      return
    }

    if (form.issue_date && parseISO(form.issue_date) && parseISO(form.issue_date)! >= parseISO(form.maturity_date)!) {
      setFormError('Issue date must fall before maturity.')
      return
    }

    const accruedPaid = nOr(form.accrued_at_purchase, 0)
    if (accruedPaid < 0) { setFormError('Accrued at purchase cannot be negative.'); return }

    // An all-in price is converted here, once, so everything downstream reads a
    // clean price and a separate coupon couru — the only pair the maths accepts.
    let cleanPricePct = purchasePct
    if (form.price_basis === 'all_in') {
      if (accruedPaid <= 0) {
        setFormError('An all-in price contains a coupon couru — set it (or press “compute”) so it can be separated out.')
        return
      }
      const split = splitAllInPrice(purchasePct, quantity, faceValue, accruedPaid)
      if (!split) {
        setFormError('The accrued interest is larger than the total paid — check both figures against the contract note.')
        return
      }
      cleanPricePct = split.cleanPricePct
    }

    setSaving(true)
    setFormError(null)

    const payload = {
      name: form.name.trim(),
      issuer: form.issuer.trim(),
      isin: form.isin.trim().toUpperCase() || null,
      bond_type: form.bond_type,
      country: form.country.trim().toUpperCase() || null,
      currency: form.currency,
      face_value: faceValue,
      quantity,
      purchase_price_pct: cleanPricePct,
      // Empty means "not marked" — stored as null so the valuation falls back to
      // cost and the table can say so, rather than implying a live price of 0.
      current_price_pct: form.current_price_pct.trim() === '' ? null : nOr(form.current_price_pct, 0),
      // Percent in the form, decimal fraction in the database.
      coupon_rate: nOr(form.coupon_rate, 0) / 100,
      coupons_per_year: Math.round(nOr(form.coupons_per_year, 1)),
      day_count: form.day_count,
      issue_date: form.issue_date || null,
      maturity_date: form.maturity_date,
      purchase_date: form.purchase_date || null,
      accrued_at_purchase: accruedPaid,
      withholding_tax_pct: nOr(form.withholding_tax_pct, 0) / 100,
      is_inflation_linked: form.is_inflation_linked,
      index_ratio: nOr(form.index_ratio, 1),
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }

    const { error } = editId
      ? await supabase.from('bonds').update(payload).eq('id', editId)
      : await supabase.from('bonds').insert([{ ...payload, profile_id: activeProfile.id }])

    setSaving(false)
    if (error) { setFormError(`Could not save: ${error.message}`); return }

    setShowForm(false)
    resetForm()
    reload()
  }

  const deleteBond = async (b: Bond) => {
    if (!confirm(`Remove "${b.name}"? It will stop counting towards net worth.`)) return
    const { error } = await supabase.from('bonds').update({ is_active: false }).eq('id', b.id)
    if (error) { alert(`Could not remove bond: ${error.message}`); return }
    reload()
  }

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>Loading bonds…</main>
    </div>
  )

  const bondsTableMissing = missingTables.includes('bonds')

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '32px 40px', maxWidth: 1280 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: ACCENT, marginBottom: 4, fontWeight: 600 }}>Fixed income</div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>Bonds</h1>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              {bonds.length} {bonds.length === 1 ? 'line' : 'lines'} · values include accrued interest · totals in CZK
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refreshFx} disabled={fxLoading} style={btnSecondary}>
              {fxLoading ? '⟳' : '↻'} FX {fxTs && <span style={{ color: 'var(--green)', marginLeft: 4 }}>{fxTs}</span>}
            </button>
            <button onClick={startAdd} disabled={bondsTableMissing} style={btnPrimary(ACCENT, 'var(--blue-bd)', 'var(--blue-bg)')}>
              + Add bond
            </button>
          </div>
        </div>

        <SetupNotice tables={bondsTableMissing ? ['bonds'] : []} />

        {unrecordedCouru.length > 0 && (
          <div style={{
            background: 'var(--amber-bg)', border: '1px solid var(--amber-bd)',
            borderRadius: 10, padding: '12px 16px', marginBottom: 16,
            fontSize: 11, lineHeight: 1.7, color: 'var(--text2)',
          }}>
            <div style={{ fontWeight: 600, color: 'var(--amber)', marginBottom: 4 }}>
              ⚠ No coupon couru recorded
            </div>
            {unrecordedCouru.length === 1 ? 'One position was' : `${unrecordedCouru.length} positions were`}{' '}
            bought part-way through a coupon period with no accrued interest recorded, so the price
            and income halves of its P&amp;L are attributed wrongly. Which fix applies depends on how
            your broker quoted the price — the contract note settles it:
            <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
              {unrecordedCouru.map(r => (
                <li key={r.v.bond.id} style={{ marginBottom: 6 }}>
                  <strong style={{ color: 'var(--text2)' }}>{r.v.bond.name}</strong> — about{' '}
                  {fmtNum(r.v.unrecordedAccruedAtPurchase!, 2)} {r.v.bond.currency} had accrued by{' '}
                  {fmtDate(r.v.bond.purchase_date!)}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button
                      onClick={() => startEdit(r.v.bond, { amount: r.v.unrecordedAccruedAtPurchase!, basis: 'clean' })}
                      style={{ ...btnSecondary, padding: '3px 10px', fontSize: 10 }}
                      title="The quoted price excluded accrued interest, which you paid on top — cost rises"
                    >
                      price was clean — add it on top
                    </button>
                    <button
                      onClick={() => startEdit(r.v.bond, { amount: r.v.unrecordedAccruedAtPurchase!, basis: 'all_in' })}
                      style={{ ...btnSecondary, padding: '3px 10px', fontSize: 10 }}
                      title="The quoted price already contained the coupon couru — the price is restated, the total paid is unchanged"
                    >
                      price was all-in — split it out
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text4)' }}>
              Accrued interest is reckoned on the settlement date, not the trade date, so an OAT
              settling T+2 accrues a little more than the figure above. Replace it with the exact
              amount from the contract note where you have it.
            </div>
          </div>
        )}

        {/* ── Summary ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
          {([
            {
              label: 'Bond value', value: fmtCZK(totalValueCZK), accent: ACCENT,
              note: `price ${pricePLCZK >= 0 ? '+' : '−'}${fmtCZK(Math.abs(pricePLCZK))} · coupon +${fmtCZK(Math.abs(incomePLCZK))}`,
            },
            {
              label: 'Annual coupons', value: fmtCZK(totalCouponCZK), accent: 'var(--green)',
              note: nativeTotals.annualCouponNet < nativeTotals.annualCouponGross ? 'net of withholding' : 'gross — no withholding set',
            },
            {
              label: 'Avg yield to maturity',
              value: avgYTM != null ? `${(avgYTM * 100).toFixed(2)}%` : DASH,
              accent: 'var(--amber)', note: 'value-weighted',
            },
            {
              label: 'Avg duration',
              value: avgDuration != null ? `${avgDuration.toFixed(1)} yr` : DASH,
              accent: 'var(--purple)',
              note: rateRiskCZK != null ? `−${fmtCZK(rateRiskCZK)} if yields +1%` : 'rate sensitivity',
            },
            {
              label: 'Accrued interest',
              value: fmtCZK(rows.reduce((s, r) => s + toCZK(r.v.accruedInterest, r.v.bond.currency, fx), 0)),
              accent: 'var(--teal)', note: 'earned, not yet paid',
            },
          ] as { label: string; value: string; accent: string; note: string; noteColor?: string }[])
            .map((m, i) => (
            <div key={i} style={{ ...cardStyle, borderTop: `2px solid ${m.accent}` }}>
              <div style={cardLabelStyle}>{m.label}</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: m.noteColor ?? 'var(--text4)' }}>{m.note}</div>
            </div>
          ))}
        </div>

        {/* ── Holdings table ──────────────────────────────────────────────── */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          <div style={tableHeader}>
            <span style={tableHeaderLabel}>Bond positions</span>
            {nativeTotals.maturedCount > 0 && (
              <span style={{ fontSize: 10, color: 'var(--amber)' }}>
                {nativeTotals.maturedCount} matured · held at par pending redemption
              </span>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Bond', 'Type', 'Nominal', 'Price', 'Accrued', 'Value (CZK)', 'P&L (CZK)', 'Coupon', 'YTM', 'Dur.', 'Matures', ''].map((h, i) => (
                    <th key={h + i} style={{ ...th, textAlign: i <= 1 ? 'left' : i === 11 ? 'center' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={12} style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text4)', fontSize: 12 }}>
                      {bondsTableMissing
                        ? 'Run the migration above, then add your first bond.'
                        : 'No bonds yet. “Add bond” has a one-click preset for a French OAT.'}
                    </td>
                  </tr>
                )}
                {rows.map(({ v, valueCZK, costCZK, pricePLCZK: rowPricePL, incomePLCZK: rowIncomePL }) => {
                  const b = v.bond
                  const pl = valueCZK - costCZK
                  const typeColor = BOND_TYPE_COLORS[b.bond_type] ?? 'var(--text3)'
                  return (
                    <tr key={b.id}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={tdL}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>
                          {b.name}
                          {b.is_inflation_linked && (
                            <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--green)' }} title={`Indexation coefficient ${b.index_ratio}`}>
                              INDEXED ×{b.index_ratio}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text4)' }}>
                          {[b.issuer, b.isin, b.country].filter(Boolean).join(' · ') || DASH}
                        </div>
                      </td>
                      <td style={tdL}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: typeColor + '18', color: typeColor, border: `1px solid ${typeColor}30` }}>
                          {BOND_TYPE_LABELS[b.bond_type] ?? b.bond_type}
                        </span>
                      </td>
                      <td style={tdR}>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
                          {fmtNum(v.nominal, 0)} <span style={{ fontSize: 10, color: 'var(--text4)' }}>{b.currency}</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text4)' }}>
                          {fmtNum(b.quantity, 0)} × {fmtNum(b.face_value, 2)}
                        </div>
                      </td>
                      <td style={tdR}>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
                          {(v.cleanPricePct * 100).toFixed(3)}
                        </div>
                        <div style={{ fontSize: 10, color: v.hasMarketPrice ? 'var(--text4)' : 'var(--amber)' }}>
                          {v.isMatured
                            ? 'redeemed at par'
                            : v.hasMarketPrice
                              ? `clean cost ${Number(b.purchase_price_pct).toFixed(3)}`
                              : 'at cost — unmarked'}
                        </div>
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--teal)' }}>
                        {v.accruedInterest > 0 ? fmtNum(v.accruedInterest, 2) : DASH}
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", fontWeight: 500 }}>{fmtCZK(valueCZK)}</td>
                      <td style={tdR}>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: pl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {pl >= 0 ? '+' : ''}{fmtCZK(pl)}
                        </div>
                        {/* Which half is which. Without this a bond marked
                            below its purchase price still reads as a gain. */}
                        <div style={{ fontSize: 9, color: 'var(--text4)', whiteSpace: 'nowrap' }}>
                          <span style={{ color: rowPricePL >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            price {rowPricePL >= 0 ? '+' : '−'}{fmtCZK(Math.abs(rowPricePL))}
                          </span>
                          {' · '}
                          <span style={{ color: 'var(--teal)' }}>
                            coupon {rowIncomePL >= 0 ? '+' : '−'}{fmtCZK(Math.abs(rowIncomePL))}
                          </span>
                        </div>
                        {v.unrecordedAccruedAtPurchase != null && (
                          <div style={{ fontSize: 9, color: 'var(--amber)' }} title="No coupon couru recorded at purchase — cost is understated">
                            ⚠ coupon couru not recorded
                          </div>
                        )}
                      </td>
                      <td style={tdR}>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                          {(b.coupon_rate * 100).toFixed(3)}%
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text4)' }}>
                          {COUPON_FREQUENCY_LABELS[b.coupons_per_year] ?? `${b.coupons_per_year}×/yr`}
                        </div>
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: v.ytm == null ? 'var(--text4)' : v.ytm > b.coupon_rate ? 'var(--green)' : 'var(--text2)' }}>
                        {v.ytm != null ? `${(v.ytm * 100).toFixed(2)}%` : DASH}
                      </td>
                      <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>
                        {v.modifiedDuration != null ? v.modifiedDuration.toFixed(1) : DASH}
                      </td>
                      <td style={tdR}>
                        <div style={{ fontSize: 12 }}>{fmtDate(b.maturity_date)}</div>
                        <div style={{ fontSize: 10, color: v.isMatured ? 'var(--amber)' : 'var(--text4)' }}>
                          {v.isMatured ? 'matured' : `${v.yearsToMaturity.toFixed(1)} yr left`}
                        </div>
                      </td>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button title="Edit bond" onClick={() => startEdit(b)} style={actionBtn}>✎</button>
                        <button title="Remove bond" onClick={() => deleteBond(b)} style={{ ...actionBtn, marginLeft: 4, color: 'var(--red)' }}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr style={{ background: 'var(--bg3)' }}>
                    <td colSpan={5} style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, borderTop: '1px solid var(--border)' }}>Total</td>
                    <td style={{ ...tdR, borderTop: '1px solid var(--border)', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>{fmtCZK(totalValueCZK)}</td>
                    <td style={{ ...tdR, borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 600, color: plCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {plCZK >= 0 ? '+' : ''}{fmtCZK(plCZK)}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text4)', whiteSpace: 'nowrap' }}>
                        price {pricePLCZK >= 0 ? '+' : '−'}{fmtCZK(Math.abs(pricePLCZK))}
                        {' · '}coupon {incomePLCZK >= 0 ? '+' : '−'}{fmtCZK(Math.abs(incomePLCZK))}
                      </div>
                    </td>
                    <td style={{ ...tdR, borderTop: '1px solid var(--border)', fontFamily: "'DM Mono', monospace", color: 'var(--green)' }}>
                      ~{fmtCZK(totalCouponCZK)}
                    </td>
                    <td style={{ ...tdR, borderTop: '1px solid var(--border)', fontFamily: "'DM Mono', monospace" }}>
                      {avgYTM != null ? `${(avgYTM * 100).toFixed(2)}%` : DASH}
                    </td>
                    <td style={{ ...tdR, borderTop: '1px solid var(--border)', fontFamily: "'DM Mono', monospace" }}>
                      {avgDuration != null ? avgDuration.toFixed(1) : DASH}
                    </td>
                    <td colSpan={2} style={{ borderTop: '1px solid var(--border)' }} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ── Add / edit form ─────────────────────────────────────────────── */}
        {showForm && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--blue-bd)', borderRadius: 12, padding: '24px 28px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 600 }}>
                {editId ? 'Edit bond' : 'Add bond'}
              </div>
              {!editId && (
                <button
                  onClick={() => setForm(prev => ({ ...prev, ...OAT_PRESET }))}
                  style={btnSecondary}
                  title="Fill in the French government-bond conventions: EUR, €1 nominal, annual coupon, ACT/ACT"
                >
                  🇫🇷 French OAT defaults
                </button>
              )}
            </div>

            <FieldGroup title="Identity">
              <Field label="Name" hint="e.g. OAT 3.00% 25/05/2054">
                <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="OAT 3.00% 25/05/2054" />
              </Field>
              <Field label="Issuer">
                <input style={inputStyle} value={form.issuer} onChange={e => set('issuer', e.target.value)} placeholder="République Française (AFT)" />
              </Field>
              <Field label="ISIN">
                <input style={inputStyle} value={form.isin} onChange={e => set('isin', e.target.value)} placeholder="FR001400UKX0" />
              </Field>
              <Field label="Type">
                <select style={inputStyle} value={form.bond_type} onChange={e => set('bond_type', e.target.value as BondType)}>
                  {Object.entries(BOND_TYPE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Country" hint="ISO-2 code">
                <input style={inputStyle} value={form.country} onChange={e => set('country', e.target.value)} placeholder="FR" maxLength={2} />
              </Field>
              <Field label="Currency">
                <select style={inputStyle} value={form.currency} onChange={e => set('currency', e.target.value)}>
                  <option>EUR</option><option>CZK</option><option>USD</option><option>GBP</option><option>PLN</option><option>CHF</option>
                </select>
              </Field>
            </FieldGroup>

            <FieldGroup title="Size & price" note="Prices are clean and quoted as a percentage of par: 92.5 means 92.5%, not 92.5 units of currency.">
              <Field label="Face value per unit" hint="An OAT is quoted per 1 EUR of nominal">
                <input style={inputStyle} type="number" step="any" value={form.face_value} onChange={e => set('face_value', e.target.value)} />
              </Field>
              <Field label="Quantity (units of nominal)">
                <input style={inputStyle} type="number" step="any" value={form.quantity} onChange={e => set('quantity', e.target.value)} placeholder="10000" />
              </Field>
              <Field
                label="Purchase price basis"
                hint="Brokers differ — a contract note often shows one all-in figure"
              >
                <select
                  style={inputStyle}
                  value={form.price_basis}
                  onChange={e => set('price_basis', e.target.value as Form['price_basis'])}
                >
                  <option value="clean">Clean — excludes accrued interest</option>
                  <option value="all_in">All-in — includes the coupon couru</option>
                </select>
              </Field>
              <Field
                label={form.price_basis === 'all_in' ? 'Purchase price (% of par, all-in)' : 'Purchase price (% of par, clean)'}
                hint={form.price_basis === 'all_in' ? 'Stored as a clean price once the couru below is separated out' : undefined}
              >
                <input style={inputStyle} type="number" step="any" value={form.purchase_price_pct} onChange={e => set('purchase_price_pct', e.target.value)} placeholder="92.5" />
              </Field>
              <Field label="Current price (% of par)" hint="Leave blank to hold at cost">
                <input style={inputStyle} type="number" step="any" value={form.current_price_pct} onChange={e => set('current_price_pct', e.target.value)} placeholder="95.0" />
              </Field>
              <Field
                label="Accrued paid at purchase"
                hint={`Coupon couru, in ${form.currency} — reimbursed to the seller on top of the clean price`}
              >
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={inputStyle} type="number" step="any" value={form.accrued_at_purchase} onChange={e => set('accrued_at_purchase', e.target.value)} placeholder="0.00" />
                  <button
                    type="button"
                    onClick={() => {
                      const computed = couruForForm(form)
                      if (computed == null) {
                        setFormError('Set the purchase date, maturity, coupon rate and quantity first — the coupon couru is derived from them.')
                        return
                      }
                      setFormError(null)
                      set('accrued_at_purchase', computed.toFixed(2))
                    }}
                    style={{ ...btnSecondary, whiteSpace: 'nowrap' }}
                    title="Work out the accrued interest on the purchase date from the coupon terms"
                  >
                    compute
                  </button>
                </div>
              </Field>
            </FieldGroup>

            {form.price_basis === 'all_in' && (() => {
              // Show the arithmetic before it is committed: an all-in price that
              // silently becomes a different number on save is worse than asking.
              const quantity = parseFloat(form.quantity)
              const faceValue = parseFloat(form.face_value)
              const allIn = parseFloat(form.purchase_price_pct)
              const accrued = parseFloat(form.accrued_at_purchase)
              const split = isFinite(quantity) && isFinite(faceValue) && isFinite(allIn) && isFinite(accrued)
                ? splitAllInPrice(allIn, quantity, faceValue, accrued)
                : null
              return (
                <div style={{
                  marginTop: -8, marginBottom: 20, padding: '10px 14px',
                  background: 'var(--bg3)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 11, lineHeight: 1.7, color: 'var(--text3)',
                }}>
                  {split ? (
                    <>
                      Settling <strong style={{ color: 'var(--text2)' }}>{fmtNum(split.totalPaid, 2)} {form.currency}</strong>
                      {' '}in total, recorded as a clean price of{' '}
                      <strong style={{ color: ACCENT }}>{split.cleanPricePct.toFixed(4)}</strong>
                      {' '}plus <strong style={{ color: 'var(--teal)' }}>{fmtNum(split.accruedAtPurchase, 2)} {form.currency}</strong>
                      {' '}coupon couru. The total you paid does not change.
                    </>
                  ) : (
                    <>Enter quantity, face value, the all-in price and the coupon couru to see how they split.</>
                  )}
                </div>
              )
            })()}

            <FieldGroup title="Coupon">
              <Field label="Coupon rate (%)" hint="Annual, on nominal">
                <input style={inputStyle} type="number" step="any" value={form.coupon_rate} onChange={e => set('coupon_rate', e.target.value)} placeholder="3.00" />
              </Field>
              <Field label="Payments per year">
                <select style={inputStyle} value={form.coupons_per_year} onChange={e => set('coupons_per_year', e.target.value)}>
                  {[1, 2, 4, 12].map(f => <option key={f} value={f}>{COUPON_FREQUENCY_LABELS[f]}</option>)}
                </select>
              </Field>
              <Field label="Day count" hint="OATs accrue ACT/ACT">
                <select style={inputStyle} value={form.day_count} onChange={e => set('day_count', e.target.value as DayCount)}>
                  <option value="ACT/ACT">ACT/ACT (ICMA)</option>
                  <option value="ACT/365">ACT/365</option>
                  <option value="30/360">30/360</option>
                </select>
              </Field>
              <Field label="Withholding tax (%)" hint="Deducted at source, if any">
                <input style={inputStyle} type="number" step="any" value={form.withholding_tax_pct} onChange={e => set('withholding_tax_pct', e.target.value)} placeholder="0" />
              </Field>
            </FieldGroup>

            <FieldGroup title="Dates">
              <Field label="Maturity" hint="Required">
                <input style={inputStyle} type="date" value={form.maturity_date} onChange={e => set('maturity_date', e.target.value)} />
              </Field>
              <Field label="Issue date">
                <input style={inputStyle} type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} />
              </Field>
              <Field label="Purchase date" hint="Fills in the coupon couru if you have not set one">
                <input
                  style={inputStyle} type="date" value={form.purchase_date}
                  onChange={e => {
                    const next = { ...form, purchase_date: e.target.value }
                    // Only ever fills a blank or zero field — never overwrites a
                    // figure taken off the contract note.
                    const untouched = next.accrued_at_purchase.trim() === '' || parseFloat(next.accrued_at_purchase) === 0
                    const computed = untouched ? couruForForm(next) : null
                    setForm(computed != null
                      ? { ...next, accrued_at_purchase: computed.toFixed(2) }
                      : next)
                  }}
                />
              </Field>
            </FieldGroup>

            <FieldGroup title="Inflation indexation" note="OAT€i and OATi carry a coefficient that scales both the nominal repaid and every coupon.">
              <Field label="Inflation-linked">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', padding: '8px 0' }}>
                  <input
                    type="checkbox"
                    checked={form.is_inflation_linked}
                    onChange={e => set('is_inflation_linked', e.target.checked)}
                  />
                  This is an indexed issue
                </label>
              </Field>
              {form.is_inflation_linked && (
                <Field label="Indexation coefficient" hint="1.0 at issue">
                  <input style={inputStyle} type="number" step="any" value={form.index_ratio} onChange={e => set('index_ratio', e.target.value)} />
                </Field>
              )}
              <Field label="Notes" wide>
                <input style={inputStyle} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. held in PEA, bought via Bourse Direct" />
              </Field>
            </FieldGroup>

            {formError && (
              <div style={{ marginTop: 14, background: 'var(--red-bg, rgba(220,60,60,0.08))', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 8, padding: '9px 14px', fontSize: 11 }}>
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => { setShowForm(false); resetForm() }} style={btnSecondary}>Cancel</button>
              <button onClick={saveBond} disabled={saving} style={btnPrimary(ACCENT, 'var(--blue-bd)', 'var(--blue-bg)')}>
                {saving ? 'Saving…' : editId ? 'Save changes' : 'Add bond'}
              </button>
            </div>
          </div>
        )}

        {/* ── Maturity ladder ─────────────────────────────────────────────── */}
        {ladder.length > 0 && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
            <div style={tableHeader}>
              <span style={tableHeaderLabel}>Maturity ladder</span>
              <span style={{ fontSize: 10, color: 'var(--text4)' }}>nominal returning to you, by year</span>
            </div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ladder.map(l => (
                <div key={l.year} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 44, fontSize: 11, color: 'var(--text3)', fontFamily: "'DM Mono', monospace" }}>{l.year}</div>
                  <div style={{ flex: 1, height: 18, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      width: ladderMax > 0 ? `${Math.max(2, (l.czk / ladderMax) * 100)}%` : '0%',
                      height: '100%', background: ACCENT, opacity: 0.75,
                    }} />
                  </div>
                  <div style={{ width: 130, textAlign: 'right', fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--text2)' }}>
                    {fmtCZK(l.czk)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Upcoming coupons ────────────────────────────────────────────── */}
        {coupons.length > 0 && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={tableHeader}>
              <span style={tableHeaderLabel}>Coupons due — next 12 months</span>
              <span style={{ fontSize: 10, color: 'var(--green)' }}>
                {fmtCZK(coupons.reduce((s, c) => s + toCZK(c.netAmount, c.currency, fx), 0))} net
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Date', 'Bond', 'Gross', 'Net', 'Net (CZK)'].map((h, i) => (
                    <th key={h} style={{ ...th, textAlign: i <= 1 ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coupons.map((c, i) => (
                  <tr key={`${c.bond.id}-${c.date}-${i}`}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={tdL}><span style={{ fontSize: 12 }}>{fmtDate(c.date)}</span></td>
                    <td style={tdL}><span style={{ fontSize: 12 }}>{c.bond.name}</span></td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtNum(c.grossAmount, 2)} {c.currency}</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace", color: 'var(--green)' }}>{fmtNum(c.netAmount, 2)} {c.currency}</td>
                    <td style={{ ...tdR, fontFamily: "'DM Mono', monospace" }}>{fmtCZK(toCZK(c.netAmount, c.currency, fx))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

/**
 * Coupon couru implied by the form's own values, or null when the terms it
 * needs are not filled in yet.
 *
 * Deliberately routed through the same `accruedInterestOn` the valuation uses,
 * rather than a second day-count implementation living in the UI — two copies
 * of an accrual convention drift, and the one that drifts is always the one
 * nobody has tests for.
 */
function couruForForm(form: Form): number | null {
  const purchase = parseISO(form.purchase_date)
  const quantity = parseFloat(form.quantity)
  const faceValue = parseFloat(form.face_value)
  const couponPct = parseFloat(form.coupon_rate)

  if (!purchase || !form.maturity_date || !parseISO(form.maturity_date)) return null
  if (!isFinite(quantity) || !isFinite(faceValue) || !isFinite(couponPct)) return null
  if (quantity <= 0 || faceValue <= 0 || couponPct <= 0) return null

  const probe = {
    quantity, face_value: faceValue,
    coupon_rate: couponPct / 100,
    coupons_per_year: Math.round(parseFloat(form.coupons_per_year)) || 1,
    day_count: form.day_count,
    maturity_date: form.maturity_date,
    issue_date: form.issue_date || null,
    is_inflation_linked: form.is_inflation_linked,
    index_ratio: parseFloat(form.index_ratio) || 1,
  } as Bond

  const accrued = accruedInterestOn(probe, purchase)
  return accrued > 0 ? accrued : null
}

// ─── Form layout helpers ──────────────────────────────────────────────────────

function FieldGroup({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>
        {title}
      </div>
      {note && <div style={{ fontSize: 10, color: 'var(--text4)', marginBottom: 10, lineHeight: 1.5 }}>{note}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>{children}</div>
    </div>
  )
}

function Field({ label, hint, wide, children }: {
  label: string; hint?: string; wide?: boolean; children: React.ReactNode
}) {
  return (
    <div style={wide ? { gridColumn: '1/-1' } : undefined}>
      <div style={inputLabel}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 9, color: 'var(--text4)', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}
