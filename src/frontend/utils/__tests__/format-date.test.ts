import { formatDate } from '../format-date'

describe('formatDate', () => {
  it('formats a date as ISO-like string without timezone', () => {
    const date = new Date(2026, 2, 11, 14, 30, 5) // March 11, 2026 14:30:05
    expect(formatDate(date)).toBe('2026-03-11T14:30:05')
  })

  it('pads single-digit months and days', () => {
    const date = new Date(2026, 0, 5, 9, 3, 7) // Jan 5, 2026 09:03:07
    expect(formatDate(date)).toBe('2026-01-05T09:03:07')
  })

  it('handles midnight', () => {
    const date = new Date(2026, 11, 31, 0, 0, 0) // Dec 31, 2026 00:00:00
    expect(formatDate(date)).toBe('2026-12-31T00:00:00')
  })

  it('handles end of day', () => {
    const date = new Date(2026, 5, 15, 23, 59, 59) // Jun 15, 2026 23:59:59
    expect(formatDate(date)).toBe('2026-06-15T23:59:59')
  })
})
