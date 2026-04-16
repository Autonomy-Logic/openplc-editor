import { parsePlcStatus } from '../plc-status'

describe('parsePlcStatus', () => {
  it('strips STATUS: prefix and returns valid status', () => {
    expect(parsePlcStatus('STATUS:RUNNING')).toBe('RUNNING')
  })

  it('strips STATUS: prefix with trailing newline', () => {
    expect(parsePlcStatus('STATUS:RUNNING\n')).toBe('RUNNING')
  })

  it('handles carriage return and newline', () => {
    expect(parsePlcStatus('STATUS:STOPPED\r\n')).toBe('STOPPED')
  })

  it('handles STATUS: prefix with extra whitespace', () => {
    expect(parsePlcStatus('STATUS:  INIT  ')).toBe('INIT')
  })

  it('returns valid status without STATUS: prefix', () => {
    expect(parsePlcStatus('STOPPED')).toBe('STOPPED')
  })

  it('handles all valid statuses', () => {
    expect(parsePlcStatus('INIT')).toBe('INIT')
    expect(parsePlcStatus('RUNNING')).toBe('RUNNING')
    expect(parsePlcStatus('STOPPED')).toBe('STOPPED')
    expect(parsePlcStatus('ERROR')).toBe('ERROR')
    expect(parsePlcStatus('EMPTY')).toBe('EMPTY')
    expect(parsePlcStatus('UNKNOWN')).toBe('UNKNOWN')
  })

  it('returns null for invalid status', () => {
    expect(parsePlcStatus('INVALID')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parsePlcStatus('')).toBeNull()
  })

  it('returns null for STATUS: prefix with invalid value', () => {
    expect(parsePlcStatus('STATUS:BOGUS')).toBeNull()
  })

  it('strips multiple newlines', () => {
    expect(parsePlcStatus('STATUS:ERROR\n\n\n')).toBe('ERROR')
  })
})
