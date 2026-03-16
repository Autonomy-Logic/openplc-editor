import type { TimestampFormat } from '../format-timestamp'
import formatTimestamp from '../format-timestamp'

describe('formatTimestamp', () => {
  it('returns "DD-MM-YY HH:MM:SS" when format is "full"', () => {
    const date = new Date(2026, 2, 11, 14, 30, 5) // March 11, 2026 14:30:05
    expect(formatTimestamp(date, 'full')).toBe('11-03-26 14:30:05')
  })

  it('returns "HH:MM:SS" when format is "time"', () => {
    const date = new Date(2026, 2, 11, 9, 5, 7) // March 11, 2026 09:05:07
    expect(formatTimestamp(date, 'time')).toBe('09:05:07')
  })

  it('returns empty string when format is "none"', () => {
    const date = new Date(2026, 2, 11, 14, 30, 5)
    expect(formatTimestamp(date, 'none')).toBe('')
  })

  it('defaults to "full" format when format is omitted', () => {
    const date = new Date(2026, 0, 5, 23, 59, 59) // Jan 5, 2026 23:59:59
    expect(formatTimestamp(date)).toBe('05-01-26 23:59:59')
  })

  it('handles ISO string input', () => {
    // Use a fixed UTC string and adjust expected output for local timezone
    const date = new Date('2026-06-15T10:20:30')
    const expected = formatTimestamp(date, 'full')
    expect(formatTimestamp('2026-06-15T10:20:30', 'full')).toBe(expected)
  })

  it('handles Date objects', () => {
    const date = new Date(2026, 11, 31, 0, 0, 0) // Dec 31, 2026 00:00:00
    expect(formatTimestamp(date, 'full')).toBe('31-12-26 00:00:00')
  })

  it('returns "Invalid Date" for invalid date strings', () => {
    expect(formatTimestamp('not-a-date', 'full')).toBe('Invalid Date')
  })

  it('returns "Invalid Date" for invalid Date objects', () => {
    expect(formatTimestamp(new Date('invalid'), 'time')).toBe('Invalid Date')
  })

  it('returns empty string for "none" format even with invalid input', () => {
    expect(formatTimestamp('garbage', 'none')).toBe('')
  })

  it('exports TimestampFormat type', () => {
    // TypeScript compile-time check: this assignment must be valid
    const format: TimestampFormat = 'full'
    expect(['full', 'time', 'none']).toContain(format)
  })

  it('pads single-digit values', () => {
    const date = new Date(2026, 0, 3, 1, 2, 3) // Jan 3, 2026 01:02:03
    expect(formatTimestamp(date, 'full')).toBe('03-01-26 01:02:03')
    expect(formatTimestamp(date, 'time')).toBe('01:02:03')
  })
})
