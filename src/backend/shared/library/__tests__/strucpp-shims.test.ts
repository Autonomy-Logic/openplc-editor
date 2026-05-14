/**
 * Covers the thin strucpp shims that live in `backend/shared/library`.
 *
 * Each shim is a one-line delegation to the strucpp runtime, so the
 * tests inject a stub via `__setStrucppRuntimeForTests` and assert the
 * call shape.  `loadStrucpp`'s cache-hit branch is exercised by calling
 * twice with the stub set — the second call must not re-load.
 */

import { importCodesysLibrary } from '../codesys-import'
import { compileStlib } from '../compile-stlib'
import { loadStlibFromFile } from '../parse-stlib-archive'
import { __setStrucppRuntimeForTests, loadStrucpp, type StrucppRuntime } from '../strucpp-runtime'

function makeStub(overrides: Partial<StrucppRuntime> = {}): StrucppRuntime {
  return {
    compile: jest.fn(),
    formatDiagnostic: jest.fn(),
    buildSourceMap: jest.fn(),
    getVersion: jest.fn(),
    importCodesysLibrary: jest.fn().mockReturnValue({ success: true, sources: [] }),
    loadStlibFromFile: jest.fn().mockReturnValue({ manifest: { name: 'IEC' } }),
    compileStlib: jest.fn().mockReturnValue({ success: true, archive: {} }),
    ...overrides,
  }
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
  it('delegates to strucpp.importCodesysLibrary with the file path', () => {
    const stub = makeStub({
      importCodesysLibrary: jest.fn().mockReturnValue({ success: true, sources: [{ fileName: 'a.st', source: '' }] }),
    })
    __setStrucppRuntimeForTests(stub)

    const res = importCodesysLibrary('/path/to/lib.library')

    expect(stub.importCodesysLibrary).toHaveBeenCalledWith('/path/to/lib.library')
    expect(res.success).toBe(true)
    expect(res.sources).toHaveLength(1)
  })
})

describe('loadStlibFromFile shim', () => {
  it('delegates to strucpp.loadStlibFromFile with the archive path', () => {
    const archive = { manifest: { name: 'IEC' } }
    const stub = makeStub({ loadStlibFromFile: jest.fn().mockReturnValue(archive) })
    __setStrucppRuntimeForTests(stub)

    const res = loadStlibFromFile('/path/to/lib.stlib')

    expect(stub.loadStlibFromFile).toHaveBeenCalledWith('/path/to/lib.stlib')
    expect(res).toBe(archive)
  })
})
