/**
 * `libraryBuildFromTranspiledSt` against the REAL strucpp.
 *
 * The rest of `build-pipeline.test.ts` stubs `compileStlib` so the pipeline's
 * own decisions can be asserted in isolation. That is the right default, but it
 * cannot check the premise the design rests on: that strucpp accepts an
 * ST-empty input set when native sources are present, and marks those blocks
 * `implementation` in the manifest. Asserted against a stub, that premise is
 * just a restatement of the stub.
 *
 * Requires the pinned strucpp (>= 0.6.4) in `node_modules`.
 */

import { libraryBuildFromTranspiledSt } from '../build-pipeline'
import { __setStrucppRuntimeForTests } from '../strucpp-runtime'

const manifest = { name: 'real_lib', version: '1.0.0', namespace: 'real_lib', extra: {} }

const STUB_PROGRAM = 'PROGRAM main\n  VAR LocalVar : INT; END_VAR\n  LocalVar := 3;\nEND_PROGRAM\n'

const CPP_FILE = `(* Scales an INT *)
FUNCTION_BLOCK CPP_SCALE
VAR_INPUT
  RAW : INT;
  GAIN : INT;
END_VAR
VAR_OUTPUT
  SCALED : INT;
END_VAR
void setup() {}
void loop() { SCALED = RAW * GAIN; }
END_FUNCTION_BLOCK
`

const PY_FILE = `FUNCTION_BLOCK PY_OFFSET
VAR_INPUT
  IN_VAL : INT;
  OFFSET : INT;
END_VAR
VAR_OUTPUT
  OUT_VAL : INT;
END_VAR
def block_loop():
    global OUT_VAL
    OUT_VAL = IN_VAL + OFFSET
END_FUNCTION_BLOCK
`

type Archive = {
  formatVersion?: number
  chunks?: Array<{ name: string }>
  sources?: Array<{ fileName: string; source: string }>
  manifest: { functionBlocks: Array<{ name: string; implementation?: string; sourceFile?: string }> }
}

beforeAll(() => {
  // Explicitly the real runtime — no stub installed.
  __setStrucppRuntimeForTests(null)
})

afterAll(() => {
  __setStrucppRuntimeForTests(null)
})

describe('libraryBuildFromTranspiledSt against the real strucpp', () => {
  const build = (nativeSources: Array<{ fileName: string; source: string }>, extraSt = '') => {
    const knownPous = [
      ...(extraSt ? [{ name: 'PlainSt', kind: 'FUNCTION_BLOCK' as const }] : []),
      { name: 'main', kind: 'PROGRAM' as const },
    ]
    return libraryBuildFromTranspiledSt(`${extraSt}${STUB_PROGRAM}`, knownPous, manifest, { nativeSources })
  }

  it('builds an all-native library — strucpp tolerates an empty ST input set', () => {
    const res = build([
      { fileName: 'CPP_SCALE.cpp', source: CPP_FILE },
      { fileName: 'PY_OFFSET.py', source: PY_FILE },
    ])

    expect(res.errors).toEqual([])
    expect(res.success).toBe(true)

    const archive = res.archive as Archive
    expect(archive.formatVersion).toBe(1)
    // Nothing was compiled, so no chunk was emitted for either block.
    expect(archive.chunks).toEqual([])
    expect(archive.manifest.functionBlocks.map((fb) => `${fb.name}:${fb.implementation}`).sort()).toEqual([
      'CPP_SCALE:cpp',
      'PY_OFFSET:python',
    ])
  })

  it('carries the authored files byte for byte, not the generated bridge ST', () => {
    const res = build([
      { fileName: 'CPP_SCALE.cpp', source: CPP_FILE },
      { fileName: 'PY_OFFSET.py', source: PY_FILE },
    ])
    const archive = res.archive as Archive

    expect((archive.sources ?? []).map((s) => s.fileName).sort()).toEqual(['CPP_SCALE.cpp', 'PY_OFFSET.py'])
    expect(archive.sources?.find((s) => s.fileName === 'PY_OFFSET.py')?.source).toBe(PY_FILE)
    expect(archive.sources?.find((s) => s.fileName === 'CPP_SCALE.cpp')?.source).toBe(CPP_FILE)
    // A `.st` entry here would mean a lowered bridge shipped instead.
    expect((archive.sources ?? []).some((s) => s.fileName.endsWith('.st'))).toBe(false)
  })

  it('builds an all-Python library (AC3)', () => {
    const res = build([{ fileName: 'PY_OFFSET.py', source: PY_FILE }])

    expect(res.success).toBe(true)
    const archive = res.archive as Archive
    expect(archive.chunks).toEqual([])
    expect(archive.manifest.functionBlocks).toHaveLength(1)
    expect(archive.manifest.functionBlocks[0]).toMatchObject({
      name: 'PY_OFFSET',
      implementation: 'python',
      sourceFile: 'PY_OFFSET.py',
    })
  })

  it('compiles ST alongside native blocks, chunking only the ST', () => {
    const plainSt =
      'FUNCTION_BLOCK PlainSt\n  VAR_INPUT a : INT; END_VAR\n  VAR_OUTPUT q : INT; END_VAR\n  q := a;\nEND_FUNCTION_BLOCK\n\n'
    const res = build([{ fileName: 'CPP_SCALE.cpp', source: CPP_FILE }], plainSt)

    expect(res.success).toBe(true)
    const archive = res.archive as Archive
    expect(archive.chunks?.map((c) => c.name)).toEqual(['PLAINST'])

    const byName = new Map(archive.manifest.functionBlocks.map((fb) => [fb.name, fb]))
    expect(byName.get('PLAINST')?.implementation).toBeUndefined()
    expect(byName.get('CPP_SCALE')?.implementation).toBe('cpp')
  })

  it('rejects a native block declared as a FUNCTION', () => {
    const res = build([
      {
        fileName: 'BAD.cpp',
        source: 'FUNCTION BAD : INT\nVAR_INPUT A : INT; END_VAR\nint f() { return 0; }\nEND_FUNCTION\n',
      },
    ])

    expect(res.success).toBe(false)
    expect(res.errors[0]?.message).toContain('FUNCTION_BLOCK')
  })

  // Duplicate names are strucpp's to reject and its own suite covers them.
  // Not asserted from here: the native-block filter drops the same-named
  // per-POU `.st` before `compileStlib` sees it, so the collision never
  // reaches strucpp on this path — and a project cannot hold an ST POU and a
  // native POU under one name anyway.
})
