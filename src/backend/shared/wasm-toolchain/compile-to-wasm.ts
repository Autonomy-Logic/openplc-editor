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
  WasmUnitLanguage,
} from '@root/middleware/shared/ports/wasm-toolchain-types'

import { WasmToolchainLoadError } from './clang-worker-pool'
import { digestParts, sha256Hex } from './content-digest'
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

/**
 * A compiled object, the SHA-256 of every request file it was built from, and what could make one of its includes
 * resolve elsewhere: the file names of all its dependencies (toolchain headers too) and a digest of the request paths
 * carrying those names when it was built. `digest` covers its key and all of these, so it names this object's content.
 */
export interface CachedWasmObject {
  object: Uint8Array
  digest: string
  dependencies: Array<[path: string, digest: string]>
  includeNames: string[]
  shadowDigest: string
}

/**
 * Compiled objects keyed by unit and flags, several per key: one per set of file contents it was built from. An entry
 * is valid while its dependencies are unchanged. A linked module is kept under the key of its whole request.
 */
export interface WasmObjectCache {
  /** Every kept object of `key`, most recently used first. */
  variants(key: string): readonly CachedWasmObject[]
  set(key: string, entry: CachedWasmObject): unknown
  /** Marks the object with this digest as just used. */
  touch?(digest: string): void
}

export interface WasmCompileOptions {
  runner: WasmClangRunner
  cache?: WasmObjectCache
  log?: PlatformLog
  /** Called with each unit's object the build uses, from the cache or compiled, with its cache key. */
  onObject?: (unit: WasmCompileUnit, key: string, entry: CachedWasmObject) => void
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

const compilerOf = (language: WasmUnitLanguage): string => (language === 'c' ? 'clang' : 'clang++')

const flagsOf = (
  request: WasmCompileRequest,
  language: WasmUnitLanguage,
  own: string[] | undefined,
  ownOnly = false,
): string[] => [
  `--target=${WASM_TARGET}`,
  ...(ownOnly ? [] : language === 'c' ? (request.cFlags ?? []) : (request.cxxFlags ?? [])),
  ...(own ?? []),
]

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** SHA-256 of every request file, by path. */
async function digestFiles(files: WasmToolchainFiles): Promise<Map<string, string>> {
  const entries = Object.entries(files).flatMap(([path, content]) => (content === undefined ? [] : [{ path, content }]))
  const digests = await Promise.all(entries.map(({ content }) => sha256Hex(content)))
  return new Map(entries.map(({ path }, index) => [path, digests[index]]))
}

/**
 * Digest of the request paths whose file name is among `names`. Adding or removing a file can change which header an
 * include finds only when it carries the name of one of the object's dependencies, so this digest is what a cached
 * object must still match.
 */
function shadowDigests(files: WasmToolchainFiles): (names: readonly string[]) => Promise<string> {
  const byName = new Map<string, string[]>()
  for (const path of Object.keys(files).sort()) {
    const name = baseName(path)
    byName.set(name, [...(byName.get(name) ?? []), path])
  }
  const memo = new Map<string, Promise<string>>()
  return (names) => {
    const paths = names.flatMap((n) => byName.get(n) ?? [])
    const id = paths.join('\u0000')
    let digest = memo.get(id)
    if (digest === undefined) {
      digest = digestParts(['shadow', ...paths])
      memo.set(id, digest)
    }
    return digest
  }
}

/** Plans one compile job per unit. A unit's cache key covers the compiler, its flags and its source path. */
async function planUnits(request: WasmCompileRequest): Promise<PlannedUnit[]> {
  return Promise.all(
    request.units.map(async (unit, index) => {
      const object = `${WORK_DIR}/${index}.o`
      const dependencyFile = `${WORK_DIR}/${index}.d`
      const flags = flagsOf(request, unit.language, unit.flags, unit.ownFlags === true)
      const compiler = compilerOf(unit.language)
      const argv = [compiler, ...flags, '-MD', '-MF', dependencyFile, '-c', unit.source, '-o', object]
      const key = await digestParts(['unit', compiler, String(flags.length), ...flags, unit.source])
      return { unit, argv, object, dependencyFile, key, size: sizeOf(request.files[unit.source]) }
    }),
  )
}

const describeFailure = (exitCode: number, missing: string): string =>
  exitCode === 0
    ? `clang reported success but produced ${missing}.`
    : exitCode < 0
      ? 'clang could not be run.'
      : `clang exited with code ${exitCode}.`

/**
 * A runner that could not run the job counts as a failed job, with the reason as its stderr. A toolchain that could
 * not be loaded is returned as its error instead, since it fails the whole build.
 */
async function runSafely(
  runner: WasmClangRunner,
  job: WasmClangJob,
): Promise<WasmClangJobResult | WasmToolchainLoadError> {
  try {
    return await runner.run(job)
  } catch (error) {
    if (error instanceof WasmToolchainLoadError) return error
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

/** The precompiled headers a compile job's argv names with `-include-pch <path>`. */
function precompiledHeadersOf(argv: readonly string[]): string[] {
  return argv.flatMap((arg, index) => (arg === '-include-pch' && index + 1 < argv.length ? [argv[index + 1]] : []))
}

/**
 * The request files an object was built from, with their digests, and the file names of every dependency; `null`
 * when clang's list cannot be read or names a relative path that is not a request file. An absolute path naming a
 * request file once its leading `/` is dropped, as clang lists headers read through a precompiled header, is that
 * request file; other absolute paths are toolchain headers with no digest, but a request file of the same name could
 * hide them. Each `-include-pch` file is a dependency too, since clang does not list it.
 */
function dependenciesOf(
  result: WasmClangJobResult,
  plan: PlannedUnit,
  digestOf: (path: string) => string | undefined,
): Pick<CachedWasmObject, 'dependencies' | 'includeNames'> | null {
  const raw = readTreeFile(result.tree, plan.dependencyFile)
  if (raw === undefined) return null
  const paths = parseDependencyFile(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
  if (paths === null || !paths.includes(plan.unit.source)) return null
  const dependencies = new Map<string, string>()
  const includeNames = new Set<string>()
  for (const path of new Set([...paths, ...precompiledHeadersOf(plan.argv)])) {
    includeNames.add(baseName(path))
    const requestPath = path.startsWith('/') ? path.slice(1) : path
    const digest = digestOf(requestPath)
    if (digest === undefined) {
      if (path.startsWith('/')) continue
      return null
    }
    dependencies.set(requestPath, digest)
  }
  return { dependencies: [...dependencies], includeNames: [...includeNames].sort() }
}

interface CompileContext {
  runner: WasmClangRunner
  cache: WasmObjectCache | undefined
  digestOf: (path: string) => string | undefined
  shadowOf: (names: readonly string[]) => Promise<string>
  objects: Map<string, Uint8Array>
  failures: string[]
  /** A toolchain that could not be loaded; once one is recorded no further job starts. */
  loadFailures: WasmToolchainLoadError[]
  report: Report
  stats: WasmCompileStats
  /** Each job's timing by its planned object path. */
  onObject: WasmCompileOptions['onObject']
}

/**
 * A digest of everything an object was built from: its cache key, the digest of every request file it read and the
 * request paths that could have shadowed them. Equal inputs build the same object, so this stands for its bytes
 * without reading them.
 */
export const objectDigest = (
  key: string,
  entry: Pick<CachedWasmObject, 'dependencies' | 'shadowDigest'>,
): Promise<string> =>
  digestParts(['object', key, ...entry.dependencies.flatMap(([path, digest]) => [path, digest]), entry.shadowDigest])

/** The kept object of `key` built from the request's current files, if any. */
async function validVariant(
  cache: WasmObjectCache | undefined,
  key: string,
  ctx: Pick<CompileContext, 'digestOf' | 'shadowOf'>,
): Promise<CachedWasmObject | undefined> {
  for (const variant of cache?.variants(key) ?? []) {
    if (!variant.dependencies.every(([path, digest]) => ctx.digestOf(path) === digest)) continue
    if ((await ctx.shadowOf(variant.includeNames)) !== variant.shadowDigest) continue
    cache?.touch?.(variant.digest)
    return variant
  }
  return undefined
}

/**
 * Takes each job's output from the cache while its dependencies are unchanged and no file that could hide one of them
 * was added or removed, and compiles the rest, largest first.
 */
async function compileJobs(jobs: PlannedUnit[], tree: ReturnType<typeof filesToTree>, ctx: CompileContext) {
  const { runner, cache, digestOf, shadowOf, objects, failures, loadFailures, report, stats, onObject } = ctx
  const pending: PlannedUnit[] = []
  for (const p of jobs) {
    const hit = await validVariant(cache, p.key, ctx)
    if (hit) {
      objects.set(p.object, hit.object)
      onObject?.(p.unit, p.key, hit)
      stats.cached++
    } else {
      pending.push(p)
    }
  }
  pending.sort((x, y) => y.size - x.size)
  await runLimited(pending, runner.concurrency, async (p) => {
    if (loadFailures.length > 0) return
    const result = await runSafely(runner, { argv: p.argv, tree })
    if (result instanceof WasmToolchainLoadError) {
      loadFailures.push(result)
      return
    }
    const object = result.exitCode === 0 ? readTreeFile(result.tree, p.object) : undefined
    if (isFileBytes(object)) {
      objects.set(p.object, object)
      const built = dependenciesOf(result, p, digestOf)
      if (built) {
        const shadowDigest = await shadowOf(built.includeNames)
        const digest = await objectDigest(p.key, { ...built, shadowDigest })
        const entry: CachedWasmObject = { object, digest, ...built, shadowDigest }
        cache?.set(p.key, entry)
        onObject?.(p.unit, p.key, entry)
      }
      reportStderr(report, result.stderr, 'warning')
      return
    }
    reportStderr(report, result.stderr, 'error')
    failures.push(`${p.unit.source}: ${describeFailure(result.exitCode, 'no object')}`)
  })
}

/**
 * Key of the module a request links: the digest of every input file, every unit with its flags, the request's flags and
 * its output. Equal keys link the same module.
 */
async function moduleKey(request: WasmCompileRequest, digests: Map<string, string>): Promise<string> {
  const files = [...digests.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).flat()
  const layout = JSON.stringify([
    request.units,
    request.cFlags ?? [],
    request.cxxFlags ?? [],
    request.linkFlags ?? [],
    request.output ?? DEFAULT_WASM_OUTPUT,
  ])
  return digestParts(['module', layout, ...files])
}

/**
 * Compiles C and C++ translation units to objects with clang running as WebAssembly, then links them into one
 * WebAssembly module. A request equal to one already linked returns the kept module. An object comes from `cache`
 * while every file it was built from is unchanged. Units are compiled largest first. A toolchain that cannot be
 * loaded fails the build with its own message, and nothing is linked. Diagnostics go to `log` and to the result.
 */
export async function compileToWasm(
  request: WasmCompileRequest,
  options: WasmCompileOptions,
): Promise<WasmCompileResult> {
  const { runner, cache, log, onObject } = options
  const stats: WasmCompileStats = {
    units: request.units.length,
    cached: 0,
  }
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

  const digests = await digestFiles(request.files)
  const linkKey = cache ? await moduleKey(request, digests) : ''
  const linked = cache?.variants(linkKey)[0]
  if (linked) {
    cache?.touch?.(linked.digest)
    stats.cached = stats.units
    return { ok: true, wasm: linked.object, stats, diagnostics }
  }
  const digestOf = (path: string): string | undefined => digests.get(path)
  const shadowOf = shadowDigests(request.files)
  const objects = new Map<string, Uint8Array>()
  const failures: string[] = []
  const loadFailures: WasmToolchainLoadError[] = []
  const build = (jobs: PlannedUnit[], tree: ReturnType<typeof filesToTree>): Promise<void> =>
    compileJobs(jobs, tree, {
      runner,
      cache,
      digestOf,
      shadowOf,
      objects,
      failures,
      loadFailures,
      report,
      stats,
      onObject,
    })

  const planned = await planUnits(request)
  await build(planned, filesToTree(request.files))

  const total = planned.length
  if (loadFailures.length > 0) return fail(loadFailures[0].message)
  if (failures.length > 0) {
    return fail(`Compilation failed in ${failures.length} of ${total} file(s): ${failures.join(' ')}`)
  }

  const output = request.output ?? DEFAULT_WASM_OUTPUT
  const linkFiles: WasmToolchainFiles = { ...request.files }
  for (const p of planned) {
    const object = objects.get(p.object)
    if (object) linkFiles[p.object] = object
  }
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
  if (link instanceof WasmToolchainLoadError) return fail(link.message)

  const wasm = link.exitCode === 0 ? readTreeFile(link.tree, LINK_OUTPUT) : undefined
  if (!isFileBytes(wasm)) {
    reportStderr(report, link.stderr, 'error')
    return fail(`Link failed: ${describeFailure(link.exitCode, `no '${output}'`)}`)
  }
  reportStderr(report, link.stderr, 'warning')
  cache?.set(linkKey, { object: wasm, digest: linkKey, dependencies: [], includeNames: [], shadowDigest: '' })
  return { ok: true, wasm, stats, diagnostics }
}
