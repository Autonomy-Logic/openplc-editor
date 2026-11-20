import { join } from 'node:path'

import {
  createWasmCompileService,
  type WasmCompileService,
} from '@root/backend/shared/wasm-toolchain/wasm-compile-service'
import type { WasmLibraryObjectStore } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'
import { app } from 'electron'

import { LibraryManagerModule } from '../library-manager/library-manager-module'
import { logger } from '../services'
import { createDesktopObjectStore } from './desktop-object-store'
import { createDesktopShippedObjects, shippedObjectsDir } from './desktop-shipped-objects'
import { resolveWasmToolchainPaths } from './toolchain-paths'
import { WorkerClangRunner } from './worker-clang-runner'

let service: WasmCompileService | null = null

/** Library objects as files next to each user-installed library's archive, through the library manager. */
function libraryObjectFiles(): WasmLibraryObjectStore {
  const manager = new LibraryManagerModule()
  return {
    read: (library, kind) => Promise.resolve(manager.readLibraryObject(library, kind)),
    write: (library, kind, bytes) => Promise.resolve(manager.writeLibraryObject(library, kind, bytes)),
  }
}

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
    {
      store: createDesktopObjectStore(join(app.getPath('userData'), 'User', 'WasmObjects')),
      shipped: createDesktopShippedObjects(
        shippedObjectsDir({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, cwd: process.cwd() }),
      ),
      libraryObjects: libraryObjectFiles(),
      log: (message, level) => (level === 'error' ? logger.error(message) : logger.warn(message)),
    },
  )
  return service
}
