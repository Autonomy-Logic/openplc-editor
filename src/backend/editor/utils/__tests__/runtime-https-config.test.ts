import { getRuntimeHttpsOptions } from '../runtime-https-config'

describe('getRuntimeHttpsOptions', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns rejectUnauthorized true when env is "true"', () => {
    process.env.RUNTIME_TLS_REJECT_UNAUTHORIZED = 'true'
    expect(getRuntimeHttpsOptions()).toEqual({ rejectUnauthorized: true })
  })

  it('returns rejectUnauthorized false when env is not "true"', () => {
    process.env.RUNTIME_TLS_REJECT_UNAUTHORIZED = 'false'
    expect(getRuntimeHttpsOptions()).toEqual({ rejectUnauthorized: false })
  })

  it('returns rejectUnauthorized false when env is undefined', () => {
    delete process.env.RUNTIME_TLS_REJECT_UNAUTHORIZED
    expect(getRuntimeHttpsOptions()).toEqual({ rejectUnauthorized: false })
  })
})
