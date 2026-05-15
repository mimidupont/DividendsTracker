/**
 * stockanalysis.ts
 *
 * Scrapes stockanalysis.com for price, dividend yield, and ex-date data.
 * The site renders via Next.js and embeds all quote data in a
 * `__NEXT_DATA__` <script> tag — no auth or cookie dance required.
 *
 * Supported page types:
 *   /stocks/{slug}/  — individual stocks (US and international)
 *   /etf/{slug}/     — ETFs (US-listed and UCITS)
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface SAQuote {
  symbol: string
  price: number | null
  changePercent: number | null
  dividendYield: number | null          // decimal, e.g. 0.031
  annualDividend: number | null         // $ per year
  exDividendDate: string | null         // ISO date string  "2025-06-13"
  payDividendDate: string | null
  lastDividendAmount: number | null
  currency: string
  longName: string | null
  source: 'stockanalysis'
  error?: string
}

/**
 * Complete map of every portfolio ticker to its StockAnalysis URL slug and page type.
 * currency is the native trading currency — critical for non-US tickers.
 */
const SA_SYMBOL_MAP: Record<string, {
  slug: string
  type: 'stocks' | 'etf'
  currency: string
  exchange?: string
}> = {
  // ── US stocks ──────────────────────────────────────────────────────────────
  JPM:  { slug: 'jpm',  type: 'stocks', currency: 'USD' },
  KO:   { slug: 'ko',   type: 'stocks', currency: 'USD' },
  T:    { slug: 't',    type: 'stocks', currency: 'USD' },
  MCD:  { slug: 'mcd',  type: 'stocks', currency: 'USD' },
  AMZN: { slug: 'amzn', type: 'stocks', currency: 'USD' },
  AAPL: { slug: 'aapl', type: 'stocks', currency: 'USD' },
  RIO:  { slug: 'rio',  type: 'stocks', currency: 'USD' },
  VZ:   { slug: 'vz',   type: 'stocks', currency: 'USD' },
  O:    { slug: 'o',    type: 'stocks', currency: 'USD' },
  PEP:  { slug: 'pep',  type: 'stocks', currency: 'USD' },
  PG:   { slug: 'pg',   type: 'stocks', currency: 'USD' },
  ICL:  { slug: 'icl',  type: 'stocks', currency: 'USD' },
  OPEN: { slug: 'open', type: 'stocks', currency: 'USD' },
  KPLT: { slug: 'kplt', type: 'stocks', currency: 'USD' },
  PSNY: { slug: 'psny', type: 'stocks', currency: 'USD' },
  BYND: { slug: 'bynd', type: 'stocks', currency: 'USD' },
  SKLZ: { slug: 'sklz', type: 'stocks', currency: 'USD' },

  // ── US-listed ETFs ─────────────────────────────────────────────────────────
  SPY:  { slug: 'spy',  type: 'etf',    currency: 'USD' },

  // ── UCITS / European ETFs ──────────────────────────────────────────────────
  // SPY5 = SPDR S&P 500 UCITS ETF (LSE, USD-denominated)
  SPY5: { slug: 'spy5', type: 'etf',    currency: 'USD' },
  // SPYW = SPDR Euro Dividend Aristocrats UCITS ETF (XETRA, EUR-denominated)
  SPYW: { slug: 'spyw', type: 'etf',    currency: 'EUR' },

  // ── International stocks ───────────────────────────────────────────────────
  // CSG1 = CSG NV (Amsterdam, EUR)
  CSG1:  { slug: 'csg1',  type: 'stocks', currency: 'EUR' },
  // ERBAG = Erste Group Bank AG (Prague Stock Exchange, CZK)
  ERBAG: { slug: 'erbag', type: 'stocks', currency: 'CZK' },
  // MONET = Moneta Money Bank AS (Prague Stock Exchange, CZK)
  MONET: { slug: 'monet', type: 'stocks', currency: 'CZK' },
  BNP:   { slug: 'bnp',   type: 'stocks', currency: 'EUR', exchange: 'epa' },
}

export function isSASupported(symbol: string): boolean {
  return symbol.toUpperCase() in SA_SYMBOL_MAP
}

/** Normalise yield values to a 0–1 decimal fraction. SA uses percent strings. */
function parseYield(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '-' || raw === 'N/A') return null
  const n = parseFloat(String(raw).replace('%', '').trim())
  if (isNaN(n) || n === 0) return null
  return n > 1 ? n / 100 : n
}

function parseNum(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '-' || raw === 'N/A') return null
  const n = parseFloat(String(raw))
  return isNaN(n) ? null : n
}

/** Accept "YYYY-MM-DD" or human-readable date strings; always return ISO or null. */
function parseDate(raw: unknown): string | null {
  if (!raw || raw === '-' || raw === 'N/A') return null
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Walk multiple possible containers and return the first defined value for key. */
function pick(sources: object[], key: string): unknown {
  for (const src of sources) {
    const val = (src as Record<string, unknown>)[key]
    if (val !== undefined && val !== null && val !== '-' && val !== 'N/A') return val
  }
  return null
}

/**
 * Fetch and parse the StockAnalysis page for a single ticker.
 * Returns null if the ticker is not in the symbol map.
 */
export async function fetchSAQuote(symbol: string): Promise<SAQuote | null> {
  const entry = SA_SYMBOL_MAP[symbol.toUpperCase()]
  if (!entry) return null

    const url = entry.exchange
      ? `https://stockanalysis.com/${entry.type}/${entry.exchange}/${entry.slug}/`
      : `https://stockanalysis.com/${entry.type}/${entry.slug}/`
  const empty: SAQuote = {
    symbol, price: null, changePercent: null, dividendYield: null,
    annualDividend: null, exDividendDate: null, payDividendDate: null,
    lastDividendAmount: null, currency: entry.currency, longName: null,
    source: 'stockanalysis',
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      next: { revalidate: 0 },
    })
    if (!res.ok) return { ...empty, error: `HTTP ${res.status}` }

    const html = await res.text()

    const match = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    )
    if (!match) return { ...empty, error: 'No __NEXT_DATA__ found' }

    let nextData: Record<string, unknown>
    try { nextData = JSON.parse(match[1]) }
    catch { return { ...empty, error: 'Failed to parse __NEXT_DATA__' } }

    const pageProps = (nextData?.props as any)?.pageProps ?? {}
    const data      = pageProps?.data ?? {}
    const quoteObj  = data?.quote ?? data?.stockQuote ?? {}

    // Collect all likely data containers; pick() searches them in order
    const containers: object[] = [
      data?.info  ?? {},
      data?.stats ?? {},
      quoteObj,
      data,
      pageProps,
    ].filter(Boolean)

    const price        = parseNum(pick([quoteObj, data], 'price') ?? pick([quoteObj, data], 'p'))
    const changePercent = parseNum(
      pick([quoteObj, data], 'change1d') ??
      pick([quoteObj, data], 'changePercent') ??
      pick([quoteObj, data], 'changesPercentage')
    )
    const dividendYield      = parseYield(pick(containers, 'dividendYield') ?? pick(containers, 'yield'))
    const annualDividend     = parseNum(pick(containers, 'annualDividend') ?? pick(containers, 'dividendRate') ?? pick(containers, 'forwardAnnualDividend'))
    const exDividendDate     = parseDate(pick(containers, 'exDividendDate') ?? pick(containers, 'exDate'))
    const payDividendDate    = parseDate(pick(containers, 'dividendPayDate') ?? pick(containers, 'payDate') ?? pick(containers, 'paymentDate'))
    const lastDividendAmount = parseNum(pick(containers, 'lastDividendAmount') ?? pick(containers, 'lastDividend') ?? pick(containers, 'dividendAmount'))
    const longName           = String(pick(containers, 'name') ?? '') || null

    return {
      symbol, price, changePercent, dividendYield, annualDividend,
      exDividendDate, payDividendDate, lastDividendAmount,
      // Always use our map's currency — SA may show USD for dual-listed non-US stocks
      currency: entry.currency,
      longName, source: 'stockanalysis',
    }
  } catch (e) {
    return { ...empty, error: String(e) }
  }
}

/**
 * Batch-fetch SA quotes for multiple symbols with a concurrency limit.
 * Returns a map of symbol → SAQuote | null (null = not in symbol map).
 */
export async function batchFetchSAQuotes(
  symbols: string[],
  concurrency = 6
): Promise<Record<string, SAQuote | null>> {
  const results: Record<string, SAQuote | null> = {}
  for (const s of symbols) {
    if (!isSASupported(s)) results[s] = null
  }
  const supported = symbols.filter(isSASupported)
  for (let i = 0; i < supported.length; i += concurrency) {
    const batch   = supported.slice(i, i + concurrency)
    const settled = await Promise.all(batch.map(s => fetchSAQuote(s)))
    batch.forEach((s, idx) => { results[s] = settled[idx] })
  }
  return results
}
