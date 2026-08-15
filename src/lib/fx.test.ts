import { describe, it, expect, vi } from 'vitest'
import {
  toCZK, normalizeMoney, normalizeCurrencyCode, fxRate, hasFxRate,
  DEFAULT_FX, MINOR_UNITS, fmtPct, fmtDate, fmtDateShort,
} from './fx'

const fx = { CZK: 1, USD: 23, EUR: 25, GBP: 29 }

describe('normalizeMoney', () => {
  it('folds pence into pounds', () => {
    expect(normalizeMoney(2450, 'GBp')).toEqual({ amount: 24.5, ccy: 'GBP' })
    expect(normalizeMoney(2450, 'GBX')).toEqual({ amount: 24.5, ccy: 'GBP' })
  })
  it('folds the other minor units', () => {
    expect(normalizeMoney(100, 'ZAc').ccy).toBe('ZAR')
    expect(normalizeMoney(100, 'ILA').ccy).toBe('ILS')
  })
  it('upper-cases an ordinary code and defaults an empty one to CZK', () => {
    expect(normalizeCurrencyCode('usd')).toBe('USD')
    expect(normalizeCurrencyCode(null)).toBe('CZK')
    expect(normalizeCurrencyCode('  ')).toBe('CZK')
  })
})

describe('toCZK', () => {
  it('converts at the given rate', () => {
    expect(toCZK(100, 'USD', fx)).toBeCloseTo(2300, 9)
  })
  it('converts a minor unit exactly once', () => {
    // 1000 pence = £10 = 290 CZK, not 29 000 and not 2.90.
    expect(toCZK(1000, 'GBp', fx)).toBeCloseTo(290, 9)
  })
  it('leaves an unknown currency unconverted rather than using another rate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(toCZK(100, 'XYZ', fx)).toBe(100)
    warn.mockRestore()
  })
  it('returns 0 for a non-finite amount instead of propagating NaN', () => {
    expect(toCZK(NaN, 'USD', fx)).toBe(0)
    expect(toCZK(Infinity, 'USD', fx)).toBe(0)
  })
})

describe('fxRate / hasFxRate', () => {
  it('rejects zero, negative and missing rates', () => {
    expect(fxRate('USD', { USD: 0 })).toBeNull()
    expect(fxRate('USD', { USD: -1 })).toBeNull()
    expect(hasFxRate('XYZ', fx)).toBe(false)
    expect(hasFxRate('GBp', fx)).toBe(true)
  })
})

// BUG-04 — folding can produce a currency that DEFAULT_FX must be able to price,
// or a fallback FX fetch drops the holding into the unconverted path.
describe('DEFAULT_FX covers every minor-unit major', () => {
  it.each(Object.entries(MINOR_UNITS))('%s → major has a fallback rate', (_key, unit) => {
    expect(DEFAULT_FX[unit.major]).toBeGreaterThan(0)
  })
})

describe('formatters refuse to render junk as data', () => {
  it('shows an em dash for NaN rather than 0.00%', () => {
    expect(fmtPct(NaN)).toBe('—')
    expect(fmtPct(0)).toBe('+0.00%')
    expect(fmtPct(-1.5)).toBe('-1.50%')
  })
  it('shows an em dash for an unparseable date', () => {
    expect(fmtDate('not-a-date')).toBe('—')
    expect(fmtDateShort('')).toBe('—')
    expect(fmtDate('2024-03-05')).toContain('2024')
  })
})
