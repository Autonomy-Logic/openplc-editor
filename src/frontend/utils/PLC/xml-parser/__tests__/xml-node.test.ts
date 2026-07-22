import { asArray, asRecord, asString } from '../xml-node'

describe('asRecord', () => {
  it('returns the object when given an object', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 })
  })

  it('returns {} for non-object values', () => {
    expect(asRecord('')).toEqual({})
    expect(asRecord(null)).toEqual({})
    expect(asRecord(undefined)).toEqual({})
    expect(asRecord(42)).toEqual({})
  })
})

describe('asArray', () => {
  it('returns [] for undefined', () => {
    expect(asArray(undefined)).toEqual([])
  })

  it('wraps a bare value in an array', () => {
    expect(asArray({ a: 1 })).toEqual([{ a: 1 }])
  })

  it('returns the array unchanged when already an array', () => {
    expect(asArray([1, 2, 3])).toEqual([1, 2, 3])
  })
})

describe('asString', () => {
  it('returns the string when given a string', () => {
    expect(asString('hello')).toBe('hello')
  })

  it('returns "" for non-string values', () => {
    expect(asString(42)).toBe('')
    expect(asString(undefined)).toBe('')
    expect(asString(null)).toBe('')
    expect(asString({})).toBe('')
  })
})
