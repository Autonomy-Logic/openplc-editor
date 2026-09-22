/**
 * Platform globals jsdom does not ship, installed before anything else loads.
 *
 * These live in their own setup file, listed ahead of `jest-vi-shim`, because
 * ordering matters: ES imports are hoisted, so a polyfill written below an
 * `import` in the same file runs *after* that module has already been
 * evaluated. `jest-vi-shim` imports the store, the store reaches the STruC++
 * parser, and the parser touches `TextDecoder` at module load — so by the time
 * a polyfill further down that file ran, the failure had already happened.
 *
 * `TextEncoder`/`TextDecoder` and WebCrypto are APIs Node has had for years and
 * browsers provide as a matter of course. The project-snapshot archive is
 * written against them on purpose, so one implementation runs unchanged in the
 * Electron main process and in the browser; without these it would be
 * untestable here purely because of the environment.
 */

import { webcrypto } from 'node:crypto'
import { TextDecoder, TextEncoder } from 'node:util'

// Defined through `globalThis` directly rather than through a cast: the point
// is to install a global that is missing, and asserting a type over the global
// object hides the very absence being tested for.
if (typeof globalThis.TextEncoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, writable: true, configurable: true })
}
if (typeof globalThis.TextDecoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, writable: true, configurable: true })
}

if (typeof globalThis.crypto?.subtle === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true,
  })
}
