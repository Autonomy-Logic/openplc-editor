// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * StlibSourcePort — read .stlib archive contents.
 *
 * The renderer hosts the STruC++ language server inside a Web
 * Worker.  That worker needs every .stlib archive (bundled system
 * libraries + user-installed libraries) as raw text so it can parse
 * with `loadStlibFromString`.  How those bytes arrive differs by
 * platform:
 *
 *   - Electron: archives sit at `resources/strucpp/libs/*.stlib`
 *     plus the per-project user-library directories.  Reading is a
 *     short IPC round-trip to the main process.
 *
 *   - Web: archives live behind an HTTP endpoint served by the
 *     orchestrator backend.  Reading is `fetch(...).then(r =>
 *     r.text())`.
 *
 * Both implementations expose the same contract.  The port returns
 * UTF-8 JSON text rather than `Uint8Array` so the protocol stays
 * trivially serialisable across both transports without binary
 * encoding gymnastics; the worker side parses with the pure
 * `loadStlibFromString` exported by the strucpp package.
 */

/**
 * Descriptor for one .stlib archive available to the LSP worker.
 *
 * `sourceLabel` is an opaque, platform-specific handle the host
 * uses to fetch the bytes — a file path in Electron, a URL in web.
 * It also rides on diagnostic messages emitted by the worker so
 * library-resolution errors point at the right source.
 */
export interface StlibSource {
  /** Library name (matches `archive.manifest.name`). */
  name: string
  /** Library version (matches `archive.manifest.version`). */
  version: string
  /**
   * Opaque platform handle used as the input to `readStlib`.  Treat
   * this as a string the host owns — callers do not interpret it.
   */
  sourceLabel: string
}

export interface StlibSourcePort {
  /**
   * Enumerate every .stlib the LSP worker should ingest at startup,
   * plus any user-added libraries currently installed in the
   * project.  Implementations must return the bundled system
   * libraries first so the worker's symbol cache fills in a
   * predictable order; user libraries follow.  Returning an empty
   * list is valid (the worker will simply have no library symbols).
   */
  listStlibs(): Promise<StlibSource[]>

  /**
   * Read the raw UTF-8 JSON text of an .stlib archive.  Throws
   * (rejects) when the source is unreadable — the worker catches
   * the rejection per-archive so a single bad library doesn't
   * starve the rest.
   */
  readStlib(sourceLabel: string): Promise<string>
}
