import { describe, expect, it } from '@jest/globals'

import { validatePathId } from '../path-safety'

describe('validatePathId', () => {
  it('accepts plain alphanumeric identifiers', () => {
    expect(() => validatePathId('foo', 'id')).not.toThrow()
    expect(() => validatePathId('foo123', 'id')).not.toThrow()
  })

  it('accepts dots, underscores, and hyphens in the middle', () => {
    expect(() => validatePathId('my-pkg.v2_beta', 'id')).not.toThrow()
  })

  it('rejects path-separator characters', () => {
    expect(() => validatePathId('foo/bar', 'id')).toThrow(/disallowed/)
    expect(() => validatePathId('foo\\bar', 'id')).toThrow(/disallowed/)
  })

  it('rejects traversal sequences', () => {
    expect(() => validatePathId('..', 'id')).toThrow(/start with '\.'/)
    expect(() => validatePathId('../etc', 'id')).toThrow(/start with '\.'/)
    expect(() => validatePathId('.hidden', 'id')).toThrow(/start with '\.'/)
  })

  it('rejects empty and non-string input', () => {
    expect(() => validatePathId('', 'id')).toThrow(/required/)
    expect(() => validatePathId(undefined as unknown as string, 'id')).toThrow(/required/)
    expect(() => validatePathId(123 as unknown as string, 'id')).toThrow(/required/)
  })

  it('rejects whitespace, null bytes, and other control characters', () => {
    expect(() => validatePathId('foo bar', 'id')).toThrow(/disallowed/)
    expect(() => validatePathId('foo bar', 'id')).toThrow(/disallowed/)
    expect(() => validatePathId('foo\nbar', 'id')).toThrow(/disallowed/)
  })

  it('uses the supplied field name in error messages', () => {
    expect(() => validatePathId('', 'package.id')).toThrow(/^package\.id is required/)
    expect(() => validatePathId('a/b', 'plugin_name')).toThrow(/^plugin_name contains/)
  })
})
