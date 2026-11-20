import { isStlibArchiveDTO, stlibArchiveFromText } from '../stlib-archive-json'

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

  it('returns null for text that is not JSON or not an archive', () => {
    expect(stlibArchiveFromText('{not json')).toBeNull()
    expect(stlibArchiveFromText('[]')).toBeNull()
    expect(stlibArchiveFromText(JSON.stringify({ chunks: [] }))).toBeNull()
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
