import type { PlatformLog } from '@root/middleware/shared/ports/compiler-platform-port'
import type { WasmClangRunner, WasmObjectStore } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmCompileRequest, WasmCompileResult } from '@root/middleware/shared/ports/wasm-toolchain-types'

import { compileToWasm, type WasmObjectCache } from './compile-to-wasm'
import { parseWasmCompileRequest } from './parse-wasm-compile-request'
import { PersistentWasmObjectCache } from './persistent-object-cache'
import { prepareWasmToolchain, type WasmToolchainReadiness } from './prepare-toolchain'
import { WASM_TOOLCHAIN_IDENTITY } from './toolchain-identity'
import { BoundedWasmObjectCache } from './wasm-object-cache'

/** Compiled objects kept for the session, across every caller of the service. */
export const WASM_OBJECT_CACHE_BYTES = 256 * 1024 * 1024
/** Compiled objects kept across sessions in the platform's store. */
export const WASM_STORED_OBJECT_BYTES = 192 * 1024 * 1024

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
   * Holds the toolchain for `holder` (an open HMI editor) on behalf of `owner` (a page), or lets it go. While anyone
   * holds it the workers stay loaded between builds and may grow past one; once nobody does and no build runs, they end.
   */
  setHeld(holder: string, held: boolean, owner?: string): Promise<void>
  /** Lets go every hold `owner` took, as when its page reloads or closes without letting go. */
  releaseOwner(owner: string): Promise<void>
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
 * runner is released. With a store, objects also outlive the session: the cache is filled from the store when the
 * toolchain is prepared or a build starts, whichever comes first, and builds wait for it.
 */
export function createWasmCompileService(
  runner: WasmClangRunner,
  store?: WasmObjectStore,
  log?: PlatformLog,
  identity: string = WASM_TOOLCHAIN_IDENTITY,
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
  const holderKey = (holder: string, owner: string | undefined): string =>
    owner === undefined ? `\u0001${holder}` : `${owner}\u0000${holder}`

  const restore = (): Promise<void> => {
    if (!persistent) return Promise.resolve()
    restored ??= persistent
      .load(identity)
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
      if (inFlight === 0) {
        if (holders.size === 0) await runner.release()
        else runner.retry?.()
      }
    }
  }

  const prepare = (): Promise<WasmToolchainReadiness> => {
    void restore()
    readiness ??= prepareWasmToolchain(runner).then((result) => {
      if (!result.ok) readiness = null
      return result
    })
    return readiness
  }

  const holdersChanged = async (): Promise<void> => {
    runner.setHeld?.(holders.size > 0)
    if (holders.size === 0 && inFlight === 0) await runner.release()
  }

  const setHeld = (holder: string, held: boolean, owner?: string): Promise<void> => {
    const key = holderKey(holder, owner)
    if (held) holders.add(key)
    else holders.delete(key)
    return holdersChanged()
  }

  const releaseOwner = (owner: string): Promise<void> => {
    const prefix = `${owner}\u0000`
    for (const key of [...holders]) if (key.startsWith(prefix)) holders.delete(key)
    return holdersChanged()
  }

  return {
    prepare,
    setHeld,
    releaseOwner,
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
