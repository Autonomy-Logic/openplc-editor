/**
 * Desktop source of the compiled objects shipped with the editor: files of one folder of the installation, read
 * verbatim. Only the names the shared toolchain asks for are read, and a file that is a link or leads out of the
 * folder is refused, so nothing outside the application's own files is ever read.
 */
import { lstat, readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { isShippedObjectName } from '@root/backend/shared/wasm-toolchain/shipped-objects'
import type { WasmShippedObjectSource } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

/** The folder of the shipped objects: an extra resource of a packaged app, the repository's build output otherwise. */
export function shippedObjectsDir(location: { isPackaged: boolean; resourcesPath: string; cwd: string }): string {
  return location.isPackaged
    ? join(location.resourcesPath, 'hmi-objects')
    : join(location.cwd, 'release', 'hmi-objects')
}

export function createDesktopShippedObjects(dir: string): WasmShippedObjectSource {
  return {
    async read(name) {
      if (!isShippedObjectName(name)) return null
      const file = join(dir, name)
      try {
        if (!(await lstat(file)).isFile()) return null
        const [folder, real] = await Promise.all([realpath(dir), realpath(file)])
        if (!real.startsWith(`${folder}${sep}`)) return null
        return new Uint8Array(await readFile(real))
      } catch {
        return null
      }
    },
  }
}
