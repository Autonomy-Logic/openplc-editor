import { isStlibArchiveDTO, isStrucppArchive, readStlibArchive, stlibArchiveFromText } from '../stlib-archive-json'

const manifest = {
  name: 'sample-lib',
  version: '1.0.0',
  namespace: 'sample',
  isBuiltin: false,
  functions: [],
  functionBlocks: [],
  types: [],
}

describe('stlibArchiveFromText', () => {
  it('keeps every top-level field of the archive, known or not', () => {
    const text = JSON.stringify({
      formatVersion: 1,
      manifest: { ...manifest, displayName: 'Sample', description: 'A sample' },
      dependencies: [],
      chunks: [{ name: 'X', kind: 'function', deps: [], headers: [{ name: 'hmi_core.h', version: '1' }] }],
      futureField: { anything: [1, 2, 3] },
    })
    const archive = stlibArchiveFromText(text)
    expect(archive).toEqual(JSON.parse(text))
    expect(archive && 'futureField' in archive ? archive.futureField : undefined).toEqual({ anything: [1, 2, 3] })
    expect(archive?.manifest.displayName).toBe('Sample')
    expect(archive && 'chunks' in archive ? archive.chunks : undefined).toEqual([
      { name: 'X', kind: 'function', deps: [], headers: [{ name: 'hmi_core.h', version: '1' }] },
    ])
  })

  it('returns null for text that is not JSON or not an archive, logging the label and the reason', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(stlibArchiveFromText('{not json', 'broken.stlib')).toBeNull()
    expect(stlibArchiveFromText('[]')).toBeNull()
    expect(stlibArchiveFromText(JSON.stringify({ chunks: [] }), 'no-manifest.stlib')).toBeNull()
    expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
      expect.stringMatching(/^\[library\] broken\.stlib is not loaded: it is not JSON/),
      '[library] a library archive is not loaded: it is not a JSON object',
      "[library] no-manifest.stlib is not loaded: its 'manifest' is not an object",
    ])
    warn.mockRestore()
  })

  it('loads an archive whose manifest leaves out what STruC++ defaults', () => {
    const minimal = { formatVersion: 1, manifest: { name: 'lean', version: '1.0.0', namespace: 'lean' }, chunks: [] }
    expect(stlibArchiveFromText(JSON.stringify(minimal))?.manifest).toEqual({
      name: 'lean',
      version: '1.0.0',
      namespace: 'lean',
      isBuiltin: false,
      functions: [],
      functionBlocks: [],
      types: [],
    })
  })
})

describe('readStlibArchive', () => {
  it('fills in the defaults STruC++ applies and keeps every other field', () => {
    const read = readStlibArchive({ manifest: { ...manifest, isBuiltin: 1, functions: {}, types: 'x' }, extra: 2 })
    expect(read).toEqual({
      ok: true,
      archive: { manifest: { ...manifest, isBuiltin: true, functions: [], types: [] }, extra: 2 },
    })
  })

  it.each([
    ['an empty name', { ...manifest, name: '' }, "its manifest 'name' is not a non-empty string"],
    ['no version', { ...manifest, version: undefined }, "its manifest 'version' is not a non-empty string"],
    ['an empty namespace', { ...manifest, namespace: '' }, "its manifest 'namespace' is not a non-empty string"],
    ['a manifest list', [], "its 'manifest' is not an object"],
  ])('refuses %s, as STruC++ does, with the reason', (_what, bad, reason) => {
    expect(readStlibArchive({ manifest: bad })).toEqual({ ok: false, reason })
  })
})

describe('isStrucppArchive', () => {
  it('accepts an archive with a named manifest only', () => {
    expect(isStrucppArchive({ manifest })).toBe(true)
    expect(isStrucppArchive({ manifest: {} })).toBe(false)
    expect(isStrucppArchive('archive')).toBe(false)
  })
})

describe('isStlibArchiveDTO', () => {
  it('accepts a manifest with its identity and symbol lists', () => {
    expect(isStlibArchiveDTO({ manifest })).toBe(true)
  })

  it.each([
    ['an empty name', { ...manifest, name: '' }],
    ['no version', { ...manifest, version: undefined }],
    ['no namespace', { ...manifest, namespace: 1 }],
    ['an empty namespace', { ...manifest, namespace: '' }],
    ['no isBuiltin flag', { ...manifest, isBuiltin: 'no' }],
    ['functions that are not a list', { ...manifest, functions: {} }],
    ['function blocks that are not a list', { ...manifest, functionBlocks: null }],
    ['types that are not a list', { ...manifest, types: 'x' }],
  ])('refuses a manifest with %s', (_what, bad) => {
    expect(isStlibArchiveDTO({ manifest: bad })).toBe(false)
  })

  it('refuses a value without a manifest object', () => {
    expect(isStlibArchiveDTO(null)).toBe(false)
    expect(isStlibArchiveDTO({ manifest: [] })).toBe(false)
  })
})
