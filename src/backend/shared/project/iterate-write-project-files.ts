/**
 * Single source of truth for the file shape a project ships with.
 *
 * `WriteProjectFiles` carries a flat collection of pre-serialized
 * file contents the renderer wants to persist.  Each platform
 * adapter (editor → filesystem, web → Edge API envelope) has to
 * translate that collection into its storage layout.  Both used to
 * enumerate the file categories by hand, which drifted: when
 * `libraryManifest` was added to the WriteProjectFiles shape, the
 * editor's filesystem writer was updated but the web's envelope
 * packer wasn't — silently dropping `library.json` on save and
 * surfacing as "library.json not found" at compile time.
 *
 * This module is the one place that knows "what relative paths /
 * categories live in a WriteProjectFiles".  Adapter sides iterate
 * this generator and dispatch on `category`; adding a new file
 * category means updating this file once.
 */

import type { WriteProjectFiles } from '../../../middleware/shared/ports/project-port'

/**
 * One file in a WriteProjectFiles.  `relativePath` is always the
 * project-root-relative path (matches the on-disk shape on the
 * editor side and the canonical contract for web envelope packing).
 * `category` lets adapters dispatch when the destination shape
 * needs category awareness — the web's envelope nests pous under
 * `apiFiles.pous[subcategory][filename]`, for instance.
 */
export type WriteProjectFileEntry =
  | { category: 'project-json'; relativePath: 'project.json'; content: string }
  | { category: 'device-config'; relativePath: 'devices/configuration.json'; content: string }
  | { category: 'pin-mapping'; relativePath: 'devices/pin-mapping.json'; content: string }
  | { category: 'library-manifest'; relativePath: 'library.json'; content: string }
  | { category: 'pou'; relativePath: string; content: string }
  | { category: 'server'; relativePath: string; content: string }
  | { category: 'remote-device'; relativePath: string; content: string }

/**
 * Yield every file in a WriteProjectFiles as a `WriteProjectFileEntry`.
 *
 * Order is stable but not semantically significant — adapters are
 * free to fan out writes in parallel.  Optional top-level files
 * (`deviceConfig`, `pinMapping`, `libraryManifest`) are skipped
 * when `undefined`, matching the "renderer didn't touch it, leave
 * the on-disk copy alone" contract documented on the port shape.
 */
export function* iterateWriteProjectFiles(files: WriteProjectFiles): Generator<WriteProjectFileEntry> {
  yield { category: 'project-json', relativePath: 'project.json', content: files.projectJson }

  if (files.deviceConfig !== undefined) {
    yield { category: 'device-config', relativePath: 'devices/configuration.json', content: files.deviceConfig }
  }
  if (files.pinMapping !== undefined) {
    yield { category: 'pin-mapping', relativePath: 'devices/pin-mapping.json', content: files.pinMapping }
  }
  if (files.libraryManifest !== undefined) {
    yield { category: 'library-manifest', relativePath: 'library.json', content: files.libraryManifest }
  }

  for (const f of files.pouFiles) {
    yield { category: 'pou', relativePath: f.relativePath, content: f.content }
  }
  for (const f of files.serverFiles) {
    yield { category: 'server', relativePath: f.relativePath, content: f.content }
  }
  for (const f of files.remoteDeviceFiles) {
    yield { category: 'remote-device', relativePath: f.relativePath, content: f.content }
  }
}
