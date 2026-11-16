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
  /** Loads the toolchain. Called once at editor start; later calls return the same readiness. */
  prepare(): Promise<WasmToolchainReadiness>
  compile(request: WasmCompileRequest, log?: PlatformLog): Promise<WasmCompileResult>
  /** Checks a request that crossed a process or worker boundary, then compiles it. */
  compileRequest(value: unknown, log?: PlatformLog): Promise<WasmCompileResult>
}

const rejected = (error: string): WasmCompileResult => ({
  ok: false,
  error,
  stats: { units: 0, cached: 0, compileMs: 0, linkMs: 0 },
  diagnostics: [{ message: error, level: 'error' }],
})

/** The toolchain a platform exposes: one runner, one session cache, one readiness. */
export function createWasmCompileService(runner: WasmClangRunner): WasmCompileService {
  const cache = new BoundedWasmObjectCache(WASM_OBJECT_CACHE_BYTES)
  let readiness: Promise<WasmToolchainReadiness> | null = null
  const compile = (request: WasmCompileRequest, log?: PlatformLog): Promise<WasmCompileResult> =>
    compileToWasm(request, { runner, cache, log })
  return {
    prepare: () => (readiness ??= prepareWasmToolchain(runner)),
    compile,
    compileRequest: (value, log) => {
      const parsed = parseWasmCompileRequest(value)
      return parsed.ok ? compile(parsed.request, log) : Promise.resolve(rejected(parsed.error))
    },
  }
}
