/**
 * Covers the browser-pure strucpp shims that live in
 * `backend/shared/library`.  Each shim is a one-line delegation to
 * the strucpp runtime, so the tests inject a stub via
 * `__setStrucppRuntimeForTests` and assert the call shape.
 * `loadStrucpp`'s cache-hit branch is exercised by calling twice
 * with the stub set — the second call must not re-load.
 */

import { importCodesysLibrary } from '../codesys-import'
import { compileStlib } from '../compile-stlib'
import { parseStlibArchive } from '../parse-stlib-archive'
import { __setStrucppRuntimeForTests, loadStrucpp, type StrucppRuntime } from '../strucpp-runtime'

function makeStub(overrides: Partial<StrucppRuntime> = {}): StrucppRuntime {
  return {
    compile: jest.fn(),
    formatDiagnostic: jest.fn(),
    buildSourceMap: jest.fn(),
    getVersion: jest.fn(),
    importCodesysLibraryFromBytes: jest.fn().mockResolvedValue({ success: true, sources: [] }),
    loadStlibFromString: jest.fn().mockReturnValue({ manifest: { name: 'IEC' } }),
    compileStlib: jest.fn().mockReturnValue({ success: true, archive: {} }),
    ...overrides,
  } as StrucppRuntime
}

afterEach(() => {
  // Clear the runtime cache between tests so a subsequent test gets
  // its own clean stub.
  __setStrucppRuntimeForTests(null)
})

describe('loadStrucpp', () => {
  it('returns the cached instance on subsequent calls', () => {
    const stub = makeStub()
    __setStrucppRuntimeForTests(stub)

    const first = loadStrucpp()
    const second = loadStrucpp()

    expect(first).toBe(stub)
    expect(second).toBe(stub)
  })
})

describe('compileStlib shim', () => {
  it('delegates to strucpp.compileStlib with sources + options', () => {
    const stub = makeStub()
    __setStrucppRuntimeForTests(stub)

    const sources = [{ fileName: 'f.st', source: 'FUNCTION f : INT ;', category: 'function' }]
    const options = { name: 'lib', version: '1.0.0', namespace: 'lib' }

    const res = compileStlib(sources, options)

    expect(stub.compileStlib).toHaveBeenCalledWith(sources, options)
    expect(res).toEqual({ success: true, archive: {} })
  })
})

describe('importCodesysLibrary shim', () => {
  it('delegates to strucpp.importCodesysLibraryFromBytes with the raw bytes', async () => {
    const stub = makeStub({
      importCodesysLibraryFromBytes: jest
        .fn()
        .mockResolvedValue({ success: true, sources: [{ fileName: 'a.st', source: '' }] }),
    })
    __setStrucppRuntimeForTests(stub)

    const bytes = new Uint8Array([0x43, 0x6f, 0x44, 0x65])
    const res = await importCodesysLibrary(bytes)

    expect(stub.importCodesysLibraryFromBytes).toHaveBeenCalledWith(bytes)
    expect(res.success).toBe(true)
    expect(res.sources).toHaveLength(1)
  })
})

describe('parseStlibArchive shim', () => {
  it('delegates to strucpp.loadStlibFromString with the archive text', () => {
    const archive = { manifest: { name: 'IEC' } }
    const stub = makeStub({ loadStlibFromString: jest.fn().mockReturnValue(archive) })
    __setStrucppRuntimeForTests(stub)

    const text = '{"manifest":{"name":"IEC"}}'
    const res = parseStlibArchive(text)

    expect(stub.loadStlibFromString).toHaveBeenCalledWith(text)
    expect(res).toBe(archive)
  })
})
