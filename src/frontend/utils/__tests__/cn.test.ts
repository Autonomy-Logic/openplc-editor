import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cn } from '../cn'

/**
 * The `cp-*` font scale is declared twice: once in `tailwind.config.ts`, where
 * it generates the classes, and once inside `cn()`, where twMerge has to be
 * told those names are sizes. Read the scale out of the config rather than
 * restating it here, so the "keep this list in step" comment on `cn()` is
 * enforced by this suite instead of hoped for — a fourth size added to
 * Tailwind and forgotten in `cn()` fails below rather than silently
 * evaporating at runtime, which is exactly how the Connect button lost its
 * `text-cp-sm` with no warning and no build error.
 */
function tailwindFontSizeNames(): string[] {
  const config = readFileSync(join(process.cwd(), 'tailwind.config.ts'), 'utf8')
  const block = /fontSize:\s*\{([\s\S]*?)\n\s*\},/.exec(config)
  if (!block) throw new Error('No `fontSize` block found in tailwind.config.ts')
  return [...block[1].matchAll(/'([\w-]+)':/g)].map(([, name]) => name)
}

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
})

describe('cn — the custom cp-* font scale', () => {
  const fontSizes = tailwindFontSizeNames()

  it('reads the scale out of tailwind.config.ts', () => {
    expect(fontSizes).toEqual(['cp-xs', 'cp-sm', 'cp-base'])
  })

  it('pins the reported regression: text-cp-sm survives beside text-white', () => {
    // Plain twMerge reads both as colours and drops the size, leaving the
    // Connect button at the browser default.
    expect(cn('text-cp-sm', 'text-white')).toBe('text-cp-sm text-white')
  })

  it('pins the other half: two cp-* sizes conflict, and the last one wins', () => {
    expect(cn('text-cp-xs', 'text-cp-base')).toBe('text-cp-base')
  })

  it.each(fontSizes)('keeps text-%s beside a text colour', (size) => {
    expect(cn(`text-${size}`, 'text-white')).toBe(`text-${size} text-white`)
  })

  it('resolves any pair of cp-* sizes to the later one', () => {
    for (const first of fontSizes) {
      for (const second of fontSizes) {
        if (first === second) continue
        expect(cn(`text-${first}`, `text-${second}`)).toBe(`text-${second}`)
      }
    }
  })

  it('still lets a cp-* size override a stock Tailwind size', () => {
    expect(cn('text-sm', 'text-cp-base')).toBe('text-cp-base')
  })
})
