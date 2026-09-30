/**
 * parse.ts — reading numbers the way a Czech user types them.
 *
 * `<input type="number">` rejects "1 234,56" (what a Czech bank statement
 * shows) and hands back '' — the form then failed silently. Inputs are plain
 * text with inputMode="decimal", parsed here.
 */

/**
 * Parse a decimal typed in either Czech ("1 234,56") or English ("1,234.56")
 * convention. Spaces (incl. non-breaking/narrow) are thousands separators.
 * When both ',' and '.' appear, the last one is the decimal separator. A lone
 * ',' is a decimal comma; a lone '.' is a decimal point. Returns null for
 * anything that is not a finite number.
 */
export function parseDecimal(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return isFinite(raw) ? raw : null
  let s = raw.trim().replace(/[\s  ']/g, '').replace(/^\+/, '').replace(/−/g, '-')
  // Currency symbols and % are tolerated.
  s = s.replace(/(kč|czk|usd|eur|\$|€|£|%)/gi, '')
  if (!s || !/^-?[\d.,]+$/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.'
    const thou = dec === ',' ? '.' : ','
    s = s.split(thou).join('').replace(dec, '.')
  } else if (lastComma >= 0) {
    // "1,234" with exactly three digits after a single comma is ambiguous;
    // Czech convention wins (decimal comma) unless there are several commas.
    const parts = s.split(',')
    s = parts.length > 2 ? parts.join('') : s.replace(',', '.')
  } else if (lastDot >= 0) {
    const parts = s.split('.')
    if (parts.length > 2) s = parts.join('')
  }
  const n = Number(s)
  return isFinite(n) ? n : null
}

/** A positive number, or null. */
export const parsePositive = (raw: string | number | null | undefined): number | null => {
  const n = parseDecimal(raw)
  return n != null && n > 0 ? n : null
}

/** A percentage typed as "4,5" or "4.5 %" → 0.045. */
export const parsePercent = (raw: string | number | null | undefined): number | null => {
  const n = parseDecimal(raw)
  return n == null ? null : n / 100
}
