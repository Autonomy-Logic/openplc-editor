import type { PLCProject } from '../../types/PLC/open-plc'
import { fromSchemaShape, transpileToSt } from '../../transpilers/st-transpiler'
import {
  __TESTING__,
  type LibraryBuildAux,
  type LibraryBuildResult,
  libraryBuildFromTranspiledSt,
  type PrepareXmlResult,
  prepareXmlForLibraryBuild,
} from '../build-pipeline'
import { __setStrucppRuntimeForTests, loadStrucpp } from '../strucpp-runtime'

type ProjectData = PLCProject['data']
type GlobalVariable = ProjectData['configuration']['resource']['globalVariables'][number]
type PouVariable = Extract<ProjectData['pous'][number], { type: 'function-block' }>['data']['variables'][number]
type BaseTypeName = Extract<GlobalVariable['type'], { definition: 'base-type' }>['value']
type AuxWithDeclaredGlobals = LibraryBuildAux & { declaredGlobals?: string[] }

interface ManifestEntry {
  name: string
  constant?: boolean
}

interface BuiltArchive {
  manifest: {
    functions?: ManifestEntry[]
    functionBlocks?: ManifestEntry[]
    globals?: ManifestEntry[]
  }
  sources?: Array<{ fileName: string; source: string }>
}

const globalVariable = (name: string, value: BaseTypeName, extra: Partial<GlobalVariable> = {}): GlobalVariable => ({
  name,
  type: { definition: 'base-type', value },
  location: '',
  documentation: '',
  initialValue: null,
  ...extra,
})

const pouVariable = (name: string, value: BaseTypeName, varClass: PouVariable['class']): PouVariable => ({
  name,
  class: varClass,
  type: { definition: 'base-type', value },
  location: '',
  documentation: '',
})

const functionBlock = (name: string, variables: PouVariable[], body: string): ProjectData['pous'][number] => ({
  type: 'function-block',
  data: { name, language: 'st', variables, body: { language: 'st', value: body }, documentation: '' },
})

const libraryData = (over: Partial<ProjectData>): ProjectData => ({
  dataTypes: [],
  pous: [],
  configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
  libraries: [],
  ...over,
})

const SCALE_FB = functionBlock('SCALE', [pouVariable('x', 'INT', 'local')], 'x := 1;')

const refusal = (kind: 'function' | 'function block' | 'global', name: string): string =>
  `Library build refused: the built library would export the ${kind} "${name}", which the library project does not declare.`

function declaredGlobalsOf(stage1: PrepareXmlResult): string[] | undefined {
  if (!('declaredGlobals' in stage1)) return undefined
  const declared: unknown = stage1.declaredGlobals
  if (!Array.isArray(declared)) return undefined
  return declared.every((name): name is string => typeof name === 'string') ? declared : undefined
}

function buildLibrary(name: string, data: ProjectData, aux: LibraryBuildAux = {}): LibraryBuildResult {
  const stage1 = prepareXmlForLibraryBuild(
    { meta: { name, type: 'plc-library' }, data },
    JSON.stringify({ name, version: '1.0.0', namespace: name }),
  )
  if ('error' in stage1) throw new Error(stage1.error)
  const transpiled = transpileToSt(fromSchemaShape(stage1.projectData))
  if (transpiled.programSt === null) throw new Error(transpiled.errors.join('\n'))
  const fullAux: AuxWithDeclaredGlobals = { ...aux, declaredGlobals: declaredGlobalsOf(stage1) }
  return libraryBuildFromTranspiledSt(transpiled.programSt, stage1.knownPous, stage1.manifest, fullAux)
}

function isBuiltArchive(value: unknown): value is BuiltArchive {
  return typeof value === 'object' && value !== null && 'manifest' in value && typeof value.manifest === 'object'
}

function archiveOf(result: LibraryBuildResult): BuiltArchive {
  expect(result.errors).toEqual([])
  expect(result.success).toBe(true)
  if (!isBuiltArchive(result.archive)) throw new Error('the build returned no archive')
  return result.archive
}

const namesOf = (entries: ManifestEntry[] | undefined): string[] => (entries ?? []).map((entry) => entry.name)

const consumerProgram = (vars: string, body: string): string =>
  `PROGRAM main\n  VAR\n${vars}  END_VAR\n${body}END_PROGRAM\n\n` +
  'CONFIGURATION Config0\n' +
  '  RESOURCE Res0 ON PLC\n' +
  '    TASK MainTask(INTERVAL := T#20ms,PRIORITY := 0);\n' +
  '    PROGRAM MainInstance WITH MainTask : main;\n' +
  '  END_RESOURCE\n' +
  'END_CONFIGURATION\n'

function compileConsumer(source: string, archive: BuiltArchive) {
  const strucpp = loadStrucpp()
  return strucpp.compile(source, { libraries: [strucpp.loadStlibFromString(JSON.stringify(archive))] })
}

const headerDeclarationOf = (headerCode: string, name: string): string | undefined =>
  headerCode.split('\n').find((line) => new RegExp(`\\b${name}\\b`).test(line) && /\binline\b/.test(line))

const trimmedLines = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

beforeAll(() => {
  __setStrucppRuntimeForTests(null)
})

afterAll(() => {
  __setStrucppRuntimeForTests(null)
})

describe('library globals against the real strucpp', () => {
  const motorsList = {
    name: 'Motors',
    variables: [{ ...globalVariable('Cmd', 'BOOL'), class: 'global' as const }],
  }

  it('exports a resource global and a GVL instance in the library manifest', () => {
    const archive = archiveOf(
      buildLibrary(
        'motor_lib',
        libraryData({
          pous: [SCALE_FB],
          globalVariableLists: [motorsList],
          configuration: {
            resource: { tasks: [], instances: [], globalVariables: [globalVariable('MotorCmd', 'BOOL')] },
          },
        }),
      ),
    )

    expect(namesOf(archive.manifest.globals).sort()).toEqual(['MOTORCMD', 'MOTORS'])
  })

  it('lets a consumer program read a library resource global and a GVL member', () => {
    const archive = archiveOf(
      buildLibrary(
        'motor_lib',
        libraryData({
          pous: [SCALE_FB],
          globalVariableLists: [motorsList],
          configuration: {
            resource: { tasks: [], instances: [], globalVariables: [globalVariable('MotorCmd', 'BOOL')] },
          },
        }),
      ),
    )

    const consumer = compileConsumer(consumerProgram('    b : BOOL;\n', '  b := MotorCmd OR Motors.Cmd;\n'), archive)

    expect(consumer.errors.map((error) => error.message)).toEqual([])
    expect(consumer.success).toBe(true)
  })

  it('builds a library function block that reads its own global through VAR_EXTERNAL', () => {
    const result = buildLibrary(
      'motor_lib',
      libraryData({
        pous: [
          functionBlock(
            'DOL_Starter',
            [pouVariable('Run', 'BOOL', 'local'), pouVariable('MotorCmd', 'BOOL', 'external')],
            'Run := MotorCmd;',
          ),
        ],
        configuration: {
          resource: { tasks: [], instances: [], globalVariables: [globalVariable('MotorCmd', 'BOOL')] },
        },
      }),
    )

    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
  })

  it('builds a library function block that reads a member of its own GVL', () => {
    const result = buildLibrary(
      'motor_lib',
      libraryData({
        pous: [functionBlock('DOL_Starter', [pouVariable('Run', 'BOOL', 'local')], 'Run := Motors.Cmd;')],
        globalVariableLists: [motorsList],
      }),
    )

    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
  })

  it('never ships the CONFIGURATION, its RESOURCE or the stub task and instance', () => {
    const archive = archiveOf(
      buildLibrary(
        'motor_lib',
        libraryData({
          pous: [SCALE_FB],
          globalVariableLists: [motorsList],
          configuration: {
            resource: { tasks: [], instances: [], globalVariables: [globalVariable('MotorCmd', 'BOOL')] },
          },
        }),
      ),
    )

    const shipped = (archive.sources ?? []).map((source) => source.source).join('\n')
    expect(shipped).not.toMatch(/\bCONFIGURATION\b/)
    expect(shipped).not.toMatch(/\bRESOURCE\b/)
    expect(shipped).not.toContain(__TESTING__.STUB_TASK_NAME)
    expect(shipped).not.toContain(__TESTING__.STUB_INSTANCE_NAME)
  })
})

describe('library globals whose names start with RESOURCE against the real strucpp', () => {
  const resourceNamedLibrary = (): LibraryBuildResult =>
    buildLibrary(
      'level_lib',
      libraryData({
        pous: [
          functionBlock(
            'LEVEL_READER',
            [pouVariable('Level', 'INT', 'local'), pouVariable('RESOURCE_LEVEL', 'INT', 'external')],
            'Level := RESOURCE_LEVEL;',
          ),
        ],
        globalVariableLists: [
          { name: 'RESOURCES', variables: [{ ...globalVariable('Cmd', 'BOOL'), class: 'global' as const }] },
        ],
        configuration: {
          resource: { tasks: [], instances: [], globalVariables: [globalVariable('RESOURCE_LEVEL', 'INT')] },
        },
      }),
    )

  it('builds the library whose function block reads RESOURCE_LEVEL and exports both globals', () => {
    const archive = archiveOf(resourceNamedLibrary())

    expect(namesOf(archive.manifest.globals).sort()).toEqual(['RESOURCES', 'RESOURCE_LEVEL'])
  })

  it('lets a consumer program read RESOURCES.Cmd and RESOURCE_LEVEL from the library', () => {
    const archive = archiveOf(resourceNamedLibrary())

    const consumer = compileConsumer(
      consumerProgram('    b : BOOL;\n    i : INT;\n', '  b := RESOURCES.Cmd;\n  i := RESOURCE_LEVEL;\n'),
      archive,
    )

    expect(consumer.errors.map((error) => error.message)).toEqual([])
    expect(consumer.success).toBe(true)
  })
})

describe('a library global keeps its qualifier in the shipped library', () => {
  const qualifiedLibrary = (): BuiltArchive =>
    archiveOf(
      buildLibrary(
        'qualified_lib',
        libraryData({
          pous: [SCALE_FB],
          configuration: {
            resource: {
              tasks: [],
              instances: [],
              globalVariables: [
                globalVariable('LibCmd', 'BOOL'),
                globalVariable('KMax', 'INT', { flag: 'constant', initialValue: '10' }),
              ],
            },
          },
        }),
      ),
    )

  it('ships one VAR_GLOBAL block per qualifier in the library globals source', () => {
    const archive = qualifiedLibrary()

    const globalsSource = (archive.sources ?? []).find((source) => source.fileName === '_globals.st')
    expect(globalsSource).toBeDefined()
    const headers = trimmedLines(globalsSource?.source ?? '').filter((line) => line.startsWith('VAR_GLOBAL'))
    expect(headers).toEqual(['VAR_GLOBAL', 'VAR_GLOBAL CONSTANT'])
  })

  it.each([
    { name: 'KMAX', constant: true },
    { name: 'LIBCMD', constant: false },
  ])('marks $name constant in the manifest: $constant', ({ name, constant }) => {
    const archive = qualifiedLibrary()

    const entry = (archive.manifest.globals ?? []).find((global) => global.name === name)
    expect(entry).toBeDefined()
    expect(entry?.constant === true).toBe(constant)
  })

  it.each([
    { name: 'KMAX', constant: true },
    { name: 'LIBCMD', constant: false },
  ])('declares $name in the consumer C++ with const: $constant', ({ name, constant }) => {
    const archive = qualifiedLibrary()

    const consumer = compileConsumer(
      consumerProgram('    b : BOOL;\n    i : INT;\n', '  b := LibCmd;\n  i := KMax;\n'),
      archive,
    )
    expect(consumer.errors.map((error) => error.message)).toEqual([])

    const declaration = headerDeclarationOf(consumer.headerCode, name)
    expect(declaration).toBeDefined()
    expect(/\bconst\b/.test(declaration ?? '')).toBe(constant)
  })
})

describe('a library global declared at an output address never binds to the consumer outputs', () => {
  const locatedLibrary = (): LibraryBuildResult =>
    buildLibrary(
      'located_lib',
      libraryData({
        pous: [functionBlock('DRIVE', [pouVariable('LibOut', 'BOOL', 'external')], 'LibOut := TRUE;')],
        configuration: {
          resource: {
            tasks: [],
            instances: [],
            globalVariables: [globalVariable('LibOut', 'BOOL', { location: '%QX0.0' })],
          },
        },
      }),
    )

  it('builds the library whose function block writes the located global', () => {
    const result = locatedLibrary()

    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
  })

  it('gives the consumer no located entry for the library global', () => {
    const archive = archiveOf(locatedLibrary())

    const consumer = compileConsumer(consumerProgram('    d : DRIVE;\n', '  d();\n'), archive)
    expect(consumer.errors.map((error) => error.message)).toEqual([])

    const generated = `${consumer.headerCode}\n${consumer.cppCode}`
    expect(generated).not.toMatch(/\bLIBOUT AT %/)
    expect(generated).toMatch(/locatedVarsCount = 0;/)
  })
})

describe('code hidden in a global initial value does not ship as library code', () => {
  const gainLibrary = (initialValue: string): LibraryBuildResult =>
    buildLibrary(
      'gain_lib',
      libraryData({
        pous: [SCALE_FB],
        configuration: {
          resource: { tasks: [], instances: [], globalVariables: [globalVariable('Gain', 'INT', { initialValue })] },
        },
      }),
    )

  it('builds a plain initial value, exporting exactly the function block SCALE and the global GAIN', () => {
    const archive = archiveOf(gainLibrary('1'))

    expect({
      functions: namesOf(archive.manifest.functions),
      functionBlocks: namesOf(archive.manifest.functionBlocks),
      globals: namesOf(archive.manifest.globals),
    }).toEqual({ functions: [], functionBlocks: ['SCALE'], globals: ['GAIN'] })
  })

  it('refuses a payload that declares a function block and a global, naming EVIL and PAD', () => {
    const payload =
      '1;\nEND_VAR\nFUNCTION_BLOCK EVIL\n  VAR x : INT; END_VAR\n  x := 1;\nEND_FUNCTION_BLOCK\nVAR_GLOBAL\n  Pad : INT'

    const result = gainLibrary(payload)

    expect(result.errors.map((error) => error.message)).toEqual([
      refusal('function block', 'EVIL'),
      refusal('global', 'PAD'),
    ])
  })

  it('produces no library archive for the payload', () => {
    const payload =
      '1;\nEND_VAR\nFUNCTION_BLOCK EVIL\n  VAR x : INT; END_VAR\n  x := 1;\nEND_FUNCTION_BLOCK\nVAR_GLOBAL\n  Pad : INT'

    const result = gainLibrary(payload)

    expect(result.success).toBe(false)
    expect(result.archive).toBeUndefined()
  })
})

describe('a function hidden in a global initial value under a declared program name does not ship', () => {
  const FOO_PROGRAM: ProjectData['pous'][number] = {
    type: 'program',
    data: {
      name: 'FOO',
      language: 'st',
      variables: [pouVariable('a', 'INT', 'local')],
      body: { language: 'st', value: 'a := 1;' },
      documentation: '',
    },
  }

  const ADD2_FUNCTION: ProjectData['pous'][number] = {
    type: 'function',
    data: {
      name: 'ADD2',
      language: 'st',
      returnType: 'INT',
      variables: [pouVariable('a', 'INT', 'input')],
      body: { language: 'st', value: 'ADD2 := a + 2;' },
      documentation: '',
    },
  }

  const fooLibrary = (gain: string, b: string): LibraryBuildResult =>
    buildLibrary(
      'foo_lib',
      libraryData({
        pous: [SCALE_FB, FOO_PROGRAM],
        configuration: {
          resource: {
            tasks: [],
            instances: [],
            globalVariables: [
              globalVariable('Gain', 'INT', { initialValue: gain }),
              globalVariable('B', 'INT', { initialValue: b }),
            ],
          },
        },
      }),
    )

  const payload =
    '1;\nEND_VAR\nFUNCTION FOO : INT\n  VAR_INPUT i : INT; END_VAR\n  FOO := i * 100;\nEND_FUNCTION\nVAR_GLOBAL\n  B : INT := (*'

  it('builds plain initial values, exporting no function, the function block SCALE and the globals GAIN and B', () => {
    const archive = archiveOf(fooLibrary('1', '0'))

    expect({
      functions: namesOf(archive.manifest.functions),
      functionBlocks: namesOf(archive.manifest.functionBlocks),
      globals: namesOf(archive.manifest.globals).sort(),
    }).toEqual({ functions: [], functionBlocks: ['SCALE'], globals: ['B', 'GAIN'] })
  })

  it('refuses the payload with exactly one error naming the undeclared function FOO', () => {
    const result = fooLibrary(payload, '*) 0')

    expect(result.errors.map((error) => error.message)).toEqual([refusal('function', 'FOO')])
  })

  it('produces no library archive for the payload', () => {
    const result = fooLibrary(payload, '*) 0')

    expect(result.success).toBe(false)
    expect(result.archive).toBeUndefined()
  })

  it('builds a library declaring a function, a function block, a program and a global', () => {
    const archive = archiveOf(
      buildLibrary(
        'mixed_lib',
        libraryData({
          pous: [SCALE_FB, ADD2_FUNCTION, FOO_PROGRAM],
          configuration: {
            resource: {
              tasks: [],
              instances: [],
              globalVariables: [globalVariable('Gain', 'INT', { initialValue: '1' })],
            },
          },
        }),
      ),
    )

    expect({
      functions: namesOf(archive.manifest.functions),
      functionBlocks: namesOf(archive.manifest.functionBlocks),
      globals: namesOf(archive.manifest.globals),
    }).toEqual({ functions: ['ADD2'], functionBlocks: ['SCALE'], globals: ['GAIN'] })
  })
})

describe('a library built on a dependency library', () => {
  it('builds and exports only its own symbols', () => {
    const dependency = archiveOf(
      buildLibrary(
        'dep_lib',
        libraryData({
          pous: [functionBlock('DEP_FB', [pouVariable('q', 'INT', 'output')], 'q := 1;')],
          configuration: {
            resource: { tasks: [], instances: [], globalVariables: [globalVariable('DepG', 'INT')] },
          },
        }),
      ),
    )
    const dependencyArchive = loadStrucpp().loadStlibFromString(JSON.stringify(dependency))

    const user: ProjectData['pous'][number] = {
      type: 'function-block',
      data: {
        name: 'USER_FB',
        language: 'st',
        variables: [
          { ...pouVariable('d', 'INT', 'local'), type: { definition: 'derived', value: 'DEP_FB' } },
          pouVariable('y', 'INT', 'local'),
        ],
        body: { language: 'st', value: 'd();\ny := d.q;' },
        documentation: '',
      },
    }
    const archive = archiveOf(
      buildLibrary('user_lib', libraryData({ pous: [user], libraries: [{ name: 'dep_lib', version: '1.0.0' }] }), {
        dependencyArchives: [dependencyArchive],
        dependencyRefs: [{ name: 'dep_lib', version: '1.0.0' }],
      }),
    )

    expect({
      functions: namesOf(archive.manifest.functions),
      functionBlocks: namesOf(archive.manifest.functionBlocks),
      globals: namesOf(archive.manifest.globals),
    }).toEqual({ functions: [], functionBlocks: ['USER_FB'], globals: [] })
  })
})
