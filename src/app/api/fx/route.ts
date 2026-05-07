import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=CZK&to=USD,EUR,GBP', {
      next: { revalidate: 3600 }, // cache for 1 hour
    })
    if (!res.ok) throw new Error(`Frankfurter responded ${res.status}`)
    const data = await res.json()

    const rates: Record<string, number> = { CZK: 1 }
    for (const [ccy, rate] of Object.entries(data.rates as Record<string, number>)) {
      rates[ccy] = 1 / (rate as number)
    }

    return NextResponse.json({ rates, fetchedAt: new Date().toISOString() })
  } catch (err) {
    console.error('[api/fx]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
