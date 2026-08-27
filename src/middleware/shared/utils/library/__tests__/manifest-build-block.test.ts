import { DEFAULT_VERIFY_TARGET, parseVerifyTarget, withVerifyTarget } from '../manifest-build-block'

describe('parseVerifyTarget', () => {
  it('defaults when the block is absent', () => {
    expect(parseVerifyTarget({ name: 'lib' })).toEqual({ target: DEFAULT_VERIFY_TARGET })
  })

  it('reads mode and core', () => {
    expect(parseVerifyTarget({ build: { verify: 'arduino', core: 'esp32:esp32' } })).toEqual({
      target: { mode: 'arduino', core: 'esp32:esp32' },
    })
  })

  it('reports an unknown mode', () => {
    const result = parseVerifyTarget({ build: { verify: 'nope' } })
    expect(result).toEqual({ errors: [expect.stringMatching(/must be one of arduino, runtime, off/) as string] })
  })

  it('reports a non-object block', () => {
    expect(parseVerifyTarget({ build: [] })).toEqual({
      errors: [expect.stringMatching(/must be a JSON object/) as string],
    })
  })
})

describe('withVerifyTarget', () => {
  const manifest = JSON.stringify({ name: 'lib', version: '1.0.0', namespace: 'lib' }, null, 2) + '\n'

  it('adds the block and round-trips through the parser', () => {
    const updated = withVerifyTarget(manifest, { mode: 'arduino', core: 'esp32:esp32' })
    expect(updated).not.toBeNull()
    expect(parseVerifyTarget(JSON.parse(updated as string) as Record<string, unknown>)).toEqual({
      target: { mode: 'arduino', core: 'esp32:esp32' },
    })
  })

  it('leaves the rest of the manifest and its key order alone', () => {
    const updated = withVerifyTarget(manifest, { mode: 'off' }) as string
    expect(Object.keys(JSON.parse(updated) as Record<string, unknown>)).toEqual([
      'name',
      'version',
      'namespace',
      'build',
    ])
    expect((JSON.parse(updated) as { version: string }).version).toBe('1.0.0')
  })

  it('drops the core when the target no longer names one', () => {
    const withCore = withVerifyTarget(manifest, { mode: 'arduino', core: 'esp32:esp32' }) as string
    const withoutCore = withVerifyTarget(withCore, { mode: 'arduino' }) as string
    expect(JSON.parse(withoutCore)).toMatchObject({ build: { verify: 'arduino' } })
    expect((JSON.parse(withoutCore) as { build: Record<string, unknown> }).build).not.toHaveProperty('core')
  })

  it('keeps other keys already in the block', () => {
    const seeded = JSON.stringify({ name: 'lib', build: { verify: 'arduino', future: 1 } }, null, 2)
    const updated = withVerifyTarget(seeded, { mode: 'runtime' }) as string
    expect(JSON.parse(updated)).toMatchObject({ build: { verify: 'runtime', future: 1 } })
  })

  it('refuses a manifest that is not a JSON object', () => {
    // The dialog can be opened while the Manifest tab holds a half-typed
    // edit; overwriting it would discard the user's work.
    expect(withVerifyTarget('{ not json', { mode: 'off' })).toBeNull()
    expect(withVerifyTarget('[]', { mode: 'off' })).toBeNull()
  })
})
