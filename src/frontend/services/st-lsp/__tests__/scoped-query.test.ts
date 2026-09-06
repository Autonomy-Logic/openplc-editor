import { afterEach, describe, expect, it } from '@jest/globals'

import { getScopedQueryApi, isValueCompletionKind, registerScopedQueryApi, splitExpression } from '../scoped-query'

afterEach(() => registerScopedQueryApi(null))

describe('splitExpression', () => {
  it('splits on the last dot', () => {
    expect(splitExpression('m.Gear.rat')).toEqual({ anchor: 'm.Gear.', segment: 'rat' })
  })

  it('yields an empty segment when the expression ends on the dot', () => {
    expect(splitExpression('motor.')).toEqual({ anchor: 'motor.', segment: '' })
  })

  it('yields an empty anchor for a bare partial, which asks for the whole scope', () => {
    expect(splitExpression('mot')).toEqual({ anchor: '', segment: 'mot' })
    expect(splitExpression('')).toEqual({ anchor: '', segment: '' })
  })

  it('keeps a subscript inside the anchor', () => {
    expect(splitExpression('bank[1].sp')).toEqual({ anchor: 'bank[1].', segment: 'sp' })
  })
})

describe('isValueCompletionKind', () => {
  it('accepts Variable(6) — in-scope variables and function-block members', () => {
    expect(isValueCompletionKind(6)).toBe(true)
  })

  it('accepts Field(5) — STRUCT members', () => {
    // strucpp reports these differently from instance members; rejecting
    // Field would mean struct-member access never completes anywhere.
    expect(isValueCompletionKind(5)).toBe(true)
  })

  it('rejects keywords and everything else', () => {
    expect(isValueCompletionKind(14)).toBe(false)
    expect(isValueCompletionKind(3)).toBe(false)
    expect(isValueCompletionKind(undefined)).toBe(false)
  })
})

describe('scoped query registration', () => {
  it('is null until an implementation registers, so callers degrade instead of throwing', () => {
    expect(getScopedQueryApi()).toBeNull()
  })

  it('hands back the registered implementation and clears on null', () => {
    const api = { completeInScope: () => Promise.resolve([]) }
    registerScopedQueryApi(api)
    expect(getScopedQueryApi()).toBe(api)
    registerScopedQueryApi(null)
    expect(getScopedQueryApi()).toBeNull()
  })
})
