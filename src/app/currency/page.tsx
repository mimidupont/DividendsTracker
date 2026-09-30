import { redirect } from 'next/navigation'

/**
 * Currency exposure now lives on Allocation (cross-asset, including cash,
 * bonds, crypto and property — this page only ever covered stocks).
 */
export default function CurrencyPage() {
  redirect('/allocation#currency')
}
