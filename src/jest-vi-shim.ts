// Alias `vi` to `jest` so shared test files can use `vi.spyOn()` in both Jest and Vitest
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).vi = jest

/*
 * Pre-populate the system-library Zustand slice with the bundled .stlib
 * archives so helpers that look up FBs by name (`pou-helpers`,
 * `debug-tree-traversal`, `fb.completion`) find them in tests just like
 * they do at runtime. The production wiring loads these via IPC at app
 * startup; tests run in a node environment with no IPC bridge, so we
 * read the same files directly from the workspace.
 *
 * Cheap to do unconditionally: 4 .stlib JSONs total, parsed once per
 * test process — Jest reuses the setup across every spec file.
 */
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { openPLCStoreBase } from './frontend/store'
import { stlibsToSystemLibraries } from './frontend/utils/stlib-to-system-library'

const stlibsDir = join(process.cwd(), 'resources', 'strucpp', 'libs')
try {
  const archives = readdirSync(stlibsDir)
    .filter((f) => f.endsWith('.stlib'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(stlibsDir, f), 'utf-8')))
  openPLCStoreBase.getState().libraryActions.setSystemLibraries(stlibsToSystemLibraries(archives))
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`[jest-setup] could not pre-load bundled .stlibs from ${stlibsDir}:`, err)
}
