import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { patchYowaspLoader } from '../src/backend/shared/wasm-toolchain/yowasp-loader-patch'

/** The repository root: package scripts run from it. */
const ROOT = process.cwd()
const SOURCE_DIR = path.join(ROOT, 'node_modules', '@yowasp', 'clang')
const PREPARED_DIR = path.join(ROOT, 'release', 'yowasp-clang')

/** Every file under `dir`, relative to `base`, with `/` separators. */
function listFiles(dir: string, base: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return listFiles(full, base)
      return entry.isFile() ? [path.relative(base, full).split(path.sep).join('/')] : []
    })
    .sort()
}

/**
 * Writes the prepared copy of `@yowasp/clang` to `release/yowasp-clang/` from scratch: `package.json`, `README.md`
 * and every file under `gen/` byte for byte, but `gen/bundle.js`, written with the loader patch applied. The desktop
 * and the CLI load clang from this copy in development, and the packaged app ships it. `node_modules` is only read.
 * Usage, from the repository root: `ts-node scripts/prepare-yowasp-clang.ts`.
 * @throws {Error} the patch's message when the patch does not apply; the script then exits with code 1
 */
function prepare(): void {
  const patchedBundle = patchYowaspLoader(readFileSync(path.join(SOURCE_DIR, 'gen', 'bundle.js'), 'utf8'))
  const files = ['package.json', 'README.md', ...listFiles(path.join(SOURCE_DIR, 'gen'), SOURCE_DIR)]

  rmSync(PREPARED_DIR, { recursive: true, force: true })
  for (const file of files) {
    const target = path.join(PREPARED_DIR, file)
    mkdirSync(path.dirname(target), { recursive: true })
    if (file === 'gen/bundle.js') writeFileSync(target, patchedBundle)
    else copyFileSync(path.join(SOURCE_DIR, file), target)
  }
  console.log(`prepare-yowasp-clang: wrote ${files.length} files to ${PREPARED_DIR}`)
}

try {
  prepare()
} catch (error) {
  console.error(`prepare-yowasp-clang: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
