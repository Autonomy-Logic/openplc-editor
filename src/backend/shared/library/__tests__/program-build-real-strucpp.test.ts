import { readFileSync } from 'fs'
import { join } from 'path'

import { runProgramBuildPipeline } from '../program-build-pipeline'
import { __setStrucppRuntimeForTests, loadStrucpp } from '../strucpp-runtime'

const BUNDLED_LIBRARIES = ['iec-standard-fb.stlib', 'additional-function-blocks.stlib']

/** Reads the bundled `.stlib` archives the installed strucpp package ships. */
function bundledLibraries(): unknown[] {
  const libsDir = join(process.cwd(), 'node_modules', 'strucpp', 'libs')
  return BUNDLED_LIBRARIES.map((file) => loadStrucpp().loadStlibFromString(readFileSync(join(libsDir, file), 'utf-8')))
}

/** Reads the strucpp version pinned in `binary-versions.json`, without the leading `v`. */
function pinnedStrucppVersion(): string {
  const pins: unknown = JSON.parse(readFileSync(join(process.cwd(), 'binary-versions.json'), 'utf-8'))
  if (typeof pins !== 'object' || pins === null || !('strucpp' in pins)) throw new Error('no strucpp pin')
  const { strucpp } = pins
  if (typeof strucpp !== 'object' || strucpp === null || !('version' in strucpp)) throw new Error('no strucpp version')
  if (typeof strucpp.version !== 'string') throw new Error('strucpp version is not a string')
  return strucpp.version.replace(/^v/, '')
}

/** Wraps the declarations and the `main` program in the configuration the transpiler emits. */
const programSt = (declarations: string, vars: string, body: string): string =>
  `${declarations}PROGRAM main\n  VAR\n${vars}  END_VAR\n${body}END_PROGRAM\n\n` +
  'CONFIGURATION Config0\n' +
  '  RESOURCE Res0 ON PLC\n' +
  '    TASK MainTask(INTERVAL := T#20ms,PRIORITY := 0);\n' +
  '    PROGRAM MainInstance WITH MainTask : main;\n' +
  '  END_RESOURCE\n' +
  'END_CONFIGURATION\n'

const build = (source: string) =>
  runProgramBuildPipeline({
    source,
    md5: '0123456789abcdef0123456789abcdef',
    pous: [],
    libraries: bundledLibraries(),
    missingLibraries: [],
    hasCBlocks: false,
  })

const SCALER_DECLARATIONS =
  'INTERFACE IScaler\n' +
  '  METHOD Scale : REAL\n' +
  '    VAR_INPUT\n' +
  '      x : REAL;\n' +
  '    END_VAR\n' +
  '  END_METHOD\n' +
  'END_INTERFACE\n\n' +
  'FUNCTION_BLOCK Doubler IMPLEMENTS IScaler\n' +
  '  METHOD PUBLIC Scale : REAL\n' +
  '    VAR_INPUT\n' +
  '      x : REAL;\n' +
  '    END_VAR\n' +
  '    Scale := x * 2.0;\n' +
  '  END_METHOD\n' +
  'END_FUNCTION_BLOCK\n\n'

const MODE_DECLARATIONS = 'TYPE\n  Mode : (Idle, Running, Stopped);\nEND_TYPE\n\n'

const rtcCall = (setInput: 'SET' | 'IN'): string =>
  programSt(
    '',
    '    clock : RTC;\n    now : DT;\n',
    `  clock(${setInput} := TRUE, PDT := DT#2026-01-01-00:00:00);\n  now := clock.CDT;\n`,
  )

beforeAll(() => {
  __setStrucppRuntimeForTests(null)
})

afterAll(() => {
  __setStrucppRuntimeForTests(null)
})

describe('program build against the real strucpp', () => {
  it('runs the strucpp version that binary-versions.json pins', () => {
    expect(loadStrucpp().getVersion()).toBe(pinnedStrucppVersion())
  })

  it.each([
    [
      'a method call through an interface variable holding a block that implements it',
      programSt(
        SCALER_DECLARATIONS,
        '    doubler : Doubler;\n    scaler : IScaler;\n    scaled : REAL;\n',
        '  scaler := doubler;\n  scaled := scaler.Scale(x := 1.5);\n',
      ),
    ],
    ['a STRING[n] variable', programSt('', "    label : STRING[16] := 'ready';\n", "  label := 'running';\n")],
    [
      'an enum conversion from an integer',
      programSt(MODE_DECLARATIONS, '    state : Mode;\n    code : INT := 1;\n', '  state := TO_Mode(code);\n'),
    ],
    [
      'REAL arithmetic',
      programSt('', '    level : REAL := 1.5;\n    scaled : REAL;\n', '  scaled := level * 2.0 + 0.25 / 4.0;\n'),
    ],
    [
      'an attribute pragma on a variable declaration',
      programSt('', "    {attribute 'hmi_main'}\n    level : REAL;\n", '  level := level + 1.0;\n'),
    ],
    ['an RTC instance set with SET and PDT', rtcCall('SET')],
  ])('compiles %s', (_feature, source) => {
    const result = build(source)

    expect(result.errors.map((error) => error.raw.message)).toEqual([])
    expect(result.success).toBe(true)
    expect(result.files.length).toBeGreaterThan(0)
  })

  it('rejects the removed RTC input IN', () => {
    const result = build(rtcCall('IN'))

    expect(result.success).toBe(false)
    expect(result.errors.some((error) => /\bIN\b/.test(error.raw.message))).toBe(true)
  })
})
