/** @jest-environment node */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { WasmCompileRequest } from '../../../../middleware/shared/ports/wasm-toolchain-types'
import { libraryArchiveName } from '../../../../middleware/shared/utils/hmi/widget-libraries'
import { runProgramBuildPipeline } from '../../library/program-build-pipeline'
import { loadStrucpp } from '../../library/strucpp-runtime'
import { compileToWasm } from '../../wasm-toolchain/compile-to-wasm'
import { FakeRunner } from '../../wasm-toolchain/__tests__/fixtures/fake-runner'
import { BoundedWasmObjectCache } from '../../wasm-toolchain/wasm-object-cache'
import { buildSimulatorWasmRequest, SIMULATOR_CXX_FLAGS } from '../steps/build-simulator-wasm-request'
import { buildCBlocksFromPous, composeFirmwareBundle } from '../steps/compose-firmware-bundle'
import { mergeStrucppRuntimeIntoSkeleton } from '../steps/merge-strucpp-runtime-into-skeleton'
import { SIMULATOR_LIBRARY_DIR, simulatorLibraryUnits } from '../steps/simulator-library-units'

/* The firmware sources: resources/sources in the editor, src/assets/firmware on the web. */
const SOURCES =
  ['resources/sources', 'src/assets/firmware'].map((dir) => join(process.cwd(), dir)).find((dir) => existsSync(dir)) ??
  'missing-firmware-sources'
const RUNTIME = join(process.cwd(), 'node_modules', 'strucpp', 'src', 'runtime', 'include')
const LIBRARY_DIRS = [
  join(process.cwd(), 'node_modules', 'strucpp', 'libs'),
  join(process.cwd(), 'vendor', 'hmi-widgets'),
]

function readTree(dir: string, prefix: string, recurse: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (recurse) Object.assign(out, readTree(join(dir, entry.name), `${prefix}/${entry.name}`, true))
    } else out[`${prefix}/${entry.name}`] = readFileSync(join(dir, entry.name), 'utf8')
  }
  return out
}

/** The simulator's firmware skeleton as the desktop reads it, with the STruC++ runtime headers under `src/`. */
const skeleton = (): Record<string, string> =>
  mergeStrucppRuntimeIntoSkeleton({
    firmwareSkeleton: {
      ...readTree(join(SOURCES, 'arduino'), 'src', false),
      ...readTree(join(SOURCES, 'Baremetal'), 'examples/Baremetal', false),
      ...readTree(join(SOURCES, 'wasm-sim'), 'wasm-sim', true),
    },
    strucppRuntimeHeaders: Object.fromEntries(
      readdirSync(RUNTIME)
        .filter((f) => f.endsWith('.hpp'))
        .map((f) => [`strucpp_runtime/include/${f}`, readFileSync(join(RUNTIME, f), 'utf8')]),
    ),
  })

const bundled = (): unknown[] =>
  LIBRARY_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.stlib'))
      .sort()
      .map((f): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'))),
  )

const program = (extra: string): string => `PROGRAM main
  VAR t : TON; c : CTU; x : BOOL; n : INT; r : REAL; END_VAR
  t(IN := x, PT := T#1s);
  c(CU := t.Q, PV := 10);
  n := MAX(n, 3) + LIMIT(0, n, 5);
  r := SQRT(ABS(r));${extra}
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : main;
  END_RESOURCE
END_CONFIGURATION
`

/** STruC++'s output of `source` by file name. */
function strucppFiles(source: string, separateLibraryFiles: boolean, libraries = bundled()): Record<string, string> {
  const built = runProgramBuildPipeline({
    source,
    md5: 'x',
    pous: [],
    libraries,
    missingLibraries: [],
    hasCBlocks: false,
    separateLibraryFiles,
  })
  if (!built.success) throw new Error(built.errors.map((e) => e.formatted).join('\n'))
  return Object.fromEntries(built.files.map((f) => [f.name, f.content]))
}

async function simulatorRequest(source: string, libraries = bundled()): Promise<WasmCompileRequest> {
  const firmware = composeFirmwareBundle({
    strucppFiles: strucppFiles(source, true, libraries),
    cBlocks: buildCBlocksFromPous([]),
    definesH: '#define SIMULATOR_MODE\n',
    programMd5H: '#pragma once\n#define PROGRAM_MD5 ""\n',
    firmwareSkeleton: skeleton(),
  })
  const split = await simulatorLibraryUnits(firmware, libraries, SIMULATOR_CXX_FLAGS)
  if (!split.ok) throw new Error(split.error)
  const built = buildSimulatorWasmRequest(split.value.files, split.value.units)
  if (!built.ok) throw new Error(built.error)
  return built.request
}

const INCLUDE = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/gm

/**
 * Every request file each unit reaches through `#include`, as clang would find them with the request's include paths
 * (conditionals ignored, so this is never fewer than clang reads), for a runner that lists them as dependencies.
 */
function includesOf(request: WasmCompileRequest): Record<string, string[]> {
  const flags = request.cxxFlags ?? []
  const dirs = flags.filter((f) => f.startsWith('-I')).map((f) => f.slice(2))
  const forced = flags.flatMap((f, i) => (flags[i - 1] === '-include' ? [f] : []))
  const text = (path: string): string | null => {
    const content = request.files[path]
    return typeof content === 'string' ? content : null
  }
  const resolve = (from: string, name: string, quoted: boolean): string | null => {
    const candidates = [...(quoted ? [join(dirname(from), name)] : []), ...dirs.map((d) => join(d, name))]
    return candidates.find((c) => text(c) !== null) ?? null
  }
  const out: Record<string, string[]> = {}
  for (const unit of request.units) {
    const seen = new Set<string>()
    const queue = [...forced.filter((f) => text(f) !== null), unit.source]
    while (queue.length > 0) {
      const path = queue.pop() ?? ''
      if (seen.has(path)) continue
      seen.add(path)
      for (const m of (text(path) ?? '').matchAll(INCLUDE)) {
        const found = resolve(path, m[2], m[1] === '"')
        if (found !== null && !seen.has(found)) queue.push(found)
      }
    }
    seen.delete(unit.source)
    out[unit.source] = [...seen].sort()
  }
  return out
}

/** The sources a build of `request` compiled, sorted, with `cache` kept across builds. */
async function compiledBy(request: WasmCompileRequest, cache: BoundedWasmObjectCache): Promise<string[]> {
  const runner = new FakeRunner(4, () => ({ exitCode: 0 }), null, includesOf(request))
  const result = await compileToWasm(request, { runner, cache })
  if (!result.ok) throw new Error(result.error)
  return runner.jobs
    .filter((j) => j.argv.includes('-c'))
    .map((j) => j.argv[j.argv.indexOf('-c') + 1])
    .sort()
}

describe('the simulator build with separate library files', () => {
  it('leaves every other build with the library code in its program files', () => {
    const files = strucppFiles(program(''), false)
    expect(Object.keys(files).some((name) => name.startsWith('lib_'))).toBe(false)
    expect(files).not.toHaveProperty(['generated_libraries.hpp'])
  })

  it('gets one lib_ file per reached library and the libraries header from STruC++', () => {
    const files = strucppFiles(program(''), true)
    expect(Object.keys(files).filter((name) => name.startsWith('lib_'))).toEqual(['lib_iec_standard_fb.cpp'])
    expect(files['generated_libraries.hpp']).toContain('iec_types.hpp')
  })

  it("compiles each reached library from its own whole unit, tagged, in place of the program's file", async () => {
    const request = await simulatorRequest(program(''))
    expect(Object.keys(request.files)).not.toContain('src/lib_iec_standard_fb.cpp')
    const library = request.units.filter((u) => u.source.startsWith(`${SIMULATOR_LIBRARY_DIR}/`))
    expect(library).toEqual([
      {
        source: 'simlib/iec_standard_fb/iec_standard_fb.cpp',
        language: 'c++',
        library: { name: 'iec-standard-fb', kind: 'simulator', key: expect.stringMatching(/^[0-9a-f]{64}$/) },
      },
    ])
    expect(request.files['simlib/iec_standard_fb/iec_standard_fb.cpp']).toContain('// Library: iec-standard-fb')
    expect(includesOf(request)['simlib/iec_standard_fb/iec_standard_fb.cpp']).not.toContain('src/generated.hpp')
  })

  it('gives every project the same library units', async () => {
    const plain = await simulatorRequest(program(''))
    const other = await simulatorRequest(program('\n  t(IN := NOT x, PT := T#2s);'))
    const libraryPart = (r: WasmCompileRequest) =>
      Object.fromEntries(Object.entries(r.files).filter(([path]) => path.startsWith(`${SIMULATOR_LIBRARY_DIR}/`)))
    expect(libraryPart(other)).toEqual(libraryPart(plain))
    expect(other.units.filter((u) => u.library)).toEqual(plain.units.filter((u) => u.library))
  })

  it('recompiles only the program units after a one-line program edit, no library unit', async () => {
    const cache = new BoundedWasmObjectCache(1024 * 1024 * 1024)
    const first = await compiledBy(await simulatorRequest(program('')), cache)
    expect(first).toContain('simlib/iec_standard_fb/iec_standard_fb.cpp')
    const generated = new Set(Object.keys(strucppFiles(program('\n  n := n + 1;'), true)).map((name) => `src/${name}`))
    const again = await compiledBy(await simulatorRequest(program('\n  n := n + 1;')), cache)
    expect(again.length).toBeGreaterThan(0)
    expect(again.filter((source) => !generated.has(source))).toEqual([])
    expect(again.filter((source) => source.startsWith(`${SIMULATOR_LIBRARY_DIR}/`))).toEqual([])
  })

  it('shares a user library and the libraries it depends on, each once', async () => {
    const strucpp = loadStrucpp()
    const libraries = bundled()
    const standard = libraries.find((a) => libraryArchiveName(a) === 'iec-standard-fb')
    const user = strucpp.compileStlib(
      [
        {
          fileName: 'delay.st',
          source: `FUNCTION_BLOCK Delay
  VAR_INPUT IN : BOOL; END_VAR
  VAR_OUTPUT Q : BOOL; END_VAR
  VAR t : TON; END_VAR
  t(IN := IN, PT := T#1s);
  Q := t.Q;
END_FUNCTION_BLOCK
`,
        },
      ],
      {
        name: 'user-delay',
        version: '1.0.0',
        namespace: 'user_delay',
        dependencies: standard === undefined ? [] : [strucpp.loadStlibFromString(JSON.stringify(standard), 'std')],
      },
    )
    if (user.errors.length > 0) throw new Error(user.errors.map((e) => e.message).join('\n'))
    const all = [...libraries, JSON.parse(JSON.stringify(user.archive))]
    const source = program('')
      .replace('x : BOOL;', 'x : BOOL; d : Delay;')
      .replace('  t(IN := x', '  d(IN := x);\n  t(IN := x')
    const request = await simulatorRequest(source, all)
    expect(request.units.flatMap((u) => (u.library ? [u.library.name] : []))).toEqual(['iec-standard-fb', 'user-delay'])
    expect(Object.keys(request.files).filter((p) => /^src\/lib_/.test(p))).toEqual([])
  })

  it('keeps a library that has no archive among the build libraries in the program files', async () => {
    const firmware = composeFirmwareBundle({
      strucppFiles: strucppFiles(program(''), true),
      cBlocks: buildCBlocksFromPous([]),
      definesH: '',
      programMd5H: '',
      firmwareSkeleton: skeleton(),
    })
    const split = await simulatorLibraryUnits(firmware, [], SIMULATOR_CXX_FLAGS)
    if (!split.ok) throw new Error(split.error)
    expect(split.value.units).toEqual([])
    expect(split.value.files['src/lib_iec_standard_fb.cpp']).toContain('// Library: iec-standard-fb')
  })
})
