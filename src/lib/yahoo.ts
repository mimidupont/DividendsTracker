const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export const YAHOO_SYMBOL_MAP: Record<string, string> = {
  SPY5:  'SPY5.L',
  SPYW:  'SPYW.DE',
  CSG1:  'CSG1.AS',
  ERBAG: 'ERBAG.PR',
  MONET: 'MONET.PR',
  BNP: 'BNP.PA',
}

export const toYahoo = (symbol: string) => YAHOO_SYMBOL_MAP[symbol] ?? symbol

export interface YahooSession { crumb: string; cookie: string }

/**
 * Cached session, shared by every request the server handles.
 *
 * The cookie+crumb handshake is two extra round trips to Yahoo, and it was
 * being redone for every single /api/market call — including the one fired on
 * each keystroke of a ticker lookup. Yahoo's crumb stays valid far longer than
 * this; the TTL is deliberately conservative.
 */
let sessionCache: { session: YahooSession; at: number } | null = null
let sessionInFlight: Promise<YahooSession | null> | null = null
const SESSION_TTL = 15 * 60 * 1000

export async function getYahooSession(force = false): Promise<YahooSession | null> {
  if (!force && sessionCache && Date.now() - sessionCache.at < SESSION_TTL) {
    return sessionCache.session
  }
  // Concurrent callers share one handshake rather than each starting their own.
  if (sessionInFlight) return sessionInFlight

  sessionInFlight = createYahooSession()
    .then(session => {
      // A failed handshake is not cached: the next call should retry, since
      // pinning null here would disable the Yahoo fallback for 15 minutes.
      if (session) sessionCache = { session, at: Date.now() }
      return session
    })
    .finally(() => { sessionInFlight = null })

  return sessionInFlight
}

async function createYahooSession(): Promise<YahooSession | null> {
  try {
    const homeRes = await fetch('https://finance.yahoo.com/quote/AAPL/', {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
    })
    const setCookies: string[] =
      typeof (homeRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (homeRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : (homeRes.headers.get('set-cookie') ?? '').split(',')
    const cookie = setCookies.map(c => c.split(';')[0].trim()).filter(c => c.includes('=')).join('; ')

    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: cookie },
    })
    if (!crumbRes.ok) return null
    const crumb = (await crumbRes.text()).trim()
    if (!crumb || crumb.startsWith('<') || crumb.length > 20) return null
    return { crumb, cookie }
  } catch {
    return null
  }
}

export async function fetchYahooQuoteSummary(
  yahooSymbol: string,
  modules: string,
  crumb: string,
  cookie: string
) {
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}` +
    `?modules=${modules}&crumb=${encodeURIComponent(crumb)}`

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: cookie },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const result = data?.quoteSummary?.result?.[0]
  if (!result) throw new Error('No data')
  return result
}

/** Run tasks in batches of `concurrency` */
export async function batchedMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = await Promise.all(items.slice(i, i + concurrency).map(fn))
    results.push(...batch)
  }
  return results
}
