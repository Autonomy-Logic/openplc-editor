import { getErrorMessage } from '../get-error-message'

describe('getErrorMessage', () => {
  it('extracts message from Error instance', () => {
    expect(getErrorMessage(new Error('something broke'))).toBe('something broke')
  })

  it('returns string errors as-is', () => {
    expect(getErrorMessage('plain string error')).toBe('plain string error')
  })

  it('converts number to string via String()', () => {
    expect(getErrorMessage(42)).toBe('42')
  })

  it('converts null to string', () => {
    expect(getErrorMessage(null)).toBe('null')
  })

  it('converts undefined to string', () => {
    expect(getErrorMessage(undefined)).toBe('undefined')
  })

  it('converts object to string', () => {
    expect(getErrorMessage({ code: 500 })).toBe('[object Object]')
  })

  it('converts boolean to string', () => {
    expect(getErrorMessage(false)).toBe('false')
  })

  it('handles Error subclass', () => {
    expect(getErrorMessage(new TypeError('type error'))).toBe('type error')
  })
})
