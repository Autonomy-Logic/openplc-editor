import type { PlatformLog } from '@root/middleware/shared/ports/compiler-platform-port'
import type {
  WasmClangJob,
  WasmClangJobResult,
  WasmClangRunner,
} from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'
import type {
  WasmCompileRequest,
  WasmCompileResult,
  WasmCompileStats,
  WasmCompileUnit,
  WasmDiagnostic,
  WasmToolchainFiles,
} from '@root/middleware/shared/ports/wasm-toolchain-types'

import { ContentHash } from './content-hash'
import { parseDependencyFile } from './dependency-file'
import { filesToTree, filesTreeProblem, isFileBytes, readTreeFile, toolchainPathProblem } from './file-tree'

export type {
  WasmCompileRequest,
  WasmCompileResult,
  WasmCompileStats,
  WasmCompileUnit,
  WasmDiagnostic,
  WasmUnitLanguage,
} from '@root/middleware/shared/ports/wasm-toolchain-types'

export const WASM_TARGET = 'wasm32-wasip1'
export const DEFAULT_WASM_OUTPUT = 'module.wasm'
/** Where the compile step writes objects, dependency files and the linked module; request files may not use it. */
const WORK_DIR = '__objects'
/** The link always writes here, a directory that exists, whatever the request names its module. */
const LINK_OUTPUT = `${WORK_DIR}/module.wasm`

/** A compiled object and the content digest of every request file it was built from. */
export interface CachedWasmObject {
  object: Uint8Array
  dependencies: Array<[path: string, digest: string]>
}

/** Compiled objects of a session, keyed by unit and flags; an entry is valid while its dependencies are unchanged. */
export interface WasmObjectCache {
  get(key: string): CachedWasmObject | undefined
  set(key: string, entry: CachedWasmObject): unknown
}

export interface WasmCompileOptions {
  runner: WasmClangRunner
  cache?: WasmObjectCache
  log?: PlatformLog
}

interface PlannedUnit {
  unit: WasmCompileUnit
  argv: string[]
  object: string
  dependencyFile: string
  key: string
  size: number
}

const sizeOf = (content: string | Uint8Array | undefined): number => content?.length ?? 0

type Report = (message: string, level: WasmDiagnostic['level']) => void

const reportStderr = (report: Report, stderr: string, level: WasmDiagnostic['level']): void => {
  for (const line of stderr.split('\n')) if (line.trim() !== '') report(line, level)
}

function validate(request: WasmCompileRequest): string | null {
  if (request.units.length === 0) return 'Nothing to compile: no translation units were given.'
  for (const path of Object.keys(request.files)) {
    if (path === WORK_DIR || path.startsWith(`${WORK_DIR}/`)) return `File path '${path}' is reserved for the compiler.`
  }
  const treeProblem = filesTreeProblem(request.files)
  if (treeProblem !== null) return treeProblem
  const seen = new Set<string>()
  for (const { source } of request.units) {
    if (seen.has(source)) return `Translation unit '${source}' is listed more than once.`
    seen.add(source)
    if (request.files[source] === undefined) return `Translation unit '${source}' is not among the input files.`
  }
  const output = request.output ?? DEFAULT_WASM_OUTPUT
  const outputProblem = toolchainPathProblem(output)
  if (outputProblem !== null) return outputProblem
  if (output === WORK_DIR || output.startsWith(`${WORK_DIR}/`))
    return `Output path '${output}' is reserved for the compiler.`
  return null
}

/**
 * Plans one compile job per unit. A unit's cache key covers the compiler, its flags, its source path and the set of
 * request file names, since adding or removing a file can change which header an include finds.
 */
function planUnits(request: WasmCompileRequest): PlannedUnit[] {
  const names = new ContentHash().update(Object.keys(request.files).sort().join('\u0000')).digest()
  return request.units.map((unit, index) => {
    const object = `${WORK_DIR}/${index}.o`
    const dependencyFile = `${WORK_DIR}/${index}.d`
    const flags = [
      `--target=${WASM_TARGET}`,
      ...(unit.language === 'c' ? (request.cFlags ?? []) : (request.cxxFlags ?? [])),
      ...(unit.flags ?? []),
    ]
    const compiler = unit.language === 'c' ? 'clang' : 'clang++'
    const argv = [compiler, ...flags, '-MD', '-MF', dependencyFile, '-c', unit.source, '-o', object]
    const key = new ContentHash()
      .update(compiler)
      .update(flags.join('\u0000'))
      .update(unit.source)
      .update(names)
      .digest()
    return { unit, argv, object, dependencyFile, key, size: sizeOf(request.files[unit.source]) }
  })
}

const describeFailure = (exitCode: number, missing: string): string =>
  exitCode === 0
    ? `clang reported success but produced ${missing}.`
    : exitCode < 0
      ? 'clang could not be run.'
      : `clang exited with code ${exitCode}.`

/** A runner that could not run the job counts as a failed job, with the reason as its stderr. */
async function runSafely(runner: WasmClangRunner, job: WasmClangJob): Promise<WasmClangJobResult> {
  try {
    return await runner.run(job)
  } catch (error) {
    return { exitCode: -1, stderr: error instanceof Error ? error.message : String(error), stdout: '', tree: {} }
  }
}

async function runLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await work(item)
    }
  })
  await Promise.all(lanes)
}

/** Content digests of request files, each computed at most once per build and only when needed. */
function digestsOf(files: WasmToolchainFiles): (path: string) => string | undefined {
  const digests = new Map<string, string>()
  return (path) => {
    const content = files[path]
    if (content === undefined) return undefined
    let digest = digests.get(path)
    if (digest === undefined) {
      digest = new ContentHash().update(content).digest()
      digests.set(path, digest)
    }
    return digest
  }
}

/**
 * The request files an object was built from, with their digests; `null` when clang's list cannot be read or names
 * a relative path that is not a request file. Absolute paths are toolchain headers and are left out.
 */
function dependenciesOf(
  result: WasmClangJobResult,
  plan: PlannedUnit,
  digestOf: (path: string) => string | undefined,
): Array<[string, string]> | null {
  const raw = readTreeFile(result.tree, plan.dependencyFile)
  if (raw === undefined) return null
  const paths = parseDependencyFile(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
  if (paths === null || !paths.includes(plan.unit.source)) return null
  const dependencies: Array<[string, string]> = []
  for (const path of new Set(paths)) {
    if (path.startsWith('/')) continue
    const digest = digestOf(path)
    if (digest === undefined) return null
    dependencies.push([path, digest])
  }
  return dependencies
}

/**
 * Compiles C and C++ translation units to objects with clang running as WebAssembly, then links them into one
 * WebAssembly module. An object comes from `cache` while every file it was built from is unchanged. Units are
 * compiled largest first.
 * Diagnostics go to `log` and to the result.
 */
export async function compileToWasm(
  request: WasmCompileRequest,
  options: WasmCompileOptions,
): Promise<WasmCompileResult> {
  const { runner, cache, log } = options
  const stats: WasmCompileStats = { units: request.units.length, cached: 0, compileMs: 0, linkMs: 0 }
  const diagnostics: WasmDiagnostic[] = []
  const report: Report = (message, level) => {
    diagnostics.push({ message, level })
    log?.(message, level)
  }
  const fail = (error: string): WasmCompileResult => {
    report(error, 'error')
    return { ok: false, error, stats, diagnostics }
  }
  const invalid = validate(request)
  if (invalid) return fail(invalid)

  const compileStart = performance.now()
  const tree = filesToTree(request.files)
  const planned = planUnits(request)
  const digestOf = digestsOf(request.files)
  const objects = new Map<string, Uint8Array>()
  const failures: string[] = []

  const pending: PlannedUnit[] = []
  for (const p of planned) {
    const hit = cache?.get(p.key)
    if (hit && hit.dependencies.every(([path, digest]) => digestOf(path) === digest)) {
      objects.set(p.object, hit.object)
      stats.cached++
    } else {
      pending.push(p)
    }
  }
  pending.sort((x, y) => y.size - x.size)

  await runLimited(pending, runner.concurrency, async (p) => {
    const result = await runSafely(runner, { argv: p.argv, tree })
    const object = result.exitCode === 0 ? readTreeFile(result.tree, p.object) : undefined
    if (isFileBytes(object)) {
      objects.set(p.object, object)
      const dependencies = dependenciesOf(result, p, digestOf)
      if (dependencies) cache?.set(p.key, { object, dependencies })
      reportStderr(report, result.stderr, 'warning')
      return
    }
    reportStderr(report, result.stderr, 'error')
    failures.push(`${p.unit.source}: ${describeFailure(result.exitCode, 'no object')}`)
  })
  stats.compileMs = performance.now() - compileStart

  if (failures.length > 0) {
    return fail(`Compilation failed in ${failures.length} of ${planned.length} file(s): ${failures.join(' ')}`)
  }

  const output = request.output ?? DEFAULT_WASM_OUTPUT
  const linkFiles: WasmToolchainFiles = { ...request.files }
  for (const p of planned) {
    const object = objects.get(p.object)
    if (object) linkFiles[p.object] = object
  }
  const linkStart = performance.now()
  const link = await runSafely(runner, {
    argv: [
      'clang++',
      `--target=${WASM_TARGET}`,
      ...planned.map((p) => p.object),
      ...(request.linkFlags ?? []),
      '-o',
      LINK_OUTPUT,
    ],
    tree: filesToTree(linkFiles),
  })
  stats.linkMs = performance.now() - linkStart

  const wasm = link.exitCode === 0 ? readTreeFile(link.tree, LINK_OUTPUT) : undefined
  if (!isFileBytes(wasm)) {
    reportStderr(report, link.stderr, 'error')
    return fail(`Link failed: ${describeFailure(link.exitCode, `no '${output}'`)}`)
  }
  reportStderr(report, link.stderr, 'warning')
  return { ok: true, wasm, stats, diagnostics }
}
