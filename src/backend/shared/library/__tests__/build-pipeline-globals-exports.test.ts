import { splitProgramSt } from '../../utils/PLC/split-program-st'
import { __TESTING__, type LibraryBuildAux, libraryBuildFromTranspiledSt } from '../build-pipeline'
import { compileStlib, type CompileStlibSource } from '../compile-stlib'

jest.mock('../compile-stlib', () => ({ compileStlib: jest.fn() }))

const compileStlibMock = jest.mocked(compileStlib)

const STUB = __TESTING__

beforeEach(() => {
  compileStlibMock.mockReset()
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

function compileStlibInputFor(
  programSt: string,
  knownPous: Parameters<typeof libraryBuildFromTranspiledSt>[1],
  aux?: AuxWithDeclaredGlobals,
): CompileStlibSource[] {
  compileStlibMock.mockReturnValue({ success: true, archive: { kind: 'fake' } })
  libraryBuildFromTranspiledSt(programSt, knownPous, LIB_MANIFEST, aux)
  expect(compileStlibMock).toHaveBeenCalledTimes(1)
  return compileStlibMock.mock.calls[0][0]
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
    const res = libraryBuildFromTranspiledSt(
      STUB_MAIN + transpiledConfiguration(QUALIFIED_GLOBALS),
      [{ name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' }],
      LIB_MANIFEST,
    )

    expect(res.success).toBe(false)
    expect(res.errors[0]?.message).toMatch(/no functions, function blocks, or data types/)
    expect(compileStlibMock).not.toHaveBeenCalled()
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
    exported: Record<string, unknown>,
    aux?: AuxWithDeclaredGlobals,
    build: { programSt: string; knownPous: Parameters<typeof libraryBuildFromTranspiledSt>[1] } = {
      programSt,
      knownPous,
    },
  ) => {
    const archive = { manifest: exported, dependencies: [] }
    compileStlibMock.mockReturnValue({ success: true, archive })
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

  it('forwards only the strucpp errors when the compile itself fails', () => {
    const compileErrors = [{ message: 'syntax error', line: 2, file: 'Tank.st' }]
    compileStlibMock.mockReturnValue({
      success: false,
      errors: compileErrors,
      archive: { manifest: { functionBlocks: [{ name: 'EVIL' }] } },
    })

    const res = libraryBuildFromTranspiledSt(programSt, knownPous, LIB_MANIFEST)

    expect(res.success).toBe(false)
    expect(res.errors).toEqual(compileErrors)
  })

  describe('an export counts as declared only by a declaration of its own kind', () => {
    const FOO_PROGRAM = 'PROGRAM Foo\n  VAR a : INT; END_VAR\n  a := 1;\nEND_PROGRAM\n'
    const withFooProgram = {
      programSt: FOO_PROGRAM + '\n' + STUB_MAIN,
      knownPous: [
        { name: 'Foo', kind: 'PROGRAM' as const },
        { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' as const },
      ],
    }
    const onlyStub = { programSt: STUB_MAIN, knownPous: [{ name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' as const }] }
    const cppScale = {
      fileName: 'Cpp_Scale.cpp',
      source: 'FUNCTION_BLOCK CPP_SCALE\nVAR_INPUT a : INT; END_VAR\nvoid setup() {}\nEND_FUNCTION_BLOCK\n',
    }

    it.each([
      {
        rule: 'a function named after a declared program',
        exported: { functions: [{ name: 'FOO' }] },
        aux: undefined,
        build: withFooProgram,
        expected: refusal('function', 'FOO'),
      },
      {
        rule: 'a function block named after a declared program',
        exported: { functionBlocks: [{ name: 'FOO' }] },
        aux: undefined,
        build: withFooProgram,
        expected: refusal('function block', 'FOO'),
      },
      {
        rule: 'a function block named after a declared function',
        exported: { functionBlocks: [{ name: 'ADD2' }] },
        aux: undefined,
        build: undefined,
        expected: refusal('function block', 'ADD2'),
      },
      {
        rule: 'a function named after a declared function block',
        exported: { functions: [{ name: 'TANK' }] },
        aux: undefined,
        build: undefined,
        expected: refusal('function', 'TANK'),
      },
      {
        rule: 'a function named after a native source file',
        exported: { functions: [{ name: 'CPP_SCALE' }] },
        aux: { nativeSources: [cppScale] },
        build: onlyStub,
        expected: refusal('function', 'CPP_SCALE'),
      },
    ])('refuses $rule, with no archive', ({ exported, aux, build, expected }) => {
      const { result } = buildWithManifest(exported, aux, build)

      expect(result.errors.map((e) => e.message)).toEqual([expected])
      expect(result.success).toBe(false)
      expect(result.archive).toBeUndefined()
    })

    it('keeps the decorated archive when every export is declared as its own kind next to a program', () => {
      const { archive, result } = buildWithManifest(
        {
          functions: [{ name: 'ADD2' }],
          functionBlocks: [{ name: 'TANK' }, { name: 'CPP_SCALE' }],
          globals: [{ name: 'GAIN', type: 'INT' }],
        },
        { nativeSources: [cppScale], declaredGlobals: ['Gain'] },
        {
          programSt: ADD2_FN + '\n' + TANK_FB + '\n' + FOO_PROGRAM + '\n' + STUB_MAIN,
          knownPous: [
            { name: 'Add2', kind: 'FUNCTION' },
            { name: 'Tank', kind: 'FUNCTION_BLOCK' },
            { name: 'Foo', kind: 'PROGRAM' },
            { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' },
          ],
        },
      )

      expect(result).toEqual({ success: true, archive, errors: [] })
    })
  })
})

const malformed = (
  part: 'archive' | 'manifest' | 'manifest.functions' | 'manifest.functionBlocks' | 'manifest.globals',
): string => `Library build refused: the built library has a malformed "${part}", so its exports cannot be checked.`

describe('libraryBuildFromTranspiledSt: malformed archive manifest', () => {
  const programSt = ADD2_FN + '\n' + TANK_FB + '\n' + STUB_MAIN
  const knownPous = [
    { name: 'Add2', kind: 'FUNCTION' as const },
    { name: 'Tank', kind: 'FUNCTION_BLOCK' as const },
    { name: STUB.STUB_PROGRAM_NAME, kind: 'PROGRAM' as const },
  ]

  const buildFor = (archive: unknown) => {
    compileStlibMock.mockReturnValue({ success: true, archive })
    return () => libraryBuildFromTranspiledSt(programSt, knownPous, LIB_MANIFEST)
  }

  const withManifest = (manifest: unknown) => ({ manifest, dependencies: [] })

  it.each([
    {
      rule: 'manifest.functions is a string',
      archive: withManifest({ functions: 'ADD2' }),
      expected: [malformed('manifest.functions')],
    },
    {
      rule: 'manifest.functionBlocks is an object',
      archive: withManifest({ functionBlocks: { name: 'TANK' } }),
      expected: [malformed('manifest.functionBlocks')],
    },
    {
      rule: 'manifest.globals is null',
      archive: withManifest({ globals: null }),
      expected: [malformed('manifest.globals')],
    },
    {
      rule: 'a manifest.globals entry has a numeric name',
      archive: withManifest({ globals: [{ name: 42, type: 'INT' }] }),
      expected: [malformed('manifest.globals')],
    },
    {
      rule: 'a manifest.functionBlocks entry is null',
      archive: withManifest({ functionBlocks: [null] }),
      expected: [malformed('manifest.functionBlocks')],
    },
    {
      rule: 'the manifest is a string',
      archive: withManifest('x'),
      expected: [malformed('manifest')],
    },
    {
      rule: 'the manifest is null',
      archive: withManifest(null),
      expected: [malformed('manifest')],
    },
    {
      rule: 'the archive is a string',
      archive: 'blob',
      expected: [malformed('archive')],
    },
    {
      rule: 'the archive has no manifest key',
      archive: { dependencies: [] },
      expected: [malformed('manifest')],
    },
    {
      rule: 'the manifest is undefined',
      archive: withManifest(undefined),
      expected: [malformed('manifest')],
    },
    {
      rule: 'the archive is an empty object',
      archive: {},
      expected: [malformed('manifest')],
    },
  ])('refuses the build without throwing when $rule', ({ archive, expected }) => {
    const build = buildFor(archive)

    expect(build).not.toThrow()
    const result = build()
    expect(result.success).toBe(false)
    expect(result.archive).toBeUndefined()
    expect(result.errors.map((e) => e.message)).toEqual(expected)
  })

  it('reports every malformed list in order and no undeclared export of that archive', () => {
    const build = buildFor(withManifest({ functions: 'x', functionBlocks: [{ name: 'EVIL' }], globals: null }))

    expect(build).not.toThrow()
    const result = build()
    expect(result.success).toBe(false)
    expect(result.archive).toBeUndefined()
    expect(result.errors.map((e) => e.message)).toEqual([
      malformed('manifest.functions'),
      malformed('manifest.globals'),
    ])
  })

  it('does not read manifest.types when the export lists are well formed', () => {
    const archive = withManifest({
      functions: [{ name: 'ADD2' }],
      functionBlocks: [{ name: 'TANK' }],
      globals: [],
      types: 'x',
    })
    const build = buildFor(archive)

    expect(build).not.toThrow()
    expect(build()).toEqual({ success: true, archive, errors: [] })
  })
})
