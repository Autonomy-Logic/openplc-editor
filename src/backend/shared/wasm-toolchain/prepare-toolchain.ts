import type { WasmClangRunner } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import { wasmToolchainLoadMessage } from './clang-worker-pool'

export type WasmToolchainReadiness = { ok: true; ms: number } | { ok: false; message: string }

/**
 * Gets the toolchain's files ready at editor start, starting no worker and compiling nothing. A failure carries the
 * message the startup screen shows.
 */
export async function prepareWasmToolchain(runner: WasmClangRunner): Promise<WasmToolchainReadiness> {
  const start = performance.now()
  try {
    await runner.prepare()
    return { ok: true, ms: performance.now() - start }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, message: wasmToolchainLoadMessage(reason) }
  }
}
