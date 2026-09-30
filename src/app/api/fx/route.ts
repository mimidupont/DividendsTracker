import { NextResponse } from 'next/server'

/**
 * Never prerendered: a build-time fetch would bake that day's rates into the
 * deployment (and a build-time failure would bake in an error page). The inner
 * fetch below is still cached, so Frankfurter is not hammered.
 */
export const dynamic = 'force-dynamic'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * FX rates expressed as CZK per 1 unit of foreign currency.
 *
 * `GET /api/fx`                 → latest rates
 * `GET /api/fx?date=YYYY-MM-DD` → rates on that date (the nearest earlier
 *                                  business day), for freezing the rate on a
 *                                  historical lot, dividend or ledger row.
 *
 * Frankfurter returns the inverse (foreign per 1 CZK) when asked with
 * `from=CZK`, so every rate is flipped below. No `to=` filter is sent: fetching
 * the full table means a holding in a currency we didn't anticipate still gets
 * converted correctly instead of falling back to a hardcoded rate.
 */
export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get('date')
  if (date != null && (!ISO_DATE.test(date) || date < '1999-01-04' || date > new Date().toISOString().slice(0, 10))) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD, between 1999-01-04 and today' }, { status: 400 })
  }

  try {
    const path = date ?? 'latest'
    const res = await fetch(`https://api.frankfurter.app/${path}?from=CZK`, {
      // A historical table never changes; the latest one is refreshed hourly.
      next: { revalidate: date ? 60 * 60 * 24 * 30 : 3600 },
      signal: AbortSignal.timeout(8000),
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
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
