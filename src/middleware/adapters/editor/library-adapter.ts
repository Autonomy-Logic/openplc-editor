/**
 * Editor LibraryPort adapter — delegates to the main process
 * LibraryManagerModule.
 *
 * The renderer never touches the filesystem; every call goes through
 * the IPC bridge into the main process module that owns
 * `<resources>/strucpp/libs/` (bundled libs) and
 * `{userData}/libraries/` (user-installed).
 *
 * IPC channels used:
 *   libraries:load-all          (invoke)
 *   libraries:list-installed    (invoke)
 *   libraries:install-from-file (invoke)
 *   libraries:uninstall         (invoke)
 *   libraries:changed           (on)
 *   catalog:list                (invoke) — public-library browse
 *   catalog:install-many        (invoke) — public-library batch install
 */

import type {
  CatalogInstallBatch,
  CatalogQueryResult,
  LibraryPort,
  StlibArchiveDTO,
} from '../../shared/ports/library-port'
import type { InstalledLibrary, LibraryInstallResult } from '../../shared/ports/library-types'
import type { ListPublicLibrariesArgs } from '../../shared/ports/public-catalog-types'
import type { Result, Unsubscribe } from '../../shared/ports/types'

export function createEditorLibraryAdapter(): LibraryPort {
  return {
    async loadAll(): Promise<StlibArchiveDTO[]> {
      // The IPC layer types the response as `unknown[]` to keep the
      // bridge signature free of strucpp imports; the runtime payload
      // is always a parsed StlibArchive JSON.  Cast at the port
      // boundary — the structural shape lines up by construction
      // (the main process JSON.parses .stlib files we ship and
      // .stlib files compileStlib produces, both share the contract).
      const archives = await window.bridge.loadAllLibraries()
      return archives as StlibArchiveDTO[]
    },

    listInstalled(): Promise<InstalledLibrary[]> {
      return window.bridge.listInstalledLibraries()
    },

    installFromFile(): Promise<LibraryInstallResult> {
      return window.bridge.installLibraryFromFile()
    },

    async uninstall(name: string): Promise<Result> {
      const result = await window.bridge.uninstallLibrary(name)
      if (result.success) return { success: true } as Result
      return { success: false, error: result.error ?? 'Uninstall failed' }
    },

    onLibrariesChanged(callback: () => void): Unsubscribe {
      return window.bridge.onLibrariesChanged(callback)
    },

    queryPublicCatalog(args: ListPublicLibrariesArgs): Promise<CatalogQueryResult> {
      return window.bridge.queryPublicCatalog(args)
    },

    installFromCatalog(publishedLibraryIds: string[]): Promise<CatalogInstallBatch> {
      return window.bridge.installLibrariesFromCatalog(publishedLibraryIds)
    },
  }
}
