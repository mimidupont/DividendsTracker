'use client'
import { useState } from 'react'
import { Panel } from '@/components/PageShell'
import { inputStyle } from '@/components/FormFields'
import { useAppData } from '@/hooks/useAppData'
import { useProfile } from '@/lib/profile'
import { supabase, type AssetMetadata } from '@/lib/supabase'
import { seedFor } from '@/lib/risk'
import { whtRateFor } from '@/lib/tax'
import { fmtShare } from '@/lib/fx'
import { btnStyle, tdR, tdL, th } from '@/lib/ui'

const ASSET_TYPES = [
  { key: 'stock', label: 'Stock' }, { key: 'etf', label: 'Equity ETF' },
  { key: 'bond_etf', label: 'Bond ETF' }, { key: 'reit', label: 'REIT' },
]

const SECTORS = ['Technology', 'Financials', 'Consumer Staples', 'Consumer Discretionary', 'Health Care', 'Industrials',
  'Energy', 'Materials', 'Utilities', 'Real Estate', 'Telecom']

/**
 * Per-symbol classification: asset type (a bond ETF counts as fixed income),
 * sector, region and issuer country (drives the dividend withholding default).
 * The single place these are edited; allocation, exposure and the dashboard
 * all read them from `asset_metadata`.
 */
export default function ClassificationPanel() {
  const data = useAppData()
  const { activeProfile } = useProfile()
  const [drafts, setDrafts] = useState<Record<string, Partial<AssetMetadata>>>({})
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const metaBy = new Map(data.assetMetadata.map(m => [m.symbol.toUpperCase(), m]))
  // One row per ticker: two holdings of the same symbol (an RSU grant and a
  // later purchase) share one classification.
  const symbols = Array.from(new Set(data.holdings.filter(h => h.shares > 0).map(h => h.symbol.toUpperCase())))
  const unclassified = symbols.filter(s => !(metaBy.get(s)?.sector || metaBy.get(s)?.asset_type))
  const val = (sym: string, k: keyof AssetMetadata) =>
    (drafts[sym]?.[k] ?? metaBy.get(sym)?.[k] ?? '') as string
  const set = (sym: string, k: keyof AssetMetadata, v: string) =>
    setDrafts(d => ({ ...d, [sym]: { ...d[sym], [k]: v } }))
  const dirty = Object.keys(drafts).length > 0

  const save = async () => {
    if (!activeProfile) return
    setSaving(true); setMsg(null)
    const rows = Object.entries(drafts).map(([symbol, d]) => {
      const cur = metaBy.get(symbol)
      const pick = (k: keyof AssetMetadata) => {
        const v = (d[k] ?? cur?.[k] ?? null) as string | null
        return v === '' ? null : v
      }
      return {
        profile_id: activeProfile.id, symbol,
        sector: pick('sector'), region: pick('region'), country: pick('country')?.toUpperCase() ?? null,
        asset_type: pick('asset_type'), liquidity_tier: cur?.liquidity_tier ?? 'week',
        is_hedged: cur?.is_hedged ?? false,
      }
    })
    const { error } = await supabase.from('asset_metadata').upsert(rows, { onConflict: 'profile_id,symbol' })
    setSaving(false)
    if (error) { setMsg(`Could not save: ${error.message}`); return }
    setDrafts({}); setMsg(`Saved ${rows.length} classification${rows.length > 1 ? 's' : ''}.`)
    data.reload()
  }

  /** Fill in default type/sector/region for held tickers the app knows. */
  const seed = async () => {
    if (!activeProfile) return
    setSeeding(true); setMsg(null)
    try {
      const unseeded = unclassified.filter(sym => !seedFor(sym))
      const rows = unclassified
        .map(sym => ({ sym, s: seedFor(sym) }))
        .filter((x): x is { sym: string; s: { sector: string; region: string } } => !!x.s)
        .map(({ sym, s }) => ({
          profile_id: activeProfile.id, symbol: sym, sector: s.sector, region: s.region,
          asset_type: s.sector === 'ETF' ? 'etf' : 'stock',
        }))
      if (rows.length === 0) {
        setMsg(unseeded.length ? `No default classification for ${unseeded.join(', ')} — set them below.` : 'Every holding is already classified.')
        return
      }
      const { error } = await supabase.from('asset_metadata').upsert(rows, { onConflict: 'profile_id,symbol' })
      if (error) { setMsg(`Could not classify: ${error.message}`); return }
      setMsg(`Classified ${rows.length} holding${rows.length === 1 ? '' : 's'}.` +
        (unseeded.length ? ` ${unseeded.join(', ')} still need a type and sector — set them below.` : ''))
      data.reload()
    } finally {
      setSeeding(false)
    }
  }

  if (symbols.length === 0) return null
  const cell = { ...inputStyle, padding: '4px 6px', fontSize: 12 }
  return (
    <section id="classification" style={{ marginTop: 16 }}>
      <Panel title="Classification" right={
        <span style={{ display: 'flex', gap: 6 }}>
          {unclassified.length > 0 && (
            <button type="button" onClick={seed} disabled={seeding} style={btnStyle('secondary')}>
              {seeding ? 'Classifying…' : `↺ Classify ${unclassified.length} automatically`}
            </button>
          )}
          <button type="button" onClick={save} disabled={!dirty || saving} style={btnStyle(dirty ? 'primary' : 'secondary')}>
            {saving ? 'Saving…' : dirty ? `Save ${Object.keys(drafts).length} change${Object.keys(drafts).length > 1 ? 's' : ''}` : 'Saved'}
          </button>
        </span>
      } padded={false}>
        {msg && <div role="status" style={{ padding: '8px 18px', fontSize: 11, color: 'var(--text2)' }}>{msg}</div>}
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="sr-only">Classification of each holding</caption>
            <thead><tr>
              {['Symbol', 'Type', 'Sector', 'Region', 'Issuer country', 'Withholding'].map((h, i) => (
                <th key={h} scope="col" style={{ ...th, textAlign: i === 5 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {symbols.map(sym => {
                const wht = whtRateFor({ country: val(sym, 'country'), region: val(sym, 'region') })
                return (
                  <tr key={sym}>
                    <td style={{ ...tdL, fontWeight: 500 }}>{sym}</td>
                    <td style={tdL}>
                      <select aria-label={`${sym} type`} style={cell} value={val(sym, 'asset_type')} onChange={e => set(sym, 'asset_type', e.target.value)}>
                        <option value="">—</option>
                        {ASSET_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </td>
                    <td style={tdL}><input aria-label={`${sym} sector`} style={cell} value={val(sym, 'sector')} onChange={e => set(sym, 'sector', e.target.value)} placeholder="Technology" list="sector-options" /></td>
                    <td style={tdL}>
                      <select aria-label={`${sym} region`} style={cell} value={val(sym, 'region')} onChange={e => set(sym, 'region', e.target.value)}>
                        <option value="">—</option>
                        {['US', 'EU', 'CZ', 'UK', 'Global', 'EM', 'Other'].map(r => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={tdL}><input aria-label={`${sym} issuer country`} style={{ ...cell, width: 64 }} maxLength={2} value={val(sym, 'country')} onChange={e => set(sym, 'country', e.target.value.toUpperCase())} placeholder="US" /></td>
                    <td className="num" style={tdR} title={wht.basis === 'default' ? 'Country unknown — US treaty rate assumed' : undefined}>
                      {fmtShare(wht.rate * 100, wht.rate * 100 % 1 ? 2 : 0)}{wht.basis === 'default' && ' ?'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <datalist id="sector-options">
            {SECTORS.map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
      </Panel>
    </section>
  )
}
