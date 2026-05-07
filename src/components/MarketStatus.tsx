'use client'
import type { MarketState } from '@/hooks/useMarketData'

const COLOR: Record<MarketState, string> = {
  idle: 'var(--text3)',
  loading: 'var(--amber)',
  done: 'var(--green)',
  error: 'var(--red)',
}

export default function MarketStatus({
  state,
  fetchedAt,
  errorMsg,
}: {
  state: MarketState
  fetchedAt: string | null
  errorMsg: string | null
}) {
  const text = {
    idle: '',
    loading: '⟳ Fetching live prices…',
    done: `✓ Live · ${fetchedAt ? new Date(fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}`,
    error: `⚠ ${errorMsg ?? 'Price fetch failed'}`,
  }[state]

  if (!text) return null
  return <span style={{ color: COLOR[state] }}>{text}</span>
}
