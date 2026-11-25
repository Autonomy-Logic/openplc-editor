/**
 * Desktop store of the WebAssembly toolchain's compiled objects: one file per record in a folder of the user's data,
 * written and read back verbatim. Keys are the toolchain's hex digests; anything else is refused as a path.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { WasmObjectStore } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

const SUFFIX = '.obj'
const KEY = /^[0-9a-f]{1,64}$/i

function fileOf(dir: string, key: string): string {
  if (!KEY.test(key)) throw new Error(`'${key}' is not a stored object key`)
  return join(dir, `${key}${SUFFIX}`)
}

export function createDesktopObjectStore(dir: string): WasmObjectStore {
  return {
    async readAll() {
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        return []
      }
      const records: Array<[string, Uint8Array]> = []
      for (const name of names) {
        const key = name.slice(0, -SUFFIX.length)
        if (!name.endsWith(SUFFIX) || !KEY.test(key)) continue
        records.push([key, new Uint8Array(await readFile(join(dir, name)))])
      }
      return records
    },
    async write(key, record) {
      const file = fileOf(dir, key)
      await mkdir(dir, { recursive: true })
      await writeFile(file, record)
    },
    async remove(key) {
      await rm(fileOf(dir, key), { force: true })
    },
  }
}
