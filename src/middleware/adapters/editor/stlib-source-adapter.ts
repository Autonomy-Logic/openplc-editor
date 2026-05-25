// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Editor adapter for StlibSourcePort.
 *
 * Implementation note: the main process's LibraryManagerModule
 * already returns every installed archive (bundled + user) parsed
 * via the `libraries:load-all` IPC.  Rather than introduce a second
 * IPC channel just to surface the raw bytes, we cache the parsed
 * archives in-memory and JSON-stringify on demand for the LSP
 * worker.  The double cost (parse in main → stringify here →
 * `loadStlibFromString` in the worker) is fine for the ~10 archives
 * a typical project carries; it also keeps the trust boundary
 * unchanged — the renderer never gets fresh-from-disk bytes.
 *
 * `sourceLabel` is just the library name in this adapter.  The web
 * adapter will use an HTTP URL — same shape, different meaning.
 *
 * Cache invalidation: `libraries:changed` IPC events are emitted by
 * the main process whenever install / uninstall happens.  The
 * adapter listens via `window.bridge.onLibrariesChanged` so the
 * next `listStlibs` / `readStlib` reflects the new set.
 */

import type { StlibSource, StlibSourcePort } from '../../shared/ports/stlib-source-port'

interface CachedArchive {
  /** Re-stringified once per cache miss; reused for repeated reads. */
  json: string
  manifest: {
    name: string
    version: string
  }
}

export function createEditorStlibSourceAdapter(): StlibSourcePort {
  /**
   * Per-process cache.  Populated on first `listStlibs` (or after
   * `libraries:changed`); cleared on change events so the next
   * call re-fetches.
   */
  let archives: Map<string, CachedArchive> | null = null

  async function ensureCache(): Promise<Map<string, CachedArchive>> {
    if (archives) return archives
    // Returns StlibArchiveDTO[] — the structural shape matches
    // strucpp's `StlibArchive` (just a JSON object).  Each entry
    // carries a full `manifest` block and the chunks/dependencies.
    const all = (await window.bridge.loadAllLibraries()) as Array<{
      manifest?: { name?: string; version?: string }
      [k: string]: unknown
    }>
    const map = new Map<string, CachedArchive>()
    for (const archive of all) {
      const name = archive.manifest?.name
      const version = archive.manifest?.version
      // Skip archives without a usable identity — the LSP can't
      // address them and they wouldn't survive `loadStlibFromString`
      // anyway.  This is defensive; loadAll() never produces these.
      if (!name || !version) continue
      map.set(name, {
        json: JSON.stringify(archive),
        manifest: { name, version },
      })
    }
    archives = map
    return map
  }

  // Drop the cache whenever libraries change so the next
  // `listStlibs` re-pulls.  No-op if window.bridge doesn't expose
  // the subscription (older builds, test harnesses).
  if (typeof window.bridge?.onLibrariesChanged === 'function') {
    window.bridge.onLibrariesChanged(() => {
      archives = null
    })
  }

  return {
    async listStlibs(): Promise<StlibSource[]> {
      const cache = await ensureCache()
      return [...cache.values()].map((entry) => ({
        name: entry.manifest.name,
        version: entry.manifest.version,
        // The adapter is the only thing that interprets sourceLabel.
        // Reusing the library name keeps the wire payload trivial.
        sourceLabel: entry.manifest.name,
      }))
    },

    async readStlib(sourceLabel: string): Promise<string> {
      const cache = await ensureCache()
      const entry = cache.get(sourceLabel)
      if (!entry) {
        throw new Error(
          `Unknown stlib source '${sourceLabel}' — not present in the editor's library cache. ` +
            'The LSP worker may be holding a stale reference; trigger a libraries:changed reload.',
        )
      }
      return entry.json
    },
  }
}
