import { escapeRegExp, extractSearchQuery } from '../slices/search/utils'

describe('search/utils', () => {
  // -------------------------------------------------------------------------
  // escapeRegExp
  // -------------------------------------------------------------------------
  describe('escapeRegExp', () => {
    it('escapes all special regex characters', () => {
      const input = '.*+?^${}()|[]\\'
      const result = escapeRegExp(input)
      expect(result).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\')
    })

    it('returns unmodified string when no special characters', () => {
      expect(escapeRegExp('hello world')).toBe('hello world')
    })

    it('handles empty string', () => {
      expect(escapeRegExp('')).toBe('')
    })

    it('escapes mixed content', () => {
      expect(escapeRegExp('price is $10.00')).toBe('price is \\$10\\.00')
    })
  })

  // -------------------------------------------------------------------------
  // extractSearchQuery
  // -------------------------------------------------------------------------
  describe('extractSearchQuery', () => {
    it('highlights matching text in body', () => {
      const result = extractSearchQuery('Hello World', 'World')
      expect(result).toContain('World')
      expect(result).toContain('<span')
      expect(result).toContain('bg-brand-light')
    })

    it('is case-insensitive', () => {
      const result = extractSearchQuery('Hello world', 'WORLD')
      expect(result).toContain('<span')
      expect(result).toContain('world')
    })

    it('highlights multiple matches', () => {
      const result = extractSearchQuery('abc abc abc', 'abc')
      // Should have 3 span tags
      const matches = result.match(/<span/g)
      expect(matches).toHaveLength(3)
    })

    it('returns original body when no match found', () => {
      const result = extractSearchQuery('Hello World', 'xyz')
      expect(result).toBe('Hello World')
    })

    it('handles special regex characters in search query', () => {
      const result = extractSearchQuery('price is $10.00', '$10.00')
      expect(result).toContain('<span')
      expect(result).toContain('$10.00')
    })

    it('handles empty search query', () => {
      // Empty regex matches everything, so it should highlight around every character boundary
      const result = extractSearchQuery('Hello', '')
      // DOMPurify sanitizes the output, result should contain highlight spans
      expect(result).toContain('<span')
    })

    it('sanitizes HTML output via DOMPurify', () => {
      // If the body contains script tags, DOMPurify should strip them
      const result = extractSearchQuery('<script>alert("xss")</script> World', 'World')
      expect(result).not.toContain('<script>')
      expect(result).toContain('World')
    })
  })
})
