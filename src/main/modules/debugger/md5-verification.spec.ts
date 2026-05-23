import { createMd5UnavailableResult, isRecoverableMd5ReadError } from './md5-verification'

describe('md5-verification', () => {
  it('treats first-upload target MD5 failures as recoverable', () => {
    expect(isRecoverableMd5ReadError(new Error('Failed to get MD5 hash after retries'))).toBe(true)
    expect(isRecoverableMd5ReadError(new Error('Target returned error code: 0x02'))).toBe(true)
    expect(isRecoverableMd5ReadError(new Error('Request timeout'))).toBe(true)
  })

  it('looks through error causes for recoverable MD5 failures', () => {
    const error = Object.assign(new Error('Failed to get MD5 hash after retries'), {
      cause: new Error('Function code mismatch'),
    })

    expect(isRecoverableMd5ReadError(error)).toBe(true)
  })

  it('creates a mismatch result when the target MD5 is unavailable', () => {
    expect(createMd5UnavailableResult()).toEqual({
      success: true,
      match: false,
      targetMd5Unavailable: true,
      error:
        'Target did not provide a program MD5. This usually means the device has not been flashed with an OpenPLC program yet.',
    })
  })
})
