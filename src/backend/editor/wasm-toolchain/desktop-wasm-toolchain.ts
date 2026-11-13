import { join } from 'node:path'

import {
  createWasmCompileService,
  type WasmCompileService,
} from '@root/backend/shared/wasm-toolchain/wasm-compile-service'
import { app } from 'electron'

import { logger } from '../services'
import { createDesktopObjectStore } from './desktop-object-store'
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
    createDesktopObjectStore(join(app.getPath('userData'), 'User', 'WasmObjects')),
    (message, level) => (level === 'error' ? logger.error(message) : logger.warn(message)),
  )
  return service
}
