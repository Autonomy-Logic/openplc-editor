/**
 * Editor LibraryPort adapter — delegates .stlib loading to the main
 * process.
 *
 * The main process holds a reference to `<resources>/strucpp/libs/`
 * (under the user's installed app or, in development, under the project
 * root) and exposes `system-libraries:load-bundled` over IPC. The
 * renderer never accesses the filesystem directly; this adapter is just
 * a thin invoke wrapper that forwards the call and types the response.
 *
 * IPC channels used:
 *   - system-libraries:load-bundled (invoke)
 */

import type { LibraryPort, StlibArchiveDTO } from '../../shared/ports/library-port'

export function createEditorLibraryAdapter(): LibraryPort {
  return {
    async loadBundledLibraries(): Promise<StlibArchiveDTO[]> {
      // The IPC layer types the response as `unknown[]` to keep the
      // bridge signature free of strucpp imports; the runtime payload
      // is always a parsed StlibArchive JSON. Cast at the port boundary
      // — the structural shape lines up by construction (the main
      // process JSON.parses the .stlib files we ship).
      const archives = await window.bridge.loadBundledLibraries()
      return archives as StlibArchiveDTO[]
    },
  }
}
