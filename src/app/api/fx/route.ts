import { NextResponse } from 'next/server'

/**
 * Never prerendered: a build-time fetch would bake that day's rates into the
 * deployment (and a build-time failure would bake in an error page). The inner
 * fetch below is still cached for an hour, so Frankfurter is not hammered.
 */
export const dynamic = 'force-dynamic'

/**
 * Live FX rates expressed as CZK per 1 unit of foreign currency.
 *
 * Frankfurter returns the inverse (foreign per 1 CZK) when asked with
 * `from=CZK`, so every rate is flipped below. No `to=` filter is sent: fetching
 * the full table means a holding in a currency we didn't anticipate still gets
 * converted correctly instead of falling back to a hardcoded rate.
 */
export async function GET() {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=CZK', {
      next: { revalidate: 3600 }, // cache for 1 hour
    })
    if (!res.ok) throw new Error(`Frankfurter responded ${res.status}`)
    const data = await res.json()

    if (!data?.rates || typeof data.rates !== 'object') {
      throw new Error('Frankfurter returned no rates')
    }

    const rates: Record<string, number> = { CZK: 1 }
    for (const [ccy, rate] of Object.entries(data.rates as Record<string, number>)) {
      const r = Number(rate)
      // A zero or non-finite rate would make 1/r infinite and poison every total
      if (!isFinite(r) || r <= 0) continue
      rates[ccy.toUpperCase()] = 1 / r
    }

    return NextResponse.json({
      rates,
      base: 'CZK',
      // The rate date from the provider — FX is published once per business day
      rateDate: data.date ?? null,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[api/fx]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
