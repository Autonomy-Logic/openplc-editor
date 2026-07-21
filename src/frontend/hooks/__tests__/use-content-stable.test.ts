import { renderHook } from '@testing-library/react'

import { mapsEqual, useContentStable } from '../use-content-stable'

describe('mapsEqual', () => {
  it('returns true for the same reference', () => {
    const map = new Map([['a', 1]])
    expect(mapsEqual(map, map)).toBe(true)
  })

  it('returns true for different instances with equal content', () => {
    expect(
      mapsEqual(
        new Map([
          ['a', 1],
          ['b', 2],
        ]),
        new Map([
          ['b', 2],
          ['a', 1],
        ]),
      ),
    ).toBe(true)
  })

  it('returns false when sizes differ', () => {
    expect(mapsEqual(new Map([['a', 1]]), new Map())).toBe(false)
  })

  it('returns false when a value differs', () => {
    expect(mapsEqual(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false)
  })

  it('returns false when a key is missing', () => {
    expect(mapsEqual(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false)
  })

  it('distinguishes a missing key from an undefined value', () => {
    expect(mapsEqual(new Map([['a', undefined]]), new Map([['b', undefined]]))).toBe(false)
  })
})

describe('useContentStable', () => {
  type States = Map<string, boolean> | null
  const statesEqual = (a: States, b: States) => a !== null && b !== null && mapsEqual(a, b)

  const render = (initial: States) =>
    renderHook(({ value }: { value: States }) => useContentStable(value, statesEqual), {
      initialProps: { value: initial },
    })

  it('keeps the previous reference when content is equal', () => {
    const first = new Map([['edge-1', true]])
    const { result, rerender } = render(first)

    rerender({ value: new Map([['edge-1', true]]) })

    expect(result.current).toBe(first)
  })

  it('swaps to the new reference when content differs', () => {
    const first = new Map([['edge-1', true]])
    const { result, rerender } = render(first)

    const changed = new Map([['edge-1', false]])
    rerender({ value: changed })

    expect(result.current).toBe(changed)
  })

  it('transitions from a value to null (equality returns false for null)', () => {
    const first = new Map([['edge-1', true]])
    const { result, rerender } = render(first)

    rerender({ value: null })

    expect(result.current).toBeNull()
  })

  it('transitions from null to a value', () => {
    const { result, rerender } = render(null)

    const next = new Map([['edge-1', true]])
    rerender({ value: next })

    expect(result.current).toBe(next)
  })

  it('keeps the stable reference across multiple equal-content updates', () => {
    const first = new Map([['edge-1', true]])
    const { result, rerender } = render(first)

    rerender({ value: new Map([['edge-1', true]]) })
    rerender({ value: new Map([['edge-1', true]]) })

    expect(result.current).toBe(first)
  })
})
