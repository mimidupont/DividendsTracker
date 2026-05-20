'use client'
import { useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import { toCZK, fmtCZK } from '@/lib/fx'
import { useFx } from '@/hooks/useFx'
import { useMarketData } from '@/hooks/useMarketData'
import { useCryptoPrices } from '@/hooks/useCryptoPrices'
import { useAppData } from '@/hooks/useAppData'
import { computeProjectedTotal } from '@/lib/projections'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

interface AssetBlock {
  label: string
  value: number
  color: string
  href: string
}

export default function Dashboard() {
  const {
    holdings, projections, dividendsReceived,
    bankAccounts, cryptoHoldings, realEstate, loading,
  } = useAppData()

  const { fx, fxLoading, fxTs, refresh: refreshFx } = useFx()
  const market = useMarketData()
  const cryptoPrices = useCryptoPrices()

  // Kick off market + crypto fetches when data arrives (only if not already cached)
  useEffect(() => {
    if (holdings.length > 0) market.refresh(holdings.map(h => h.symbol))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings.length])

  useEffect(() => {
    if (cryptoHoldings.length > 0) cryptoPrices.refresh(cryptoHoldings.map(c => c.coin_id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cryptoHoldings.length])

  // ── Stock values ─────────────────────────────────────────
  const stockValueCZK = holdings.reduce((s, h) =>
    s + toCZK(market.getPrice(h.symbol, h.avg_price) * h.shares, h.currency, fx), 0)
  const stockCostCZK = holdings.reduce((s, h) =>
    s + toCZK(h.avg_price * h.shares, h.currency, fx), 0)

  // ── Cash values ──────────────────────────────────────────
  const cashValueCZK = bankAccounts.reduce((s, a) =>
    s + toCZK(a.balance, a.currency, fx), 0)

  // ── Crypto values ────────────────────────────────────────
  const cryptoValueCZK = cryptoHoldings.reduce((s, c) => {
    const priceUSD = cryptoPrices.getPrice(c.coin_id, c.avg_cost_usd)
    return s + toCZK(priceUSD * c.amount, 'USD', fx)
  }, 0)

  // ── Real estate (net equity) ─────────────────────────────
  const realEstateGrossCZK = realEstate.reduce((s, p) =>
    s + toCZK(p.current_value * (p.ownership_pct / 100), p.currency, fx), 0)
  const mortgageCZK = realEstate.reduce((s, p) =>
    s + toCZK(p.mortgage_balance, p.currency, fx), 0)
  const realEstateEquityCZK = realEstateGrossCZK - mortgageCZK

  // ── Total net worth ──────────────────────────────────────
  const totalNetWorth = stockValueCZK + cashValueCZK + cryptoValueCZK + realEstateEquityCZK
  const totalInvested = stockCostCZK + cashValueCZK +
    cryptoHoldings.reduce((s, c) => s + toCZK(c.avg_cost_usd * c.amount, 'USD', fx), 0) +
    realEstate.reduce((s, p) => s + toCZK(p.purchase_price * (p.ownership_pct / 100), p.currency, fx), 0)
  const totalGainCZK = totalNetWorth - totalInvested

  // ── Annual income ────────────────────────────────────────
  const divIncomeCZK = holdings.reduce((s, h) => {
    const liveAnnual = market.getAnnualDiv(h.symbol)
    if (liveAnnual != null) return s + toCZK(liveAnnual * h.shares, h.currency, fx)
    const proj = projections.find(p => p.symbol === h.symbol)
    if (!proj) return s
    return s + toCZK(computeProjectedTotal(proj, holdings), proj.currency, fx)
  }, 0)
  const interestIncomeCZK = bankAccounts.reduce((s, a) =>
    s + toCZK(a.balance * a.interest_rate, a.currency, fx), 0)
  const rentalIncomeCZK = realEstate.reduce((s, p) =>
    s + toCZK(p.monthly_rent * 12 * (p.ownership_pct / 100), p.currency, fx), 0)
  const stakingIncomeCZK = cryptoHoldings.reduce((s, c) => {
    const priceUSD = cryptoPrices.getPrice(c.coin_id, c.avg_cost_usd)
    return s + toCZK(priceUSD * c.amount * c.staking_apy, 'USD', fx)
  }, 0)
  const totalAnnualIncome = divIncomeCZK + interestIncomeCZK + rentalIncomeCZK + stakingIncomeCZK

  // ── Asset blocks ─────────────────────────────────────────
  const assetBlocks: AssetBlock[] = [
    { label: 'Stocks & ETFs',  value: stockValueCZK,       color: 'var(--green)',  href: '/holdings' },
    { label: 'Cash & Savings', value: cashValueCZK,         color: 'var(--blue)',   href: '/cash' },
    { label: 'Crypto',         value: cryptoValueCZK,       color: 'var(--purple)', href: '/crypto' },
    { label: 'Real Estate',    value: realEstateEquityCZK,  color: 'var(--teal)',   href: '/realestate' },
  ]

  const CURRENT_YEAR = new Date().getFullYear()
  const ytdDivCZK = dividendsReceived
    .filter(d => new Date(d.payment_date).getFullYear() === CURRENT_YEAR)
    .reduce((s, d) => s + toCZK(d.gross_amount, d.currency, fx), 0)

  if (loading) return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: 40, color: 'var(--text3)' }}>
        Loading wealth data…
      </main>
    </div>
  )
const { activeProfile } = useProfile()
  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main style={{ marginLeft: 'var(--sidebar-w)', flex: 1, padding: '32px 40px', maxWidth: 1200 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {greeting()}, <span style={{ color: 'var(--green)' }}>{activeProfile?.display_name ?? 'there'}</span>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refreshFx} disabled={fxLoading} style={btnSecondary}>
              {fxLoading ? '⟳' : '↻'} FX rates
              {fxTs && <span style={{ color: 'var(--green)', marginLeft: 6 }}>{fxTs}</span>}
            </button>
            <button
              onClick={() => market.refresh(holdings.map(h => h.symbol), true)}
              disabled={market.state === 'loading'}
              style={btnSecondary}
            >
              {market.state === 'loading' ? '⟳ Fetching…' : '↻ Prices'}
            </button>
          </div>
        </div>

        {/* Net Worth Hero */}
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 16, padding: '32px 36px', marginBottom: 20,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, var(--green) 0%, var(--blue) 40%, var(--purple) 70%, var(--teal) 100%)', opacity: 0.6 }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8, fontWeight: 500 }}>Total Net Worth</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 42, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>
                {fmtCZK(totalNetWorth)}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 16 }}>
                <div style={{ fontSize: 11, color: totalGainCZK >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {totalGainCZK >= 0 ? '▲' : '▼'} {totalGainCZK >= 0 ? '+' : ''}{fmtCZK(totalGainCZK)} total gain
                </div>
                <div style={{ fontSize: 11, color: 'var(--text4)' }}>
                  {totalInvested > 0 ? `${((totalGainCZK / totalInvested) * 100).toFixed(1)}% on invested` : ''}
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8, fontWeight: 500 }}>Est. Annual Income</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 42, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--amber)' }}>
                {fmtCZK(totalAnnualIncome)}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--green)' }}>Dividends {fmtCZK(divIncomeCZK)}</span>
                <span style={{ fontSize: 11, color: 'var(--blue)' }}>Interest {fmtCZK(interestIncomeCZK)}</span>
                {rentalIncomeCZK > 0 && <span style={{ fontSize: 11, color: 'var(--teal)' }}>Rent {fmtCZK(rentalIncomeCZK)}</span>}
                {stakingIncomeCZK > 0 && <span style={{ fontSize: 11, color: 'var(--purple)' }}>Staking {fmtCZK(stakingIncomeCZK)}</span>}
              </div>
            </div>
          </div>

          {/* Asset allocation bar */}
          <div style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', gap: 2, height: 6, borderRadius: 4, overflow: 'hidden' }}>
              {assetBlocks.filter(a => a.value > 0).map(a => (
                <div key={a.label} style={{ flex: a.value, background: a.color, opacity: 0.8, transition: 'flex 0.6s ease' }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
              {assetBlocks.filter(a => a.value > 0).map(a => (
                <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: a.color }} />
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>{a.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text4)', fontFamily: "'DM Mono', monospace" }}>
                    {totalNetWorth > 0 ? ((a.value / totalNetWorth) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Asset class cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
          {assetBlocks.map((a, i) => {
            const pct = totalNetWorth > 0 ? (a.value / totalNetWorth) * 100 : 0
            const gains = i === 0 ? stockValueCZK - stockCostCZK : null
            return (
              <a key={a.label} href={a.href} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
                  padding: '18px 20px', cursor: 'pointer', position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, height: 3, width: `${pct}%`, background: a.color, opacity: 0.7, borderRadius: '0 2px 0 0', transition: 'width 0.6s ease' }} />
                  <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: a.color, marginBottom: 10, fontWeight: 600, opacity: 0.9 }}>{a.label}</div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 4 }}>{fmtCZK(a.value)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text4)' }}>
                    {pct.toFixed(1)}% of portfolio
                    {gains !== null && gains !== 0 && (
                      <span style={{ marginLeft: 8, color: gains >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {gains >= 0 ? '+' : ''}{fmtCZK(gains)} P&L
                      </span>
                    )}
                  </div>
                </div>
              </a>
            )
          })}
        </div>

        {/* Bottom row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Income breakdown */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600, marginBottom: 16 }}>Income streams</div>
            {[
              { label: 'Stock dividends', value: divIncomeCZK,      sub: `YTD received: ${fmtCZK(ytdDivCZK)}`, color: 'var(--green)',  pct: totalAnnualIncome > 0 ? divIncomeCZK / totalAnnualIncome : 0 },
              { label: 'Bank interest',   value: interestIncomeCZK, sub: `${bankAccounts.length} accounts`,       color: 'var(--blue)',   pct: totalAnnualIncome > 0 ? interestIncomeCZK / totalAnnualIncome : 0 },
              { label: 'Rental income',   value: rentalIncomeCZK,   sub: `${realEstate.filter(p => p.monthly_rent > 0).length} properties`, color: 'var(--teal)', pct: totalAnnualIncome > 0 ? rentalIncomeCZK / totalAnnualIncome : 0 },
              { label: 'Crypto staking',  value: stakingIncomeCZK,  sub: `${cryptoHoldings.filter(c => c.staking_apy > 0).length} assets`, color: 'var(--purple)', pct: totalAnnualIncome > 0 ? stakingIncomeCZK / totalAnnualIncome : 0 },
            ].map(s => (
              <div key={s.label} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>{s.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--text4)', marginLeft: 8 }}>{s.sub}</span>
                  </div>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: s.value > 0 ? s.color : 'var(--text4)' }}>
                    {s.value > 0 ? fmtCZK(s.value) : '—'}
                  </span>
                </div>
                <div style={{ height: 3, background: 'var(--bg4)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${s.pct * 100}%`, background: s.color, borderRadius: 2, opacity: 0.7, transition: 'width 0.5s ease' }} />
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Total annual</span>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: 'var(--amber)' }}>{fmtCZK(totalAnnualIncome)}</span>
            </div>
          </div>

          {/* Quick stats */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600, marginBottom: 16 }}>Portfolio snapshot</div>
            {[
              { label: 'Yield on net worth',     value: totalNetWorth > 0 ? `${((totalAnnualIncome / totalNetWorth) * 100).toFixed(2)}%` : '—', accent: 'var(--amber)' },
              { label: 'Monthly passive income', value: fmtCZK(totalAnnualIncome / 12, 0), accent: 'var(--amber)' },
              { label: 'Stock P&L',              value: `${stockCostCZK > 0 ? ((stockValueCZK - stockCostCZK) / stockCostCZK * 100).toFixed(1) : 0}%`, accent: (stockValueCZK - stockCostCZK) >= 0 ? 'var(--green)' : 'var(--red)' },
              { label: 'Real estate equity',     value: `${realEstateGrossCZK > 0 ? ((realEstateEquityCZK / realEstateGrossCZK) * 100).toFixed(0) : 0}% equity`, accent: 'var(--teal)' },
              { label: 'Holdings', value: `${holdings.length} stocks · ${bankAccounts.length} accounts · ${cryptoHoldings.length} coins · ${realEstate.length} properties`, accent: 'var(--text3)' },
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{s.label}</span>
                <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: s.accent }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  )
}

const btnSecondary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg3)', border: '1px solid var(--border2)',
  color: 'var(--text2)', fontFamily: "'Inter', sans-serif", fontSize: 12,
  display: 'flex', alignItems: 'center', gap: 4,
}
