/**
 * Tests for the library build pipeline.
 *
 * `prepareXmlForLibraryBuild` no longer generates PLCopen XML — the
 * old xml2st flow was replaced by an in-process JSON → ST transpiler.
 * The function now only validates the manifest and returns the stubbed
 * project data (plus the POU inventory the splitter needs); the actual
 * transpile happens later via `LibraryBuildPort.transpileToSt`.
 * Strucpp is mocked via the runtime's test escape hatch — the build
 * pipeline must remain pure (no real strucpp load) for these tests.
 */

import type { PLCProject } from '../../types/PLC/open-plc'
import type { StrucppRuntime } from '../strucpp-runtime'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { __setStrucppRuntimeForTests } from '../strucpp-runtime'
import {
  __TESTING__,
  composeVerificationProject,
  libraryBuildFromTranspiledSt,
  prepareXmlForLibraryBuild,
} from '../build-pipeline'

const STUB = __TESTING__
const { parseLibraryManifest, stubProgramFor } = __TESTING__

function makeStrucppStub(overrides: Partial<Pick<StrucppRuntime, 'compileStlib'>> = {}): StrucppRuntime {
  return {
    compile: jest.fn(),
    formatDiagnostic: jest.fn(),
    buildSourceMap: jest.fn(),
    getVersion: jest.fn(),
    importCodesysLibraryFromBytes: jest.fn(),
    loadStlibFromString: jest.fn(),
    compileStlib: jest.fn().mockReturnValue({ success: true, archive: { kind: 'fake-archive' } }),
    ...overrides,
  } as unknown as StrucppRuntime
}

function makeLibraryProject(overrides: Partial<PLCProject['data']> = {}): PLCProject {
  return {
    meta: { name: 'demo_lib', type: 'plc-library' },
    data: {
      pous: [
        {
          type: 'function-block',
          data: {
            name: 'TankController',
            language: 'st',
            variables: [],
            body: { language: 'st', value: '' },
            documentation: '',
          },
        },
      ],
      dataTypes: [],
      configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
      libraries: [],
      ...overrides,
    } as PLCProject['data'],
  }
}

const VALID_MANIFEST_JSON = JSON.stringify({
  name: 'demo_lib',
  version: '1.0.0',
  namespace: 'demo_lib',
  description: 'optional extra field',
})

beforeEach(() => {
  jest.clearAllMocks()
  __setStrucppRuntimeForTests(null)
})

afterAll(() => {
  __setStrucppRuntimeForTests(null)
})

// ---------------------------------------------------------------------------
// parseLibraryManifest
// ---------------------------------------------------------------------------

describe('parseLibraryManifest', () => {
  it('parses a well-formed manifest and exposes extra fields', () => {
    const res = parseLibraryManifest(VALID_MANIFEST_JSON)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.manifest.name).toBe('demo_lib')
    expect(res.manifest.version).toBe('1.0.0')
    expect(res.manifest.namespace).toBe('demo_lib')
    expect(res.manifest.extra.description).toBe('optional extra field')
  })

  it('rejects invalid JSON with the parser error inlined', () => {
    const res = parseLibraryManifest('{ not json')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors[0]).toMatch(/library\.json is not valid JSON/)
  })

  it('rejects non-Error throwables from JSON.parse', () => {
    // Force JSON.parse to throw a non-Error value to exercise the
    // String(err) fallback branch.
    const original = JSON.parse
    const spy = jest.spyOn(JSON, 'parse').mockImplementation(() => {
      throw 'unexpected token'
    })
    try {
      const res = parseLibraryManifest('whatever')
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.errors[0]).toContain('unexpected token')
    } finally {
      spy.mockRestore()
      // Sanity: restoration brings the real parser back.
      expect(JSON.parse).toBe(original)
    }
  })

  it('rejects JSON arrays', () => {
    const res = parseLibraryManifest('[]')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors).toContain('library.json must be a JSON object')
  })

  it('rejects JSON null', () => {
    const res = parseLibraryManifest('null')
    expect(res.ok).toBe(false)
  })

  it('rejects JSON scalars', () => {
    const res = parseLibraryManifest('42')
    expect(res.ok).toBe(false)
  })

  it('accumulates errors for all missing required fields at once', () => {
    const res = parseLibraryManifest('{}')
    expect(res.ok).toBe(false)
    if (res.ok) return
    // `manifest.name` flows through the shared `checkPathId` helper,
    // so the error message is the same shape `validatePathId` would
    // throw at install time — single source of truth for path-id
    // rules.
    expect(res.errors).toEqual(
      expect.arrayContaining([
        'manifest.name is required and must be a non-empty string',
        'manifest.version must be a non-empty string',
        'manifest.namespace must be a non-empty string',
      ]),
    )
  })

  it('rejects empty-string fields just like missing ones', () => {
    const res = parseLibraryManifest(JSON.stringify({ name: '', version: '', namespace: '' }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors).toHaveLength(3)
  })

  it('rejects names with characters the library-manager rejects at install time', () => {
    // The user hit this on a freshly-built library: strucpp's
    // `compileStlib` accepted "Semaphore Package" as the manifest
    // name, but the library manager later refused to install the
    // `.stlib` because the name contains a space.  Validate against
    // the same `[a-zA-Z0-9._-]` rule here so the build fails up
    // front instead of producing a `.stlib` that can't be installed.
    const res = parseLibraryManifest(
      JSON.stringify({ name: 'Semaphore Package', version: '0.1.0', namespace: 'semaphore_pkg' }),
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors[0]).toMatch(/manifest\.name contains disallowed characters/)
  })

  it('accepts safe names: letters, digits, dot, hyphen, underscore', () => {
    const res = parseLibraryManifest(JSON.stringify({ name: 'demo-lib_1.0', version: '0.1.0', namespace: 'demo_lib' }))
    expect(res.ok).toBe(true)
  })

  it('rejects a namespace that is not a valid C++ identifier', () => {
    const res = parseLibraryManifest(JSON.stringify({ name: 'x', version: '1.0', namespace: '1bad-namespace' }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors[0]).toMatch(/manifest\.namespace must be a valid C\+\+ identifier/)
  })

  it('accepts namespaces starting with underscore', () => {
    const res = parseLibraryManifest(JSON.stringify({ name: 'x', version: '1.0', namespace: '_underscore_first' }))
    expect(res.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// stubProgramFor
// ---------------------------------------------------------------------------

describe('stubProgramFor', () => {
  it('appends a `main` program POU with one INT local and a non-empty body', () => {
    const project = makeLibraryProject()
    const stubbed = stubProgramFor(project)

    expect(stubbed.data.pous).toHaveLength(2)
    const stub = stubbed.data.pous.find((p) => p.type === 'program')
    expect(stub).toBeDefined()
    if (!stub || stub.type !== 'program') throw new Error('stub missing')
    expect(stub.data.name).toBe(STUB.STUB_PROGRAM_NAME)
    expect(stub.data.name).toBe('main')
    expect(stub.data.language).toBe('st')
    expect(stub.data.variables).toEqual([
      expect.objectContaining({
        name: 'LocalVar',
        class: 'local',
        type: { definition: 'base-type', value: 'INT' },
      }),
    ])
    expect(stub.data.body).toEqual({ language: 'st', value: 'LocalVar := 3;' })
  })

  it('appends a stub task and a stub program instance binding them together', () => {
    const project = makeLibraryProject()
    const stubbed = stubProgramFor(project)
    const { tasks, instances } = stubbed.data.configuration.resource

    expect(tasks).toEqual([
      expect.objectContaining({
        name: STUB.STUB_TASK_NAME,
        triggering: 'Cyclic',
        interval: 'T#100ms',
        priority: 1,
      }),
    ])
    expect(instances).toEqual([
      expect.objectContaining({
        name: STUB.STUB_INSTANCE_NAME,
        program: STUB.STUB_PROGRAM_NAME,
        task: STUB.STUB_TASK_NAME,
      }),
    ])
  })

  it('preserves the original POU list, tasks, instances, and globalVariables', () => {
    const project = makeLibraryProject({
      configuration: {
        resource: {
          tasks: [{ name: 'preExisting', triggering: 'Cyclic', interval: 'T#50ms', priority: 0 }],
          instances: [],
          globalVariables: [
            {
              name: 'preExistingGlobal',
              type: { definition: 'base-type', value: 'INT' },
              location: '',
              documentation: '',
              initialValue: null,
            },
          ],
        },
      },
    })
    const stubbed = stubProgramFor(project)
    expect(stubbed.data.configuration.resource.tasks).toHaveLength(2)
    expect(stubbed.data.configuration.resource.tasks[0]?.name).toBe('preExisting')
    expect(stubbed.data.configuration.resource.globalVariables[0]?.name).toBe('preExistingGlobal')
  })

  it('keeps meta untouched (the meta type is rewritten only by composeVerificationProject)', () => {
    const project = makeLibraryProject()
    const stubbed = stubProgramFor(project)
    expect(stubbed.meta).toEqual(project.meta)
  })
})

// ---------------------------------------------------------------------------
// prepareXmlForLibraryBuild
// ---------------------------------------------------------------------------

describe('prepareXmlForLibraryBuild', () => {
  it('returns a structured error when the manifest is invalid', () => {
    const result = prepareXmlForLibraryBuild(makeLibraryProject(), '{ broken')
    expect('error' in result).toBe(true)
    if (!('error' in result)) return
    expect(result.error).toContain('library.json is invalid')
  })

  it('formats multi-line error reports with one bullet per validation issue', () => {
    const result = prepareXmlForLibraryBuild(makeLibraryProject(), '{}')
    if (!('error' in result)) throw new Error('expected error')
    const bulletCount = (result.error.match(/•/g) ?? []).length
    expect(bulletCount).toBeGreaterThanOrEqual(3)
  })

  it('returns stubbed projectData + knownPous (including stub) + parsed manifest on success', () => {
    const result = prepareXmlForLibraryBuild(makeLibraryProject(), VALID_MANIFEST_JSON)
    // `error` is the union discriminant — its absence means success.
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.manifest.name).toBe('demo_lib')

    // The stubbed project carries the library's POUs plus the
    // synthesised `main` program the transpiler requires.
    expect(result.projectData.pous.map((p) => p.data.name)).toEqual(['TankController', STUB.STUB_PROGRAM_NAME])

    // POUs from the project + the stub program
    const names = result.knownPous.map((p) => p.name)
    expect(names).toEqual(['TankController', STUB.STUB_PROGRAM_NAME])

    const kinds = result.knownPous.map((p) => p.kind)
    expect(kinds).toEqual(['FUNCTION_BLOCK', 'PROGRAM'])
  })

  it('maps each POU type to the correct splitter kind', () => {
    const project = makeLibraryProject({
      pous: [
        {
          type: 'function',
          data: {
            name: 'Add2',
            language: 'st',
            returnType: 'INT',
            variables: [],
            body: { language: 'st', value: '' },
            documentation: '',
          },
        },
        {
          type: 'function-block',
          data: {
            name: 'Tank',
            language: 'st',
            variables: [],
            body: { language: 'st', value: '' },
            documentation: '',
          },
        },
      ],
    })
    const result = prepareXmlForLibraryBuild(project, VALID_MANIFEST_JSON)
    if ('error' in result) throw new Error('expected success')
    const byName = Object.fromEntries(result.knownPous.map((p) => [p.name, p.kind]))
    expect(byName).toEqual({ Add2: 'FUNCTION', Tank: 'FUNCTION_BLOCK', main: 'PROGRAM' })
  })
})

// ---------------------------------------------------------------------------
// libraryBuildFromTranspiledSt
// ---------------------------------------------------------------------------

describe('libraryBuildFromTranspiledSt', () => {
  const manifest = {
    name: 'demo_lib',
    version: '1.0.0',
    namespace: 'demo_lib',
    extra: {} as Record<string, unknown>,
  }

  it('returns a structured error when the splitter rejects the program.st', () => {
    const strucpp = makeStrucppStub()
    __setStrucppRuntimeForTests(strucpp)
    // Empty knownPous makes the splitter return null.
    const res = libraryBuildFromTranspiledSt('PROGRAM main\nEND_PROGRAM\n', [], manifest)
    expect(res.success).toBe(false)
    expect(res.errors[0]?.message).toMatch(/Could not split program\.st/)
    expect(strucpp.compileStlib).not.toHaveBeenCalled()
  })

  it('refuses when the library has no real POUs (only the stub)', () => {
    const strucpp = makeStrucppStub()
    __setStrucppRuntimeForTests(strucpp)
    const programSt = 'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'
    const res = libraryBuildFromTranspiledSt(programSt, [{ name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' }], manifest)
    expect(res.success).toBe(false)
    expect(res.errors[0]?.message).toMatch(/no functions, function blocks, or data types/)
    expect(strucpp.compileStlib).not.toHaveBeenCalled()
  })

  it('refuses when only globals / config slices remain after dropping the stub', () => {
    const strucpp = makeStrucppStub()
    __setStrucppRuntimeForTests(strucpp)
    const programSt =
      'VAR_GLOBAL\n  G : INT;\nEND_VAR\n' +
      '\n' +
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'
    const res = libraryBuildFromTranspiledSt(programSt, [{ name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' }], manifest)
    expect(res.success).toBe(false)
    expect(res.errors[0]?.message).toMatch(/no functions, function blocks, or data types/)
  })

  it('drops the stub program file and forwards the remaining POUs to compileStlib', () => {
    const compileStlib = jest.fn().mockReturnValue({ success: true, archive: { kind: 'fake' } })
    const strucpp = makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] })
    __setStrucppRuntimeForTests(strucpp)

    const programSt =
      'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n' +
      '\n' +
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

    const res = libraryBuildFromTranspiledSt(
      programSt,
      [
        { name: 'Tank', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      manifest,
    )

    expect(res.success).toBe(true)
    expect(res.archive).toEqual({ kind: 'fake' })
    expect(res.errors).toEqual([])

    const [sources, opts] = compileStlib.mock.calls[0]
    const filenames = (sources as Array<{ fileName: string }>).map((s) => s.fileName)
    expect(filenames).toEqual(['Tank.st'])
    expect(filenames).not.toContain(STUB.STUB_SPLIT_FILENAME)
    expect(opts).toEqual({ name: 'demo_lib', version: '1.0.0', namespace: 'demo_lib' })
  })

  it('drops `_config.st` so strucpp does not error on the stub configuration', () => {
    // The stub program (which the splitter recognises and the
    // pipeline drops) is referenced by xml2st's emitted
    // CONFIGURATION block.  Leaving `_config.st` in the strucpp
    // inputs makes strucpp emit "Unknown program type 'MAIN'"
    // diagnostics because the stub source isn't there anymore.
    // Verify the pipeline strips the config slice up front.
    const compileStlib = jest.fn().mockReturnValue({ success: true, archive: {} })
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )

    const programSt =
      'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n' +
      '\n' +
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n' +
      '\n' +
      'CONFIGURATION Config0\n' +
      '  RESOURCE Res0 ON PLC\n' +
      '    TASK MainTask(INTERVAL := T#100ms, PRIORITY := 0);\n' +
      '    PROGRAM MainInstance WITH MainTask : main;\n' +
      '  END_RESOURCE\n' +
      'END_CONFIGURATION\n'

    libraryBuildFromTranspiledSt(
      programSt,
      [
        { name: 'Tank', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      manifest,
    )

    const sources = compileStlib.mock.calls[0][0] as Array<{ fileName: string }>
    const filenames = sources.map((s) => s.fileName)
    expect(filenames).not.toContain('_config.st')
    expect(filenames).not.toContain(STUB.STUB_SPLIT_FILENAME)
    expect(filenames).toContain('Tank.st')
  })

  it('infers category tags from the splitter filename convention', () => {
    const compileStlib = jest.fn().mockReturnValue({ success: true, archive: {} })
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )

    const programSt =
      'TYPE\n  Color : (RED, GREEN);\nEND_TYPE\n' +
      '\n' +
      'VAR_GLOBAL\n  G : INT;\nEND_VAR\n' +
      '\n' +
      'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n' +
      '\n' +
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

    libraryBuildFromTranspiledSt(
      programSt,
      [
        { name: 'Tank', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      manifest,
    )

    const sources = compileStlib.mock.calls[0][0] as Array<{
      fileName: string
      category?: string
    }>
    const byName = Object.fromEntries(sources.map((s) => [s.fileName, s.category]))
    expect(byName).toEqual({
      '_types.st': 'data-type',
      '_globals.st': 'globals',
      'Tank.st': undefined,
    })
  })

  it('decorates the archive with description / displayName / per-POU docs / dependencies', () => {
    const archive = {
      manifest: {
        name: 'demo_lib',
        version: '1.0.0',
        namespace: 'demo_lib',
        functions: [{ name: 'Add2' }],
        functionBlocks: [{ name: 'Tank' }],
        types: [{ name: 'Color' }],
      },
      dependencies: [],
    }
    const compileStlib = jest.fn().mockReturnValue({ success: true, archive })
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )

    const programSt =
      'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n' +
      '\n' +
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

    libraryBuildFromTranspiledSt(
      programSt,
      [
        { name: 'Tank', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      {
        name: 'demo_lib',
        version: '1.0.0',
        namespace: 'demo_lib',
        extra: { description: 'a demo lib', displayName: 'Demo Library' },
      },
      {
        pouDocs: { Tank: 'controls a tank', Add2: 'adds two ints', Color: 'colour enum' },
        dependencyRefs: [{ name: 'oscat', version: '3.3.0' }],
      },
    )

    expect(archive.manifest).toMatchObject({
      description: 'a demo lib',
      displayName: 'Demo Library',
      functions: [{ name: 'Add2', documentation: 'adds two ints' }],
      functionBlocks: [{ name: 'Tank', documentation: 'controls a tank' }],
      types: [{ name: 'Color', documentation: 'colour enum' }],
    })
    expect(archive.dependencies).toEqual([{ name: 'oscat', version: '3.3.0' }])
  })

  it('filters C/C++ POUs from strucpp inputs and attaches them as `cppBlocks` on the archive', () => {
    // The library has one ST FB (`Tank`) and one C/C++ FB (`SmartGate`).
    // The user's `SmartGate` arrived here as an ST stub (preprocessPous
    // converts C++ → ST stub + `originalCppPous` sidecar on the
    // renderer side), so the splitter sees `SmartGate.st` in
    // program.st.  The build pipeline must drop that source from the
    // strucpp inputs (strucpp's library compiler has no
    // `pouIncludes` to resolve the c_blocks.h externs the stub
    // references) and stamp the original C++ onto the archive.
    const archive: { manifest: { name: string }; dependencies: unknown[]; cppBlocks?: unknown[] } = {
      manifest: { name: 'demo_lib' },
      dependencies: [],
    }
    const compileStlib = jest.fn().mockReturnValue({ success: true, archive })
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )

    const programSt =
      'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n' +
      '\n' +
      'FUNCTION_BLOCK SmartGate\n  VAR x : BOOL; END_VAR\n  x := TRUE;\nEND_FUNCTION_BLOCK\n' +
      '\n' +
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

    libraryBuildFromTranspiledSt(
      programSt,
      [
        { name: 'Tank', kind: 'FUNCTION_BLOCK' },
        { name: 'SmartGate', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      manifest,
      {
        cppBlocks: [
          {
            name: 'SmartGate',
            code: 'void setup() {}\nvoid loop() {}',
            variables: [{ name: 'x', class: 'input', type: { definition: 'base-type', value: 'BOOL' } }],
          },
        ],
      },
    )

    // SmartGate.st must be filtered out of strucpp's input list.
    const sources = compileStlib.mock.calls[0][0] as Array<{ fileName: string }>
    const filenames = sources.map((s) => s.fileName)
    expect(filenames).toContain('Tank.st')
    expect(filenames).not.toContain('SmartGate.st')
    expect(filenames).not.toContain(STUB.STUB_SPLIT_FILENAME)

    // SmartGate rides through on `archive.cppBlocks` verbatim.
    expect(archive.cppBlocks).toEqual([
      {
        name: 'SmartGate',
        code: 'void setup() {}\nvoid loop() {}',
        variables: [{ name: 'x', class: 'input', type: { definition: 'base-type', value: 'BOOL' } }],
      },
    ])
  })

  it('accepts a library that ships only C/C++ blocks (no ST/IL POUs)', () => {
    // Edge case: the library has one C++ FB and nothing else.  The
    // ST/IL source list is empty after filtering, but `cppBlocks`
    // is non-empty so the build still produces a valid archive.
    const archive = { manifest: { name: 'cpp_only_lib' }, dependencies: [] }
    const compileStlib = jest.fn().mockReturnValue({ success: true, archive })
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )

    const programSt =
      'FUNCTION_BLOCK CppOnly\n  VAR x : BOOL; END_VAR\n  x := TRUE;\nEND_FUNCTION_BLOCK\n' +
      '\n' +
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

    const res = libraryBuildFromTranspiledSt(
      programSt,
      [
        { name: 'CppOnly', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      { ...manifest, name: 'cpp_only_lib', namespace: 'cpp_only_lib' },
      {
        cppBlocks: [{ name: 'CppOnly', code: 'void setup() {}\nvoid loop() {}', variables: [] }],
      },
    )

    expect(res.success).toBe(true)
  })

  it('matches POU docs case-insensitively (xml2st upper-cases identifiers)', () => {
    const archive = {
      manifest: {
        name: 'demo_lib',
        functions: [],
        functionBlocks: [{ name: 'TANK' }],
        types: [],
      },
      dependencies: [],
    }
    const compileStlib = jest.fn().mockReturnValue({ success: true, archive })
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )

    libraryBuildFromTranspiledSt(
      'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n' +
        'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n',
      [
        { name: 'Tank', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      manifest,
      { pouDocs: { Tank: 'tank doc' } },
    )

    expect(archive.manifest.functionBlocks[0]).toMatchObject({ documentation: 'tank doc' })
  })

  it('forwards dependencyArchives to strucpp compileStlib when supplied', () => {
    const fakeDepArchive = { manifest: { name: 'oscat' } }
    const compileStlib = jest.fn().mockReturnValue({ success: true, archive: { manifest: { functions: [] } } })
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )

    libraryBuildFromTranspiledSt(
      'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n' +
        'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n',
      [
        { name: 'Tank', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      manifest,
      { dependencyArchives: [fakeDepArchive] },
    )

    const opts = compileStlib.mock.calls[0][1] as { dependencies?: unknown[] }
    expect(opts.dependencies).toEqual([fakeDepArchive])
  })

  it('forwards compile errors verbatim and propagates success=false', () => {
    const errors = [{ message: 'something exploded', line: 4, file: 'Tank.st' }]
    __setStrucppRuntimeForTests(
      makeStrucppStub({
        compileStlib: jest
          .fn()
          .mockReturnValue({ success: false, errors }) as unknown as StrucppRuntime['compileStlib'],
      }),
    )

    const programSt =
      'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n' +
      '\n' +
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

    const res = libraryBuildFromTranspiledSt(
      programSt,
      [
        { name: 'Tank', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      manifest,
    )
    expect(res.success).toBe(false)
    expect(res.errors).toEqual(errors)
  })

  it('coerces a missing strucpp errors field to an empty array', () => {
    __setStrucppRuntimeForTests(
      makeStrucppStub({
        compileStlib: jest
          .fn()
          .mockReturnValue({ success: true, archive: {} }) as unknown as StrucppRuntime['compileStlib'],
      }),
    )

    const programSt =
      'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n' +
      '\n' +
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

    const res = libraryBuildFromTranspiledSt(
      programSt,
      [
        { name: 'Tank', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      manifest,
    )
    expect(res.errors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// composeVerificationProject
// ---------------------------------------------------------------------------

describe('composeVerificationProject', () => {
  it('returns a stubbed project tagged plc-project (not plc-library)', () => {
    const project = makeLibraryProject()
    const verification = composeVerificationProject(project)

    expect(verification.meta.type).toBe('plc-project')
    expect(verification.meta.name).toBe(project.meta.name)
    expect(verification.data.pous).toHaveLength(2)
    expect(verification.data.configuration.resource.tasks).toHaveLength(1)
    expect(verification.data.configuration.resource.instances).toHaveLength(1)
  })
})
