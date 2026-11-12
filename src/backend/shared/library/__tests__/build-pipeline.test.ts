/**
 * Tests for the library build pipeline.
 *
 * `prepareXmlForLibraryBuild` no longer generates PLCopen XML — the
 * the legacy XML→ST flow was replaced by an in-process JSON → ST transpiler.
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

import { splitProgramSt } from '../../utils/PLC/split-program-st'
import { __setStrucppRuntimeForTests } from '../strucpp-runtime'
import {
  __TESTING__,
  type LibraryBuildAux,
  libraryBuildFromTranspiledSt,
  type PrepareXmlOutcome,
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

function declaredGlobalsOf(result: PrepareXmlOutcome): unknown {
  if ('error' in result) throw new Error(result.error)
  return 'declaredGlobals' in result ? result.declaredGlobals : undefined
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

  it('keeps meta untouched', () => {
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

  it('declares the resource globals, then every GVL that has at least one variable', () => {
    const global = (name: string) => ({
      name,
      type: { definition: 'base-type' as const, value: 'BOOL' as const },
      location: '',
      documentation: '',
      initialValue: null,
    })
    const project = makeLibraryProject({
      configuration: {
        resource: { tasks: [], instances: [], globalVariables: [global('MotorCmd'), global('KMax')] },
      },
      globalVariableLists: [
        { name: 'Motors', variables: [{ ...global('Cmd'), class: 'global' }] },
        { name: 'EmptyList', variables: [] },
        { name: 'Pumps', variables: [{ ...global('Run'), class: 'global' }] },
      ],
    })

    expect(declaredGlobalsOf(prepareXmlForLibraryBuild(project, VALID_MANIFEST_JSON))).toEqual([
      'MotorCmd',
      'KMax',
      'Motors',
      'Pumps',
    ])
  })

  it('declares no globals when the project has none', () => {
    expect(declaredGlobalsOf(prepareXmlForLibraryBuild(makeLibraryProject(), VALID_MANIFEST_JSON))).toEqual([])
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
    // pipeline drops) is referenced by the transpiler's emitted
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
      'FUNCTION Add2 : INT\n  VAR_INPUT a : INT; END_VAR\n  Add2 := a + 2;\nEND_FUNCTION\n' +
      '\n' +
      'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n' +
      '\n' +
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

    libraryBuildFromTranspiledSt(
      programSt,
      [
        { name: 'Add2', kind: 'FUNCTION' },
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

  // Native (C/C++, Python) blocks: the editor hands strucpp the AUTHORED file
  // and keeps the generated bridge ST out of the input. Shipping that stub
  // would freeze this editor's `c_blocks.h` / `iec_python.h` ABI into the
  // archive, so what reaches `compileStlib` is the contract worth asserting.
  const nativeProgramSt =
    'FUNCTION_BLOCK PlainSt\n  VAR y : INT; END_VAR\n  y := 1;\nEND_FUNCTION_BLOCK\n' +
    '\n' +
    'FUNCTION_BLOCK CppBlk\n  VAR x : BOOL; END_VAR\n  x := TRUE;\nEND_FUNCTION_BLOCK\n' +
    '\n' +
    'FUNCTION_BLOCK PyBlk\n  VAR z : INT; END_VAR\n  z := 2;\nEND_FUNCTION_BLOCK\n' +
    '\n' +
    'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

  const nativeKnownPous = [
    { name: 'PlainSt', kind: 'FUNCTION_BLOCK' as const },
    { name: 'CppBlk', kind: 'FUNCTION_BLOCK' as const },
    { name: 'PyBlk', kind: 'FUNCTION_BLOCK' as const },
    { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' as const },
  ]

  const CPP_FILE =
    '(* doc *)\nFUNCTION_BLOCK CppBlk\nVAR_INPUT a : BOOL; END_VAR\nvoid setup() {}\nEND_FUNCTION_BLOCK\n'
  const PY_FILE = 'FUNCTION_BLOCK PyBlk\nVAR_INPUT b : INT; END_VAR\ndef block_loop():\n    pass\nEND_FUNCTION_BLOCK\n'

  const nativeAux = {
    nativeSources: [
      { fileName: 'CppBlk.cpp', source: CPP_FILE },
      { fileName: 'PyBlk.py', source: PY_FILE },
    ],
  }

  const runNativeBuild = (compileStlib: jest.Mock, libName = 'native_lib') => {
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )
    return libraryBuildFromTranspiledSt(
      nativeProgramSt,
      nativeKnownPous,
      { ...manifest, name: libName, namespace: libName },
      nativeAux,
    )
  }

  it('hands strucpp the authored native files, not their generated bridge ST', () => {
    const compileStlib = jest.fn().mockReturnValue({
      success: true,
      archive: { manifest: { name: 'native_lib' }, dependencies: [] },
    })
    const res = runNativeBuild(compileStlib)
    expect(res.success).toBe(true)

    const passed = compileStlib.mock.calls[0][0] as Array<{ fileName: string; source: string }>
    const names = passed.map((p) => p.fileName)

    // The ST POU is compiled as usual.
    expect(names).toContain('PlainSt.st')
    // The bridge stubs are withheld…
    expect(names).not.toContain('CppBlk.st')
    expect(names).not.toContain('PyBlk.st')
    // …and the authored files go instead, byte for byte.
    expect(passed.find((p) => p.fileName === 'CppBlk.cpp')?.source).toBe(CPP_FILE)
    expect(passed.find((p) => p.fileName === 'PyBlk.py')?.source).toBe(PY_FILE)
  })

  it('builds a library whose POUs are ALL native, leaving strucpp only those files', () => {
    const compileStlib = jest.fn().mockReturnValue({
      success: true,
      archive: { manifest: { name: 'native_only' }, dependencies: [] },
    })
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )

    const res = libraryBuildFromTranspiledSt(
      'FUNCTION_BLOCK CppBlk\n  VAR x : BOOL; END_VAR\n  x := TRUE;\nEND_FUNCTION_BLOCK\n' +
        'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n',
      [
        { name: 'CppBlk', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      { ...manifest, name: 'native_only', namespace: 'native_only' },
      { nativeSources: [{ fileName: 'CppBlk.cpp', source: CPP_FILE }] },
    )

    expect(res.success).toBe(true)
    // strucpp is still called — it tolerates an ST-empty input set and
    // recovers each native block's interface from its ST header. The editor
    // no longer hand-builds an archive to work around a refusal here.
    const passed = compileStlib.mock.calls[0][0] as Array<{ fileName: string }>
    expect(passed.map((p) => p.fileName)).toEqual(['CppBlk.cpp'])
  })

  it('still refuses a library with neither ST nor native content', () => {
    const compileStlib = jest.fn()
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )

    const res = libraryBuildFromTranspiledSt(
      'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n',
      [{ name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' }],
      { ...manifest, name: 'empty_lib', namespace: 'empty_lib' },
      {},
    )

    expect(res.success).toBe(false)
    expect(res.errors[0]?.message).toMatch(/no functions, function blocks, or data types/)
    expect(compileStlib).not.toHaveBeenCalled()
  })

  it('matches POU docs case-insensitively (the transpiler upper-cases identifiers)', () => {
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

type AuxWithDeclaredGlobals = LibraryBuildAux & { declaredGlobals?: string[] }

const LIB_MANIFEST = { name: 'demo_lib', version: '1.0.0', namespace: 'demo_lib', extra: {} }

const TANK_FB = 'FUNCTION_BLOCK Tank\n  VAR sp : INT; END_VAR\n  sp := 1;\nEND_FUNCTION_BLOCK\n'
const ADD2_FN = 'FUNCTION Add2 : INT\n  VAR_INPUT a : INT; END_VAR\n  Add2 := a + 2;\nEND_FUNCTION\n'
const STUB_MAIN = 'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

const TANK_POUS = [
  { name: 'Tank', kind: 'FUNCTION_BLOCK' as const },
  { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' as const },
]

const transpiledConfiguration = (globalsSection: string): string =>
  '\nCONFIGURATION Config0\n' +
  globalsSection +
  '\n  RESOURCE Res0 ON PLC\n' +
  `    TASK ${STUB.STUB_TASK_NAME}(INTERVAL := T#100ms,PRIORITY := 1);\n` +
  `    PROGRAM ${STUB.STUB_INSTANCE_NAME} WITH ${STUB.STUB_TASK_NAME} : main;\n` +
  '  END_RESOURCE\n' +
  'END_CONFIGURATION\n'

const QUALIFIED_GLOBALS =
  '  VAR_GLOBAL\n' +
  '    MotorCmd : BOOL;\n' +
  '  END_VAR\n' +
  '  VAR_GLOBAL CONSTANT\n' +
  '    KMax : INT := 10;\n' +
  '  END_VAR\n' +
  '  VAR_GLOBAL RETAIN\n' +
  '    Counter : DINT;\n' +
  '  END_VAR\n'

type StlibInput = Array<{ fileName: string; source: string; category?: string }>

function compileStlibInputFor(
  programSt: string,
  knownPous: Parameters<typeof libraryBuildFromTranspiledSt>[1],
  aux?: AuxWithDeclaredGlobals,
): StlibInput {
  const compileStlib = jest.fn().mockReturnValue({ success: true, archive: { kind: 'fake' } })
  __setStrucppRuntimeForTests(
    makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
  )
  libraryBuildFromTranspiledSt(programSt, knownPous, LIB_MANIFEST, aux)
  expect(compileStlib).toHaveBeenCalledTimes(1)
  return compileStlib.mock.calls[0][0] as StlibInput
}

const trimmedLines = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

describe('libraryBuildFromTranspiledSt: library globals', () => {
  const qualifiedProgramSt = TANK_FB + '\n' + STUB_MAIN + transpiledConfiguration(QUALIFIED_GLOBALS)

  it('ships the configuration globals as one `_globals.st` and still drops `_config.st` and the stub', () => {
    const input = compileStlibInputFor(qualifiedProgramSt, TANK_POUS)

    expect(input.map((s) => s.fileName).sort()).toEqual(['Tank.st', '_globals.st'])
    expect(input.find((s) => s.fileName === '_globals.st')?.category).toBe('globals')
  })

  it('keeps one VAR_GLOBAL block per qualifier, in emitted order, each with its own declarations', () => {
    const input = compileStlibInputFor(qualifiedProgramSt, TANK_POUS)

    const globals = input.find((s) => s.fileName === '_globals.st')
    expect(trimmedLines(globals?.source ?? '')).toEqual([
      'VAR_GLOBAL',
      'MotorCmd : BOOL;',
      'END_VAR',
      'VAR_GLOBAL CONSTANT',
      'KMax : INT := 10;',
      'END_VAR',
      'VAR_GLOBAL RETAIN',
      'Counter : DINT;',
      'END_VAR',
    ])
  })

  it('ends the shipped globals source with a newline', () => {
    const input = compileStlibInputFor(qualifiedProgramSt, TANK_POUS)

    const globals = input.find((s) => s.fileName === '_globals.st')
    expect(globals?.source.endsWith('END_VAR\n')).toBe(true)
  })

  it('ships no CONFIGURATION, RESOURCE, TASK or PROGRAM line and no stub name in the globals source', () => {
    const input = compileStlibInputFor(qualifiedProgramSt, TANK_POUS)

    const globals = input.find((s) => s.fileName === '_globals.st')
    expect(globals).toBeDefined()
    const forbidden = /^(CONFIGURATION|END_CONFIGURATION|RESOURCE|END_RESOURCE|TASK|PROGRAM)\b/
    expect(trimmedLines(globals?.source ?? '').filter((line) => forbidden.test(line))).toEqual([])
    expect(globals?.source).not.toContain(STUB.STUB_TASK_NAME)
    expect(globals?.source).not.toContain(STUB.STUB_INSTANCE_NAME)
  })

  it('merges a top-level VAR_GLOBAL and the configuration globals into a single `_globals.st`, top-level first', () => {
    const programSt =
      'VAR_GLOBAL\n  TopLevel : INT;\nEND_VAR\n\n' +
      TANK_FB +
      '\n' +
      STUB_MAIN +
      transpiledConfiguration('  VAR_GLOBAL\n    FromConfig : BOOL;\n  END_VAR\n')

    const input = compileStlibInputFor(programSt, TANK_POUS)

    const globals = input.filter((s) => s.fileName === '_globals.st')
    expect(globals).toHaveLength(1)
    const source = globals[0]?.source ?? ''
    expect(source.indexOf('TopLevel')).toBeGreaterThanOrEqual(0)
    expect(source.indexOf('FromConfig')).toBeGreaterThan(source.indexOf('TopLevel'))
  })

  it('hands strucpp exactly the same input as before when the configuration declares no globals', () => {
    const programSt = TANK_FB + '\n' + STUB_MAIN + transpiledConfiguration('')

    const input = compileStlibInputFor(programSt, TANK_POUS)

    expect(input).toEqual([
      { fileName: 'Tank.st', source: splitProgramSt(programSt, TANK_POUS)?.files.get('Tank.st'), category: undefined },
    ])
  })

  it('still refuses a library whose only content is configuration globals', () => {
    const compileStlib = jest.fn()
    __setStrucppRuntimeForTests(
      makeStrucppStub({ compileStlib: compileStlib as unknown as StrucppRuntime['compileStlib'] }),
    )

    const res = libraryBuildFromTranspiledSt(
      STUB_MAIN + transpiledConfiguration(QUALIFIED_GLOBALS),
      [{ name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' }],
      LIB_MANIFEST,
    )

    expect(res.success).toBe(false)
    expect(res.errors[0]?.message).toMatch(/no functions, function blocks, or data types/)
    expect(compileStlib).not.toHaveBeenCalled()
  })

  it('appends native sources after the ST sources, the shipped globals included', () => {
    const programSt =
      'FUNCTION_BLOCK PlainSt\n  VAR y : INT; END_VAR\n  y := 1;\nEND_FUNCTION_BLOCK\n\n' +
      'FUNCTION_BLOCK CppBlk\n  VAR x : BOOL; END_VAR\n  x := TRUE;\nEND_FUNCTION_BLOCK\n\n' +
      STUB_MAIN +
      transpiledConfiguration(QUALIFIED_GLOBALS)
    const cppFile = 'FUNCTION_BLOCK CppBlk\nVAR_INPUT a : BOOL; END_VAR\nvoid setup() {}\nEND_FUNCTION_BLOCK\n'

    const input = compileStlibInputFor(
      programSt,
      [
        { name: 'PlainSt', kind: 'FUNCTION_BLOCK' },
        { name: 'CppBlk', kind: 'FUNCTION_BLOCK' },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
      ],
      { nativeSources: [{ fileName: 'CppBlk.cpp', source: cppFile }] },
    )

    const names = input.map((s) => s.fileName)
    expect(names.slice(0, -1).sort()).toEqual(['PlainSt.st', '_globals.st'])
    expect(names.slice(-1)).toEqual(['CppBlk.cpp'])
  })

  const keywordNamedGlobals = [
    {
      rule: 'a plain block whose second global is named RESOURCE_LEVEL',
      programSt:
        TANK_FB +
        '\n' +
        STUB_MAIN +
        transpiledConfiguration('  VAR_GLOBAL\n    MotorCmd : BOOL;\n    RESOURCE_LEVEL : INT;\n  END_VAR\n'),
      expected: ['VAR_GLOBAL', 'MotorCmd : BOOL;', 'RESOURCE_LEVEL : INT;', 'END_VAR'],
    },
    {
      rule: 'a GVL global named RESOURCES',
      programSt:
        TANK_FB +
        '\n' +
        STUB_MAIN +
        transpiledConfiguration('  VAR_GLOBAL\n    RESOURCES : RESOURCES_TYPE;\n  END_VAR\n'),
      expected: ['VAR_GLOBAL', 'RESOURCES : RESOURCES_TYPE;', 'END_VAR'],
    },
    {
      rule: 'a CONSTANT block holding RESOURCE_MAX between the plain and RETAIN blocks',
      programSt:
        TANK_FB +
        '\n' +
        STUB_MAIN +
        transpiledConfiguration(
          '  VAR_GLOBAL\n' +
            '    MotorCmd : BOOL;\n' +
            '  END_VAR\n' +
            '  VAR_GLOBAL CONSTANT\n' +
            '    RESOURCE_MAX : INT := 5;\n' +
            '  END_VAR\n' +
            '  VAR_GLOBAL RETAIN\n' +
            '    Counter : DINT;\n' +
            '  END_VAR\n',
        ),
      expected: [
        'VAR_GLOBAL',
        'MotorCmd : BOOL;',
        'END_VAR',
        'VAR_GLOBAL CONSTANT',
        'RESOURCE_MAX : INT := 5;',
        'END_VAR',
        'VAR_GLOBAL RETAIN',
        'Counter : DINT;',
        'END_VAR',
      ],
    },
    {
      rule: 'a configuration without a resource whose global is named END_CONFIGURATION_FLAG',
      programSt:
        TANK_FB +
        '\n' +
        STUB_MAIN +
        '\nCONFIGURATION Config0\n' +
        '  VAR_GLOBAL\n' +
        '    END_CONFIGURATION_FLAG : BOOL;\n' +
        '  END_VAR\n' +
        'END_CONFIGURATION\n',
      expected: ['VAR_GLOBAL', 'END_CONFIGURATION_FLAG : BOOL;', 'END_VAR'],
    },
  ]

  it.each(keywordNamedGlobals)('ships every global of $rule in `_globals.st`', ({ programSt, expected }) => {
    const input = compileStlibInputFor(programSt, TANK_POUS)

    const globals = input.find((s) => s.fileName === '_globals.st')
    expect(globals?.category).toBe('globals')
    expect(trimmedLines(globals?.source ?? '')).toEqual(expected)
  })

  it.each(keywordNamedGlobals)(
    'ships no configuration line, no `_config.st` and no stub for $rule',
    ({ programSt }) => {
      const input = compileStlibInputFor(programSt, TANK_POUS)

      expect(input.map((s) => s.fileName).sort()).toEqual(['Tank.st', '_globals.st'])
      const configurationLine = /^(CONFIGURATION|END_CONFIGURATION|END_RESOURCE|TASK|PROGRAM)\b|^RESOURCE\s+\S+\s+ON\b/i
      const globals = input.find((s) => s.fileName === '_globals.st')
      expect(trimmedLines(globals?.source ?? '').filter((line) => configurationLine.test(line))).toEqual([])
    },
  )
})

const refusal = (kind: 'function' | 'function block' | 'global', name: string): string =>
  `Library build refused: the built library would export the ${kind} "${name}", which the library project does not declare.`

describe('libraryBuildFromTranspiledSt: undeclared exports', () => {
  const programSt = ADD2_FN + '\n' + TANK_FB + '\n' + STUB_MAIN
  const knownPous = [
    { name: 'Add2', kind: 'FUNCTION' as const },
    { name: 'Tank', kind: 'FUNCTION_BLOCK' as const },
    { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' as const },
  ]

  const buildWithManifest = (
    exported: Record<string, unknown> | undefined,
    aux?: AuxWithDeclaredGlobals,
    build: { programSt: string; knownPous: Parameters<typeof libraryBuildFromTranspiledSt>[1] } = {
      programSt,
      knownPous,
    },
  ) => {
    const archive = exported === undefined ? { kind: 'no-manifest' } : { manifest: exported, dependencies: [] }
    __setStrucppRuntimeForTests(
      makeStrucppStub({
        compileStlib: jest
          .fn()
          .mockReturnValue({ success: true, archive }) as unknown as StrucppRuntime['compileStlib'],
      }),
    )
    return { archive, result: libraryBuildFromTranspiledSt(build.programSt, build.knownPous, LIB_MANIFEST, aux) }
  }

  it('names every undeclared function, function block and global, in that order and in manifest order', () => {
    const { result } = buildWithManifest(
      {
        globals: [
          { name: 'PAD', type: 'INT' },
          { name: 'MOTORCMD', type: 'BOOL' },
        ],
        functionBlocks: [{ name: 'TANK' }, { name: 'EVIL' }],
        functions: [{ name: 'ZETA' }, { name: 'ADD2' }, { name: 'ALPHA' }],
      },
      { declaredGlobals: ['MotorCmd'] },
    )

    expect(result.errors.map((e) => e.message)).toEqual([
      refusal('function', 'ZETA'),
      refusal('function', 'ALPHA'),
      refusal('function block', 'EVIL'),
      refusal('global', 'PAD'),
    ])
  })

  it('returns no archive and success=false when an export is undeclared', () => {
    const { result } = buildWithManifest({ functionBlocks: [{ name: 'TANK' }, { name: 'EVIL' }] })

    expect(result.success).toBe(false)
    expect(result.archive).toBeUndefined()
  })

  it('refuses an exported global when no declared globals are given', () => {
    const { result } = buildWithManifest({ globals: [{ name: 'G', type: 'INT' }] })

    expect(result.errors.map((e) => e.message)).toEqual([refusal('global', 'G')])
  })

  it('does not count the stub program as a declared function block', () => {
    const { result } = buildWithManifest({ functionBlocks: [{ name: 'MAIN' }] })

    expect(result.errors.map((e) => e.message)).toEqual([refusal('function block', 'MAIN')])
  })

  it('keeps the decorated archive when every export is declared, matching names case-insensitively', () => {
    const { archive, result } = buildWithManifest(
      {
        functions: [{ name: 'ADD2' }],
        functionBlocks: [{ name: 'TANK' }],
        globals: [
          { name: 'MOTORCMD', type: 'BOOL' },
          { name: 'MOTORS', type: 'MOTORS_TYPE' },
        ],
      },
      { declaredGlobals: ['MotorCmd', 'Motors'] },
    )

    expect(result).toEqual({ success: true, archive, errors: [] })
  })

  it('counts the stem of a native source file as a declared function block', () => {
    const { result } = buildWithManifest(
      { functionBlocks: [{ name: 'CPP_SCALE' }] },
      {
        nativeSources: [
          {
            fileName: 'Cpp_Scale.cpp',
            source: 'FUNCTION_BLOCK CPP_SCALE\nVAR_INPUT a : INT; END_VAR\nvoid setup() {}\nEND_FUNCTION_BLOCK\n',
          },
        ],
      },
      { programSt: STUB_MAIN, knownPous: [{ name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' }] },
    )

    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
  })

  it('does not check exported data types', () => {
    const { result } = buildWithManifest({ types: [{ name: 'HIDDEN_T' }] })

    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
  })

  it('treats an archive without a manifest as exporting nothing', () => {
    const { archive, result } = buildWithManifest(undefined)

    expect(result).toEqual({ success: true, archive, errors: [] })
  })

  it('forwards only the strucpp errors when the compile itself fails', () => {
    const compileErrors = [{ message: 'syntax error', line: 2, file: 'Tank.st' }]
    __setStrucppRuntimeForTests(
      makeStrucppStub({
        compileStlib: jest.fn().mockReturnValue({
          success: false,
          errors: compileErrors,
          archive: { manifest: { functionBlocks: [{ name: 'EVIL' }] } },
        }) as unknown as StrucppRuntime['compileStlib'],
      }),
    )

    const res = libraryBuildFromTranspiledSt(programSt, knownPous, LIB_MANIFEST)

    expect(res.success).toBe(false)
    expect(res.errors).toEqual(compileErrors)
  })
})
