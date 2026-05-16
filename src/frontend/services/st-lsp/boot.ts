// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Boot the STruC++ LSP service at app start-up.
 *
 * Pre-warming pays off because Monaco's first ST POU open otherwise
 * sees an uncolored, undiagnosed file for the ~hundreds of ms the
 * worker takes to spawn, initialise, ingest stlibs, and analyse the
 * project.  Kicking it from module load — same pattern as
 * `hydrateLibraries` in `App.tsx` — lets startup work overlap with
 * the rest of the renderer's bootstrap.
 *
 * Returns a handle the caller can keep around for HMR teardown
 * (dev server reload) or for explicit shutdown.  Real production
 * lifetime is "until the renderer process exits", which Electron
 * handles for us.
 */

import type { PlatformPorts } from '../../../middleware/shared/providers/types'
import { startStLsp } from './index'
import { attachLibrarySync, attachProjectSync } from './project-sync'
import type { StLspService } from './types'

export interface StLspBootHandle {
  service: StLspService
  dispose(): void
}

/**
 * Initialise the LSP service if the platform supports it.  Returns
 * `null` when `capabilities.hasStLSP` is false OR when the
 * required `stlibSource` port is missing — both signal "ST tooling
 * intentionally absent on this build", not a misconfiguration.
 */
export function bootStLsp(
  ports: PlatformPorts,
  monaco: typeof import('monaco-editor'),
): StLspBootHandle | null {
  if (!ports.capabilities.hasStLSP || !ports.stlibSource) {
    return null
  }

  const service = startStLsp({
    stlibSource: ports.stlibSource,
    monaco,
  })

  // Project sync starts immediately — diff layer copes with an
  // empty pous array if no project is loaded yet.  When the user
  // opens a project, the subscribe fires and the worker sees a
  // didOpen wave for every POU.
  const projectSync = attachProjectSync(service)
  const unsubscribeLibrarySync = attachLibrarySync(service)

  return {
    service,
    dispose() {
      unsubscribeLibrarySync()
      projectSync.dispose()
      service.dispose()
    },
  }
}
