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
  WasmPrecompiledHeader,
  WasmToolchainFiles,
  WasmUnitLanguage,
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
  WasmPrecompiledHeader,
  WasmUnitLanguage,
} from '@root/middleware/shared/ports/wasm-toolchain-types'

export const WASM_TARGET = 'wasm32-wasip1'
export const DEFAULT_WASM_OUTPUT = 'module.wasm'
/** Where the compile step writes objects, dependency files and the linked module; request files may not use it. */
const WORK_DIR = '__objects'
/** The link always writes here, a directory that exists, whatever the request names its module. */
const LINK_OUTPUT = `${WORK_DIR}/module.wasm`

/**
 * A compiled object, the content digest of every request file it was built from, and what could make one of its
 * includes resolve elsewhere: the file names of all its dependencies (toolchain headers too) and a digest of the
 * request paths carrying those names when it was built.
 */
export interface CachedWasmObject {
  object: Uint8Array
  dependencies: Array<[path: string, digest: string]>
  includeNames: string[]
  shadowDigest: string
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

function validateHeaders(request: WasmCompileRequest): string | null {
  const headers = new Set<string>()
  for (const { header } of request.precompiledHeaders ?? []) {
    if (headers.has(header)) return `Precompiled header '${header}' is listed more than once.`
    headers.add(header)
    if (request.files[header] === undefined) return `Precompiled header '${header}' is not among the input files.`
  }
  for (const { source, pch } of request.units) {
    if (pch !== undefined && !headers.has(pch))
      return `Unit '${source}' names '${pch}', which is not a precompiled header.`
  }
  return null
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
  const headerProblem = validateHeaders(request)
  if (headerProblem !== null) return headerProblem
  const output = request.output ?? DEFAULT_WASM_OUTPUT
  const outputProblem = toolchainPathProblem(output)
  if (outputProblem !== null) return outputProblem
  if (output === WORK_DIR || output.startsWith(`${WORK_DIR}/`))
    return `Output path '${output}' is reserved for the compiler.`
  return null
}

/** A built precompiled header: where units find it, and the digest of its bytes. */
interface BuiltHeader {
  path: string
  digest: string
}

const compilerOf = (language: WasmUnitLanguage): string => (language === 'c' ? 'clang' : 'clang++')

const flagsOf = (request: WasmCompileRequest, language: WasmUnitLanguage, own: string[] | undefined): string[] => [
  `--target=${WASM_TARGET}`,
  ...(language === 'c' ? (request.cFlags ?? []) : (request.cxxFlags ?? [])),
  ...(own ?? []),
]

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/**
 * Digest of the request paths whose file name is among `names`. Adding or removing a file can change which header an
 * include finds only when it carries the name of one of the object's dependencies, so this digest is what a cached
 * object must still match.
 */
function shadowDigests(files: WasmToolchainFiles): (names: readonly string[]) => string {
  const byName = new Map<string, string[]>()
  for (const path of Object.keys(files).sort()) {
    const name = baseName(path)
    byName.set(name, [...(byName.get(name) ?? []), path])
  }
  return (names) => new ContentHash().update(names.flatMap((n) => byName.get(n) ?? []).join('\u0000')).digest()
}

/** Plans one job per precompiled header, keyed like a unit. */
function planHeaders(request: WasmCompileRequest): PlannedUnit[] {
  return (request.precompiledHeaders ?? []).map((header: WasmPrecompiledHeader, index) => {
    const object = `${WORK_DIR}/${index}.pch`
    const dependencyFile = `${WORK_DIR}/${index}.pch.d`
    const flags = flagsOf(request, header.language, header.flags)
    const compiler = compilerOf(header.language)
    const kind = header.language === 'c' ? 'c-header' : 'c++-header'
    const argv = [compiler, ...flags, '-x', kind, header.header, '-MD', '-MF', dependencyFile, '-o', object]
    const key = new ContentHash()
      .update(compiler)
      .update(kind)
      .update(flags.join('\u0000'))
      .update(header.header)
      .digest()
    const unit: WasmCompileUnit = { source: header.header, language: header.language }
    return { unit, argv, object, dependencyFile, key, size: sizeOf(request.files[header.header]) }
  })
}

/**
 * Plans one compile job per unit. A unit's cache key covers the compiler, its flags, its source path and the digest of
 * the precompiled header it includes.
 */
function planUnits(request: WasmCompileRequest, headers: Map<string, BuiltHeader>): PlannedUnit[] {
  return request.units.map((unit, index) => {
    const object = `${WORK_DIR}/${index}.o`
    const dependencyFile = `${WORK_DIR}/${index}.d`
    const flags = flagsOf(request, unit.language, unit.flags)
    const compiler = compilerOf(unit.language)
    const header = unit.pch === undefined ? undefined : headers.get(unit.pch)
    const include = header ? ['-include-pch', header.path] : []
    const argv = [compiler, ...flags, ...include, '-MD', '-MF', dependencyFile, '-c', unit.source, '-o', object]
    const key = new ContentHash()
      .update(compiler)
      .update(flags.join('\u0000'))
      .update(unit.source)
      .update(header?.digest ?? '')
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
 * The request files an object was built from, with their digests, and the file names of every dependency; `null`
 * when clang's list cannot be read or names a relative path that is not a request file. Absolute paths are toolchain
 * headers: they have no digest, but a request file of the same name could hide them.
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
  const dependencies: Array<[string, string]> = []
  const includeNames = new Set<string>()
  for (const path of new Set(paths)) {
    includeNames.add(baseName(path))
    if (path.startsWith('/')) continue
    const digest = digestOf(path)
    if (digest === undefined) return null
    dependencies.push([path, digest])
  }
  return { dependencies, includeNames: [...includeNames].sort() }
}

interface CompileContext {
  runner: WasmClangRunner
  cache: WasmObjectCache | undefined
  digestOf: (path: string) => string | undefined
  shadowOf: (names: readonly string[]) => string
  objects: Map<string, Uint8Array>
  failures: string[]
  report: Report
  stats: WasmCompileStats
}

/**
 * Takes each job's output from the cache while its dependencies are unchanged and no file that could hide one of them
 * was added or removed, and compiles the rest, largest first.
 */
async function compileJobs(jobs: PlannedUnit[], tree: ReturnType<typeof filesToTree>, ctx: CompileContext) {
  const { runner, cache, digestOf, shadowOf, objects, failures, report, stats } = ctx
  const pending: PlannedUnit[] = []
  for (const p of jobs) {
    const hit = cache?.get(p.key)
    if (
      hit &&
      hit.dependencies.every(([path, digest]) => digestOf(path) === digest) &&
      shadowOf(hit.includeNames) === hit.shadowDigest
    ) {
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
      const built = dependenciesOf(result, p, digestOf)
      if (built) cache?.set(p.key, { object, ...built, shadowDigest: shadowOf(built.includeNames) })
      reportStderr(report, result.stderr, 'warning')
      return
    }
    reportStderr(report, result.stderr, 'error')
    failures.push(`${p.unit.source}: ${describeFailure(result.exitCode, 'no object')}`)
  })
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
  const stats: WasmCompileStats = {
    units: request.units.length + (request.precompiledHeaders?.length ?? 0),
    cached: 0,
    compileMs: 0,
    linkMs: 0,
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

  const compileStart = performance.now()
  const digestOf = digestsOf(request.files)
  const shadowOf = shadowDigests(request.files)
  const objects = new Map<string, Uint8Array>()
  const failures: string[] = []
  const build = (jobs: PlannedUnit[], tree: ReturnType<typeof filesToTree>): Promise<void> =>
    compileJobs(jobs, tree, { runner, cache, digestOf, shadowOf, objects, failures, report, stats })

  const headerJobs = planHeaders(request)
  const unitFiles: WasmToolchainFiles = { ...request.files }
  const headers = new Map<string, BuiltHeader>()
  if (headerJobs.length > 0) {
    await build(headerJobs, filesToTree(request.files))
    for (const job of headerJobs) {
      const bytes = objects.get(job.object)
      if (!bytes) continue
      unitFiles[job.object] = bytes
      headers.set(job.unit.source, { path: job.object, digest: new ContentHash().update(bytes).digest() })
    }
  }
  const planned = planUnits(request, headers)
  if (failures.length === 0) await build(planned, filesToTree(unitFiles))
  stats.compileMs = performance.now() - compileStart

  const total = headerJobs.length + planned.length
  if (failures.length > 0) {
    return fail(`Compilation failed in ${failures.length} of ${total} file(s): ${failures.join(' ')}`)
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
