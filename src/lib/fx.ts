// FX rates to CZK — refreshed manually or via updateFxRates()
export const DEFAULT_FX: Record<string, number> = { USD: 23.50, EUR: 25.60, CZK: 1, GBP: 29.80 }

export const toCZK = (amount: number, ccy: string, fx = DEFAULT_FX) =>
  amount * (fx[ccy] ?? fx['USD'] ?? 23.50)

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

// Fetch live FX rates from ECB / frankfurter.app (free, no key)
export async function fetchFxRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=CZK&to=USD,EUR,GBP')
    if (!res.ok) throw new Error('FX fetch failed')
    const data = await res.json()
    // data.rates = { USD: 0.042..., EUR: 0.039... } — these are CZK per 1 unit of foreign
    // We want foreign → CZK, so invert
    const rates: Record<string, number> = { CZK: 1 }
    for (const [ccy, rate] of Object.entries(data.rates as Record<string, number>)) {
      rates[ccy] = 1 / rate
    }
    return rates
  } catch {
    return DEFAULT_FX
  }
}
