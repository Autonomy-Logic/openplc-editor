import type { PlatformLog } from '@root/middleware/shared/ports/compiler-platform-port'
import type { WasmClangRunner } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmCompileRequest, WasmCompileResult } from '@root/middleware/shared/ports/wasm-toolchain-types'

import { compileToWasm } from './compile-to-wasm'
import { parseWasmCompileRequest } from './parse-wasm-compile-request'
import { prepareWasmToolchain, type WasmToolchainReadiness } from './prepare-toolchain'
import { BoundedWasmObjectCache } from './wasm-object-cache'

/** Compiled objects kept for the session, across every caller of the service. */
export const WASM_OBJECT_CACHE_BYTES = 256 * 1024 * 1024

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
}

const rejected = (error: string): WasmCompileResult => ({
  ok: false,
  error,
  stats: { units: 0, cached: 0, compileMs: 0, linkMs: 0 },
  diagnostics: [{ message: error, level: 'error' }],
})

/**
 * The toolchain a platform exposes: one runner, one session cache that outlives its workers, one readiness. Builds in
 * flight share the runner's worker; when the last one ends, whatever its outcome, the runner is released.
 */
export function createWasmCompileService(runner: WasmClangRunner): WasmCompileService {
  const cache = new BoundedWasmObjectCache(WASM_OBJECT_CACHE_BYTES)
  let readiness: Promise<WasmToolchainReadiness> | null = null
  let inFlight = 0

  const build = async (work: () => Promise<WasmCompileResult>): Promise<WasmCompileResult> => {
    inFlight++
    try {
      return await work()
    } finally {
      inFlight--
      if (inFlight === 0) await runner.release()
    }
  }

  const prepare = (): Promise<WasmToolchainReadiness> => {
    readiness ??= prepareWasmToolchain(runner).then((result) => {
      if (!result.ok) readiness = null
      return result
    })
    return readiness
  }

  return {
    prepare,
    compile: (request, log) => build(() => compileToWasm(request, { runner, cache, log })),
    compileRequest: (value, log) =>
      build(() => {
        const parsed = parseWasmCompileRequest(value)
        return parsed.ok
          ? compileToWasm(parsed.request, { runner, cache, log })
          : Promise.resolve(rejected(parsed.error))
      }),
  }
}
