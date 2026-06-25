// Alias `vi` to `jest` so shared test files can use `vi.spyOn()` in both Jest and Vitest
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).vi = jest

// Radix UI primitives (DropdownMenu, Select, …) rely on Pointer Capture and
// scrollIntoView, which jsdom doesn't implement — without these, the menus
// never open in tests. Polyfill as no-ops so combobox/dropdown components are
// exercisable. (Editor-private setup; the web Vitest run has its own mirror.)
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}
// Radix ScrollArea (inside the combobox menu) instantiates a ResizeObserver,
// which jsdom doesn't provide. A no-op stub is enough for tests.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom 24+ ships `structuredClone` on the window, but the jest
// jsdom environment we ship doesn't expose it on the test global
// scope.  Production code that runs through this shim (e.g.
// `frontend/utils/cpp/addCppLocalVariables` cloning the project
// before mutating) calls `structuredClone` directly.  Polyfill via
// the Node global so tests don't crash on the missing symbol.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).structuredClone !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { structuredClone: nodeClone } = require('node:util') as { structuredClone?: <T>(v: T) => T }
  if (nodeClone) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).structuredClone = nodeClone
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).structuredClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  }
}

/*
 * Pre-populate the system-library Zustand slice with the bundled .stlib
 * archives so helpers that look up FBs by name (`pou-helpers`,
 * `debug-tree-traversal`) find them in tests just like they do at
 * runtime. The production wiring loads these via IPC at app startup;
 * tests run in a node environment with no IPC bridge, so we read the
 * same files directly from the workspace.
 *
 * Cheap to do unconditionally: 4 .stlib JSONs total, parsed once per
 * test process — Jest reuses the setup across every spec file.
 */
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { openPLCStoreBase } from './frontend/store'
import { stlibsToSystemLibraries } from './frontend/utils/stlib-to-system-library'

// Bundled stlibs live inside the strucpp npm package — see
// `library-manager-module.resolveDefaultBundledDir`.  Reading them
// from there at jest setup matches the runtime path so helpers like
// `pou-helpers` and `debug-tree-traversal` see the same library set
// the editor renders.
const stlibsDir = join(process.cwd(), 'node_modules', 'strucpp', 'libs')
try {
  const archives = readdirSync(stlibsDir)
    .filter((f) => f.endsWith('.stlib'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(stlibsDir, f), 'utf-8')))
  openPLCStoreBase.getState().libraryActions.setSystemLibraries(stlibsToSystemLibraries(archives))
} catch (err) {
  console.warn(`[jest-setup] could not pre-load bundled .stlibs from ${stlibsDir}:`, err)
}
