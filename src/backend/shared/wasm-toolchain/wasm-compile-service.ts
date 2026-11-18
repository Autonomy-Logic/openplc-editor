import type { PlatformLog } from '@root/middleware/shared/ports/compiler-platform-port'
import type { WasmClangRunner, WasmObjectStore } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmCompileRequest, WasmCompileResult } from '@root/middleware/shared/ports/wasm-toolchain-types'

import { compileToWasm, type WasmObjectCache } from './compile-to-wasm'
import { ContentHash } from './content-hash'
import { parseWasmCompileRequest } from './parse-wasm-compile-request'
import { PersistentWasmObjectCache } from './persistent-object-cache'
import { prepareWasmToolchain, type WasmToolchainReadiness } from './prepare-toolchain'
import { BoundedWasmObjectCache } from './wasm-object-cache'

/** Compiled objects kept for the session, across every caller of the service. */
export const WASM_OBJECT_CACHE_BYTES = 256 * 1024 * 1024
/** Compiled objects kept across sessions in the platform's store. */
export const WASM_STORED_OBJECT_BYTES = 192 * 1024 * 1024

/** Identity of the toolchain a runner loaded: a digest of what `clang --version` prints. */
async function toolchainIdentity(runner: WasmClangRunner): Promise<string> {
  const probe = await runner.run({ argv: ['clang', '--version'], tree: {} })
  if (probe.exitCode !== 0) throw new Error(`clang --version exited with code ${probe.exitCode}`)
  return new ContentHash().update(probe.stdout).digest()
}

export interface WasmCompileService {
  /**
   * Gets the toolchain's files ready, starting no worker. A success is kept and later calls return it; a failure is
   * not, so the next call tries again.
   */
  prepare(): Promise<WasmToolchainReadiness>
  /** Compiles a request; once no other build is running, it resolves only after the clang worker has ended. */
  compile(request: WasmCompileRequest, log?: PlatformLog): Promise<WasmCompileResult>
  /** Checks a request that crossed a process or worker boundary, then compiles it as `compile` does. */
  compileRequest(value: unknown, log?: PlatformLog): Promise<WasmCompileResult>
  /**
   * Holds the toolchain for `holder` (an open HMI editor), or lets it go. While anyone holds it the workers stay
   * loaded between builds and may grow past one; once nobody does and no build runs, they end.
   */
  setHeld(holder: string, held: boolean): Promise<void>
}

const rejected = (error: string): WasmCompileResult => ({
  ok: false,
  error,
  stats: { units: 0, cached: 0, compileMs: 0, linkMs: 0 },
  diagnostics: [{ message: error, level: 'error' }],
})

/**
 * The toolchain a platform exposes: one runner, one session cache that outlives its workers, one readiness. Builds in
 * flight share the runner's workers; when the last one ends, whatever its outcome, and nobody holds the toolchain, the
 * runner is released. With a store, objects also outlive the session: the first build fills the cache from the store
 * before it compiles.
 */
export function createWasmCompileService(
  runner: WasmClangRunner,
  store?: WasmObjectStore,
  log?: PlatformLog,
): WasmCompileService {
  const memory = new BoundedWasmObjectCache(WASM_OBJECT_CACHE_BYTES)
  const persistent = store
    ? new PersistentWasmObjectCache(memory, store, WASM_STORED_OBJECT_BYTES, (message) =>
        log?.(`Compiled objects could not be stored: ${message}`, 'warning'),
      )
    : null
  const cache: WasmObjectCache = persistent ?? memory
  let readiness: Promise<WasmToolchainReadiness> | null = null
  let restored: Promise<void> | null = null
  let inFlight = 0
  const holders = new Set<string>()

  const restore = (): Promise<void> => {
    if (!persistent) return Promise.resolve()
    restored ??= toolchainIdentity(runner)
      .then((identity) => persistent.load(identity))
      .catch((error: unknown) =>
        log?.(
          `Compiled objects of earlier sessions could not be read: ${error instanceof Error ? error.message : String(error)}`,
          'warning',
        ),
      )
    return restored
  }

  const build = async (work: () => Promise<WasmCompileResult>): Promise<WasmCompileResult> => {
    inFlight++
    try {
      await restore()
      return await work()
    } finally {
      inFlight--
      if (inFlight === 0 && holders.size === 0) await runner.release()
    }
  }

  const prepare = (): Promise<WasmToolchainReadiness> => {
    readiness ??= prepareWasmToolchain(runner).then((result) => {
      if (!result.ok) readiness = null
      return result
    })
    return readiness
  }

  const setHeld = async (holder: string, held: boolean): Promise<void> => {
    if (held) holders.add(holder)
    else holders.delete(holder)
    runner.setHeld?.(holders.size > 0)
    if (holders.size === 0 && inFlight === 0) await runner.release()
  }

  return {
    prepare,
    setHeld,
    compile: (request, compileLog) => build(() => compileToWasm(request, { runner, cache, log: compileLog })),
    compileRequest: (value, compileLog) =>
      build(() => {
        const parsed = parseWasmCompileRequest(value)
        return parsed.ok
          ? compileToWasm(parsed.request, { runner, cache, log: compileLog })
          : Promise.resolve(rejected(parsed.error))
      }),
  }
}
