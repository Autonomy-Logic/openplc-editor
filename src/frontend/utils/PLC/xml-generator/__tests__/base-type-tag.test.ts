import { baseTypeTag } from '../base-type-tag'

describe('baseTypeTag', () => {
  it('lowercases string regardless of input casing', () => {
    expect(baseTypeTag('string')).toBe('string')
    expect(baseTypeTag('STRING')).toBe('string')
    expect(baseTypeTag('String')).toBe('string')
  })

  it('lowercases wstring regardless of input casing', () => {
    expect(baseTypeTag('wstring')).toBe('wstring')
    expect(baseTypeTag('WSTRING')).toBe('wstring')
    expect(baseTypeTag('WString')).toBe('wstring')
  })

  it('uppercases every other base type', () => {
    expect(baseTypeTag('int')).toBe('INT')
    expect(baseTypeTag('INT')).toBe('INT')
    expect(baseTypeTag('bool')).toBe('BOOL')
    expect(baseTypeTag('Real')).toBe('REAL')
    expect(baseTypeTag('TIME')).toBe('TIME')
  })

  it('trims surrounding whitespace before classifying', () => {
    expect(baseTypeTag('  STRING  ')).toBe('string')
    expect(baseTypeTag('\tINT\n')).toBe('INT')
  })
})
