import { describe, expect, it } from '@jest/globals'

import { probeRuntimeVersion } from '../probe-runtime-version'

// `jest` is available as a global on both runners: jest provides it
// natively, vitest's setup shim aliases `globalThis.jest = vi`.  We
// deliberately don't import it because `@jest/globals` resolves to
// the `vitest` package on web (vite alias), and vitest doesn't
// export a `jest` namespace — importing the symbol would crash the
// vitest run with "Cannot read properties of undefined".

describe('probeRuntimeVersion', () => {
  it('returns the version when the transport returns a body with a string `version` field', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: { version: '4.1.2' } }),
      log,
    })
    expect(result).toEqual({ version: '4.1.2' })
    expect(log).not.toHaveBeenCalled()
  })

  it('surfaces an older runtime version verbatim so the gate can reject it', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: { version: '4.0.5' } }),
      log,
    })
    expect(result).toEqual({ version: '4.0.5' })
  })

  it('returns version=null and logs a warning when the transport fails', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: false, error: 'ECONNREFUSED' }),
      log,
    })
    expect(result).toEqual({ version: null })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not reach runtime: ECONNREFUSED'), 'warning')
  })

  it('returns version=null + warns when the transport throws (Error instance)', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => {
        throw new Error('orchestrator HTTP down')
      },
      log,
    })
    expect(result).toEqual({ version: null })
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Runtime version probe failed: orchestrator HTTP down'),
      'warning',
    )
  })

  it('returns version=null + warns when the transport throws a non-Error value', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'plain string failure'
      },
      log,
    })
    expect(result).toEqual({ version: null })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('plain string failure'), 'warning')
  })

  it('returns version=null when the body lacks a `version` field', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: { otherField: 'noise' } }),
      log,
    })
    expect(result).toEqual({ version: null })
    expect(log).not.toHaveBeenCalled()
  })

  it('returns version=null when `version` is present but not a string', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: { version: 4 } }),
      log,
    })
    expect(result).toEqual({ version: null })
  })

  it('returns version=null when the body is null', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: null }),
      log,
    })
    expect(result).toEqual({ version: null })
  })

  it('returns version=null when the body is a primitive (not an object)', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: 'a string' }),
      log,
    })
    expect(result).toEqual({ version: null })
  })
})
