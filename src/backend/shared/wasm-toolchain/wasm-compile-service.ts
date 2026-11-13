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

/**
 * The toolchain a platform exposes: one runner, one session cache, one readiness. With a store, objects also outlive
 * the session: once the toolchain is ready the cache is filled from the store, and compiles wait for that.
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
  let restored: Promise<void> = Promise.resolve()
  const prepare = (): Promise<WasmToolchainReadiness> => {
    readiness ??= prepareWasmToolchain(runner).then((ready) => {
      if (ready.ok && persistent) {
        restored = toolchainIdentity(runner)
          .then((identity) => persistent.load(identity))
          .catch((error: unknown) =>
            log?.(
              `Compiled objects of earlier sessions could not be read: ${error instanceof Error ? error.message : String(error)}`,
              'warning',
            ),
          )
      }
      return ready
    })
    return readiness
  }
  const compile = async (request: WasmCompileRequest, compileLog?: PlatformLog): Promise<WasmCompileResult> => {
    await restored
    return compileToWasm(request, { runner, cache, log: compileLog })
  }
  return {
    prepare,
    compile,
    compileRequest: (value, log) => {
      const parsed = parseWasmCompileRequest(value)
      return parsed.ok ? compile(parsed.request, log) : Promise.resolve(rejected(parsed.error))
    },
  }
}
