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
    expect(result).toEqual({ version: '4.1.2', minEditorVersion: null })
    expect(log).not.toHaveBeenCalled()
  })

  it('surfaces an older runtime version verbatim so the gate can reject it', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: { version: '4.0.5' } }),
      log,
    })
    expect(result).toEqual({ version: '4.0.5', minEditorVersion: null })
  })

  it('returns version=null and logs a warning when the transport fails', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: false, error: 'ECONNREFUSED' }),
      log,
    })
    expect(result).toEqual({ version: null, minEditorVersion: null })
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
    expect(result).toEqual({ version: null, minEditorVersion: null })
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
    expect(result).toEqual({ version: null, minEditorVersion: null })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('plain string failure'), 'warning')
  })

  it('returns version=null when the body lacks a `version` field', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: { otherField: 'noise' } }),
      log,
    })
    expect(result).toEqual({ version: null, minEditorVersion: null })
    expect(log).not.toHaveBeenCalled()
  })

  it('returns version=null when `version` is present but not a string', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: { version: 4 } }),
      log,
    })
    expect(result).toEqual({ version: null, minEditorVersion: null })
  })

  it('returns version=null when the body is null', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: null }),
      log,
    })
    expect(result).toEqual({ version: null, minEditorVersion: null })
  })

  it('returns version=null when the body is a primitive (not an object)', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: 'a string' }),
      log,
    })
    expect(result).toEqual({ version: null, minEditorVersion: null })
  })
})

// ---------------------------------------------------------------------------
// /api/capabilities (DOPE-448)
// ---------------------------------------------------------------------------

describe('probeRuntimeVersion — capabilities endpoint', () => {
  /** A `fetchVersion` that fails the test if the fallback is reached. */
  const versionMustNotBeCalled = () => {
    const spy = jest.fn(async () => ({ success: true as const, body: { version: 'FALLBACK' } }))
    return spy
  }

  it('prefers the capabilities endpoint and reads both fields from it', async () => {
    const log = jest.fn()
    const fetchVersion = versionMustNotBeCalled()
    const result = await probeRuntimeVersion({
      fetchCapabilities: async () => ({
        success: true,
        body: { runtimeVersion: 'v4.2.0', minEditorVersion: '4.2.1' },
      }),
      fetchVersion,
      log,
    })
    expect(result).toEqual({ version: 'v4.2.0', minEditorVersion: '4.2.1' })
    // One round-trip, not two: the capabilities answer is complete.
    expect(fetchVersion).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  // The shorthands a runtime is likely to publish by hand all parse, and are
  // enforced as their zero-filled equivalent — no warning, because nothing is
  // being dropped.
  it.each([['4.2'], ['4'], ['v5'], ['4.2.1-rc.1']])(
    'passes a %p floor through without complaint',
    async (minEditorVersion) => {
      const log = jest.fn()
      const result = await probeRuntimeVersion({
        fetchCapabilities: async () => ({ success: true, body: { runtimeVersion: 'v4.2.0', minEditorVersion } }),
        fetchVersion: versionMustNotBeCalled(),
        log,
      })
      expect(result).toEqual({ version: 'v4.2.0', minEditorVersion })
      expect(log).not.toHaveBeenCalled()
    },
  )

  // A floor that is present but unreadable declares nothing, which is the safe
  // answer for the upload and the wrong one for whoever wrote it: the runtime
  // believes it is enforcing a constraint that is not being applied. The
  // upload still proceeds — refusing to talk to a device over a typo in its
  // metadata would be worse — but it can no longer happen in silence.
  it('warns when the runtime declares a floor nobody can read, and still returns it', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchCapabilities: async () => ({
        success: true,
        body: { runtimeVersion: 'v4.2.0', minEditorVersion: 'garbage' },
      }),
      fetchVersion: versionMustNotBeCalled(),
      log,
    })
    expect(result).toEqual({ version: 'v4.2.0', minEditorVersion: 'garbage' })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('unreadable minEditorVersion ("garbage")'), 'warning')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not being enforced'), 'warning')
  })

  it('reports minEditorVersion=null when the endpoint answers without that field', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchCapabilities: async () => ({ success: true, body: { runtimeVersion: 'v4.2.0' } }),
      fetchVersion: versionMustNotBeCalled(),
      log,
    })
    expect(result).toEqual({ version: 'v4.2.0', minEditorVersion: null })
  })

  it('ignores a non-string minEditorVersion rather than passing it to a comparison', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchCapabilities: async () => ({
        success: true,
        body: { runtimeVersion: 'v4.2.0', minEditorVersion: 421 },
      }),
      fetchVersion: versionMustNotBeCalled(),
      log,
    })
    expect(result).toEqual({ version: 'v4.2.0', minEditorVersion: null })
  })

  // The single most important case: this is every runtime currently
  // deployed. The fallback must be silent and unremarkable — if it warned,
  // every existing device would nag on every upload.
  //
  // Note the 401: a pre-DOPE-448 runtime does NOT answer 404 for an unknown
  // path. Its `restapi.py` ends in a catch-all `/<command>` route guarded by
  // `@jwt_required()`, so `/api/capabilities` lands there and comes back as
  // "Missing Authorization Header". Observed against a real container — the
  // 404 row is kept because a future runtime could answer either way.
  const LEGACY_RESPONSES: Array<[string, string]> = [
    ['401 Missing Authorization Header', 'the /<command> catch-all swallows the unknown path'],
    ['404 Not Found', 'a runtime that routes unknown paths properly'],
  ]

  it.each(LEGACY_RESPONSES)('falls back to /api/version on %p (%s), without warning', async (error) => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchCapabilities: async () => ({ success: false, error }),
      fetchVersion: async () => ({ success: true, body: { version: 'v4.1.7' } }),
      log,
    })
    expect(result).toEqual({ version: 'v4.1.7', minEditorVersion: null })
    expect(log).not.toHaveBeenCalled()
  })

  // Belt and braces: if a transport surfaces the 401 as a *successful* fetch
  // carrying the error body (rather than as a failure), the probe must still
  // fall back — there is no `runtimeVersion` to read out of it.
  it('falls back when the 401 body arrives as a successful fetch', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchCapabilities: async () => ({ success: true, body: { msg: 'Missing Authorization Header' } }),
      fetchVersion: async () => ({ success: true, body: { version: 'v4.1.7' } }),
      log,
    })
    expect(result).toEqual({ version: 'v4.1.7', minEditorVersion: null })
    expect(log).not.toHaveBeenCalled()
  })

  it('falls back when the capabilities transport throws', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchCapabilities: async () => {
        throw new Error('TLS handshake failed')
      },
      fetchVersion: async () => ({ success: true, body: { version: 'v4.1.7' } }),
      log,
    })
    expect(result).toEqual({ version: 'v4.1.7', minEditorVersion: null })
    expect(log).not.toHaveBeenCalled()
  })

  // A partial answer is rejected wholesale: if we cannot read the version out
  // of this response we do not trust the minEditorVersion beside it either.
  const UNUSABLE_BODIES: Array<[unknown, string]> = [
    [{ minEditorVersion: '4.2.1' }, 'runtimeVersion is missing'],
    [{ runtimeVersion: 42, minEditorVersion: '4.2.1' }, 'runtimeVersion is not a string'],
    [null, 'the body is null'],
    ['a string', 'the body is a primitive'],
  ]

  it.each(UNUSABLE_BODIES)('falls back when %j (%s)', async (body) => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchCapabilities: async () => ({ success: true, body }),
      fetchVersion: async () => ({ success: true, body: { version: 'v4.1.7' } }),
      log,
    })
    expect(result).toEqual({ version: 'v4.1.7', minEditorVersion: null })
  })

  it('behaves exactly as before when no capabilities transport is wired', async () => {
    // Platforms that have not adopted the endpoint yet (and every caller
    // written before it existed) keep their previous behaviour.
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchVersion: async () => ({ success: true, body: { version: '4.1.2' } }),
      log,
    })
    expect(result).toEqual({ version: '4.1.2', minEditorVersion: null })
  })

  it('still warns about an unreachable device when the fallback also fails', async () => {
    const log = jest.fn()
    const result = await probeRuntimeVersion({
      fetchCapabilities: async () => ({ success: false, error: '404 Not Found' }),
      fetchVersion: async () => ({ success: false, error: 'ECONNREFUSED' }),
      log,
    })
    expect(result).toEqual({ version: null, minEditorVersion: null })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not reach runtime: ECONNREFUSED'), 'warning')
  })
})
