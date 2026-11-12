import {
  createWasmCompileService,
  type WasmCompileService,
} from '@root/backend/shared/wasm-toolchain/wasm-compile-service'
import { app } from 'electron'

import { resolveWasmToolchainPaths } from './toolchain-paths'
import { WorkerClangRunner } from './worker-clang-runner'

let service: WasmCompileService | null = null

/** The process's one WebAssembly toolchain, created on first use. */
export function getDesktopWasmCompileService(): WasmCompileService {
  service ??= createWasmCompileService(
    new WorkerClangRunner(
      resolveWasmToolchainPaths({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        cwd: process.cwd(),
        mainDir: __dirname,
      }),
    ),
  )
  return service
}
