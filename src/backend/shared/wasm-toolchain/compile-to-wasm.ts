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
import { filesToTree, isFileBytes, readTreeFile } from './file-tree'

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

/** Compiled objects of a session, keyed by everything that decides their content. A `Map` qualifies. */
export interface WasmObjectCache {
  get(key: string): Uint8Array | undefined
  set(key: string, object: Uint8Array): unknown
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
  const seen = new Set<string>()
  for (const { source } of request.units) {
    if (seen.has(source)) return `Translation unit '${source}' is listed more than once.`
    seen.add(source)
    if (request.files[source] === undefined) return `Translation unit '${source}' is not among the input files.`
  }
  return null
}

function planUnits(request: WasmCompileRequest): PlannedUnit[] {
  const unitSources = new Set(request.units.map((u) => u.source))
  // Every non-unit input can be included by any unit, so all of them go into every key.
  const inputs = new ContentHash()
  for (const path of Object.keys(request.files).sort()) {
    if (unitSources.has(path)) continue
    inputs.update(path).update(request.files[path])
  }
  const inputsDigest = inputs.digest()

  return request.units.map((unit, index) => {
    const object = `__objects/${index}.o`
    const argv = [
      unit.language === 'c' ? 'clang' : 'clang++',
      `--target=${WASM_TARGET}`,
      ...(unit.language === 'c' ? (request.cFlags ?? []) : (request.cxxFlags ?? [])),
      ...(unit.flags ?? []),
      '-c',
      unit.source,
      '-o',
      object,
    ]
    const key = new ContentHash()
      .update(argv.filter((a) => a !== object).join('\u0000'))
      .update(unit.source)
      .update(request.files[unit.source])
      .update(inputsDigest)
      .digest()
    return { unit, argv, object, key, size: sizeOf(request.files[unit.source]) }
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
    return { exitCode: -1, stderr: error instanceof Error ? error.message : String(error), tree: {} }
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

/**
 * Compiles C and C++ translation units to objects with clang running as WebAssembly, then links them into one
 * WebAssembly module. Objects of unchanged units come from `cache`. Diagnostics go to `log`.
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
  const objects = new Map<string, Uint8Array>()
  const failures: string[] = []

  const pending: PlannedUnit[] = []
  for (const p of planned) {
    const hit = cache?.get(p.key)
    if (hit) {
      objects.set(p.object, hit)
      stats.cached++
    } else {
      pending.push(p)
    }
  }
  // Largest units first, so the slowest one does not start last.
  pending.sort((x, y) => y.size - x.size)

  await runLimited(pending, runner.concurrency, async (p) => {
    const result = await runSafely(runner, { argv: p.argv, tree })
    const object = result.exitCode === 0 ? readTreeFile(result.tree, p.object) : undefined
    if (isFileBytes(object)) {
      objects.set(p.object, object)
      cache?.set(p.key, object)
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
      output,
    ],
    tree: filesToTree(linkFiles),
  })
  stats.linkMs = performance.now() - linkStart

  const wasm = link.exitCode === 0 ? readTreeFile(link.tree, output) : undefined
  if (!isFileBytes(wasm)) {
    reportStderr(report, link.stderr, 'error')
    return fail(`Link failed: ${describeFailure(link.exitCode, `no '${output}'`)}`)
  }
  reportStderr(report, link.stderr, 'warning')
  return { ok: true, wasm, stats, diagnostics }
}
