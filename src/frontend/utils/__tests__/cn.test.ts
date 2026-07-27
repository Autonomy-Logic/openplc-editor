import { cn } from '../cn'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    const condition = false as boolean
    expect(cn('foo', condition && 'bar', 'baz')).toBe('foo baz')
  })

  it('merges tailwind classes with last-wins', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })

  it('handles undefined and null inputs', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar')
  })

  it('handles empty inputs', () => {
    expect(cn()).toBe('')
  })

  it('handles array inputs', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })

  it('keeps custom cp-* font sizes alongside a text color (not treated as conflicting)', () => {
    // Regression: tailwind-merge, unaware of our `cp-*` size scale, used to drop
    // `text-cp-xs` when a `text-<color>` shared the class list. The extended
    // config must keep both.
    expect(cn('text-cp-xs', 'text-neutral-700')).toBe('text-cp-xs text-neutral-700')
  })

  it('resolves conflicts within the custom cp-* font-size group last-wins', () => {
    expect(cn('text-cp-sm', 'text-cp-base')).toBe('text-cp-base')
    expect(cn('text-xs', 'text-cp-base')).toBe('text-cp-base')
  })
})
