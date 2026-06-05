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
import { toast } from '../../utils/toast'
import { startStLsp } from './index'
import { attachMonacoModelSync, type MonacoModelSyncHandle } from './monaco-model-sync'
import {
  attachBundledLibrariesSync,
  attachEnabledLibrariesSync,
  attachLibrarySync,
  attachProjectSync,
} from './project-sync'
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
 *
 * `workerUrl` is the resolved asset URL for strucpp's browser-server
 * worker bundle.  Each platform's `App.tsx` resolves it through its
 * own bundler (webpack `?url` rewriter on the Electron editor, Vite
 * `?url` query import on the web build) and passes it in — keeping
 * the bundler-specific syntax out of this shared module.  When
 * omitted, `startStLsp` falls back to its in-line `require()`
 * resolution, which works under webpack but not Vite.  Tests pass
 * `workerUrl: 'about:blank'` (or any string) to bypass the fallback
 * entirely.
 */
export function bootStLsp(
  ports: PlatformPorts,
  monaco: typeof import('monaco-editor'),
  workerUrl?: string,
): StLspBootHandle | null {
  if (!ports.capabilities.hasStLSP || !ports.stlibSource) {
    return null
  }

  // Post-initialize worker crashes leave any in-flight request
  // hanging forever — the user types into Monaco, completions never
  // arrive, diagnostics stop updating, and there's no signal that
  // anything broke.  Surface it as a one-shot toast so the user
  // knows to restart instead of fighting an apparently-frozen
  // editor.  Pre-init crashes go through the rejected `ready`
  // promise; this callback fires only for crash-after-ready.
  let crashToastShown = false
  const service = startStLsp({
    stlibSource: ports.stlibSource,
    monaco,
    ...(workerUrl ? { workerUrlOverride: workerUrl } : {}),
    onCrash: (err) => {
      if (crashToastShown) return
      crashToastShown = true
      toast({
        title: 'STruC++ service crashed',
        description:
          err.message ||
          'The Structured Text language server stopped responding. Reload the editor to restore autocomplete and diagnostics.',
        variant: 'fail',
      })
    },
  })

  // Project sync starts immediately — diff layer copes with an
  // empty pous array if no project is loaded yet.  When the user
  // opens a project, the subscribe fires and the worker sees a
  // didOpen wave for every POU.
  const projectSync = attachProjectSync(service)
  // Both library-sync layers force a document re-publish after the
  // stlib cache settles.  The worker doesn't re-run analysis on
  // cache mutations, so without this nudge documents keep their
  // previously-cached `analysisResult` and Monaco shows stale
  // diagnostics — most visibly: symbols from a just-disabled
  // library still resolve.
  const forceResync = () => projectSync.forceResync()
  const unsubscribeLibrarySync = attachLibrarySync(service, forceResync)
  const unsubscribeEnabledLibrariesSync = attachEnabledLibrariesSync(service, forceResync)
  const unsubscribeBundledLibrariesSync = attachBundledLibrariesSync(service, forceResync)

  // Pre-register Monaco models for every POU so cross-POU
  // references / peek-definition / go-to-references resolve through
  // Monaco's StandaloneTextModelService without throwing "Model not
  // found" for POUs the user hasn't opened yet.
  let modelSync: MonacoModelSyncHandle | null = null
  try {
    modelSync = attachMonacoModelSync(monaco)
  } catch (err) {
    // Don't let model-sync failure tear down the rest of the LSP —
    // the worst case is references stay broken (the pre-existing
    // state); diagnostics / completion / semantic tokens still work.
    console.warn('[strucpp-lsp] Monaco model sync failed to attach:', err)
  }

  return {
    service,
    dispose() {
      unsubscribeBundledLibrariesSync()
      unsubscribeEnabledLibrariesSync()
      unsubscribeLibrarySync()
      projectSync.dispose()
      modelSync?.dispose()
      service.dispose()
    },
  }
}
