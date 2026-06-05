import { parseDimensionRange } from '../dimension-range'

describe('parseDimensionRange', () => {
  it('parses a simple range "0..5"', () => {
    const result = parseDimensionRange('0..5')
    expect(result).toEqual({ lower: 0, upper: 5 })
  })

  it('parses a range starting at 1', () => {
    const result = parseDimensionRange('1..10')
    expect(result).toEqual({ lower: 1, upper: 10 })
  })

  it('parses negative lower bound', () => {
    const result = parseDimensionRange('-3..5')
    expect(result).toEqual({ lower: -3, upper: 5 })
  })

  it('parses negative upper bound', () => {
    const result = parseDimensionRange('-10..-1')
    expect(result).toEqual({ lower: -10, upper: -1 })
  })

  it('parses a single-element range where lower equals upper', () => {
    const result = parseDimensionRange('5..5')
    expect(result).toEqual({ lower: 5, upper: 5 })
  })

  it('returns null when lower > upper', () => {
    const result = parseDimensionRange('10..5')
    expect(result).toBeNull()
  })

  it('returns null for invalid format (no dots)', () => {
    const result = parseDimensionRange('0-5')
    expect(result).toBeNull()
  })

  it('returns null for single dot', () => {
    const result = parseDimensionRange('0.5')
    expect(result).toBeNull()
  })

  it('returns null for triple dots', () => {
    const result = parseDimensionRange('0...5')
    expect(result).toBeNull()
  })

  it('returns null for empty string', () => {
    const result = parseDimensionRange('')
    expect(result).toBeNull()
  })

  it('returns null for non-numeric values', () => {
    const result = parseDimensionRange('a..b')
    expect(result).toBeNull()
  })

  it('returns null for missing bounds', () => {
    const result = parseDimensionRange('..5')
    expect(result).toBeNull()
  })
})
