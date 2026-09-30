import { describe, it, expect } from 'vitest'
import { parseDecimal, parsePercent } from './parse'

describe('parseDecimal', () => {
  it.each([
    ['1 234,56', 1234.56],
    ['1 234,56', 1234.56],
    ['250 000', 250000],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['12,5', 12.5],
    ['12.5', 12.5],
    ['1,234,567', 1234567],
    ['-3,5', -3.5],
    ['−3,5', -3.5],
    ['Kč 1 000', 1000],
    ['0', 0],
  ])('%s → %d', (raw, expected) => {
    expect(parseDecimal(raw)).toBeCloseTo(expected, 9)
  })
  it.each(['', 'abc', '1-2', '--1'])('rejects %s', raw => {
    expect(parseDecimal(raw)).toBeNull()
  })
})

describe('parsePercent', () => {
  it('reads a typed percentage as a fraction', () => {
    expect(parsePercent('4,5')).toBeCloseTo(0.045, 12)
    expect(parsePercent('4.5 %')).toBeCloseTo(0.045, 12)
  })
})
