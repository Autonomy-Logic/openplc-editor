import { createMd5UnavailableResult, isRecoverableMd5ReadError } from './md5-verification'

describe('md5-verification helpers', () => {
  it('marks retry exhaustion as a recoverable missing-md5 case', () => {
    const error = Object.assign(new Error('Failed to get MD5 hash after retries'), {
      cause: new Error('Request timeout'),
    })

    expect(isRecoverableMd5ReadError(error)).toBe(true)
  })

  it('does not hide unrelated connection errors', () => {
    expect(isRecoverableMd5ReadError(new Error('Port, baud rate, and slave ID are required for RTU connection'))).toBe(false)
  })

  it('treats target error status responses as recoverable missing-md5 cases', () => {
    expect(isRecoverableMd5ReadError(new Error('Target returned error code: 0x81'))).toBe(true)
  })

  it('returns a successful mismatch result when the target md5 is unavailable', () => {
    expect(createMd5UnavailableResult()).toEqual({
      success: true,
      match: false,
      targetMd5Unavailable: true,
      error: 'Target did not provide a program MD5. This usually means the device has not been flashed with an OpenPLC program yet.',
    })
  })
})
