export const DEFAULT_FX: Record<string, number> = { USD: 20.65, EUR: 23.40, CZK: 1, GBP: 27.50 }

export const toCZK = (amount: number, ccy: string, fx = DEFAULT_FX) =>
  amount * (fx[ccy] ?? fx['USD'] ?? 20.65)

export const fmtCZK = (n: number, decimals = 0) =>
  `Kč\u202f${n.toLocaleString('cs-CZ', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`

export const fmtNum = (n: number, d = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export const fmtDateShort = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export async function fetchFxRates(): Promise<Record<string, number>> {
  try {
    // Call our own API route — avoids any browser CORS issues with Frankfurter
    const res = await fetch('/api/fx')
    if (!res.ok) throw new Error(`/api/fx responded ${res.status}`)
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    console.log('[fx] live rates fetched:', data.rates)
    return data.rates as Record<string, number>
  } catch (err) {
    console.error('[fx] fetch failed, using defaults:', err)
    return DEFAULT_FX
  }
}
