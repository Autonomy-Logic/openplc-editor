// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Project store → LSP document sync.
 *
 * Subscribes to the `project.data.pous` slice and keeps the LSP
 * worker in lock-step with every POU's current state:
 *
 *   - ST POUs are sent verbatim via `inmemory://pou/<name>.st`.
 *   - Every other body language (graphical, IL, hybrid) is sent as
 *     a signature stub via `inmemory://stub/<name>.st`.  Cross-POU
 *     symbol resolution from an ST POU then sees the stub's VAR
 *     blocks, not the opaque body.
 *
 * On every project mutation we diff the current POU set against
 * the previous snapshot and emit didOpen / didChange / didClose
 * accordingly.  The diff is keyed by (name, kind) so a POU that
 * gets its body language flipped (e.g. ST→LD) emits a close-then-
 * reopen pair, which is the correct LSP handshake — the URI scheme
 * changes between pou:// and stub://, so the previous URI is
 * effectively gone.
 *
 * Stlib refresh is wired the same way: a `libraries:changed` event
 * (broadcast by the library slice's `system` view) triggers a
 * `refreshStlibs()` on the service.
 */

import type { PLCPou } from '../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../store'
import { serializePouSignatureToST } from '../../utils/PLC/pou-signature-serializer'
import { pouUri, stubUri, type StLspService } from './types'

/**
 * Determines whether a POU's source goes through the live-body
 * `pou://` URI scheme (ST only) or the signature-stub `stub://`
 * scheme (everything else).  Centralised so the diff layer and
 * the sync layer agree.
 */
function uriForPou(pou: PLCPou): string {
  return pou.body.language === 'st' ? pouUri(pou.name) : stubUri(pou.name)
}

/**
 * Builds the ST text the worker should see for a POU.  ST POUs
 * pass their body verbatim; everything else gets a signature stub.
 * Wrapping `serializePouSignatureToST` lets future per-language
 * tweaks (e.g. inlining the IL body as a comment block) land
 * without touching every call site.
 */
function textForPou(pou: PLCPou): string {
  return serializePouSignatureToST(pou)
}

interface Snapshot {
  /** URI → POU body text the worker last saw. */
  contentByUri: Map<string, string>
  /** name → URI, so a rename or language change resolves which doc to close. */
  uriByName: Map<string, string>
  /** Monotonic version counter shared across every document. */
  version: number
}

function emptySnapshot(): Snapshot {
  return { contentByUri: new Map(), uriByName: new Map(), version: 0 }
}

export interface ProjectSyncHandle {
  /**
   * Manually trigger a full re-sync.  Useful on app boot after the
   * service's `ready` promise resolves but before any project
   * mutation has occurred.
   */
  resync(): void
  dispose(): void
}

export function attachProjectSync(service: StLspService): ProjectSyncHandle {
  const snapshot = emptySnapshot()
  let disposed = false

  function reconcile(pous: PLCPou[]): void {
    if (disposed) return

    const seenNames = new Set<string>()
    const seenUris = new Set<string>()

    for (const pou of pous) {
      seenNames.add(pou.name)
      const nextUri = uriForPou(pou)
      const previousUri = snapshot.uriByName.get(pou.name)
      const nextText = textForPou(pou)

      // POU name unchanged but URI switched (body language change).
      // Send didClose for the previous URI before didOpen on the new.
      if (previousUri && previousUri !== nextUri) {
        service.closeDocument(previousUri)
        snapshot.contentByUri.delete(previousUri)
      }

      seenUris.add(nextUri)
      const previousText = snapshot.contentByUri.get(nextUri)
      if (previousText === undefined) {
        service.openDocument(nextUri, nextText)
      } else if (previousText !== nextText) {
        snapshot.version += 1
        service.changeDocument(nextUri, nextText, snapshot.version)
      }
      snapshot.contentByUri.set(nextUri, nextText)
      snapshot.uriByName.set(pou.name, nextUri)
    }

    // Anything missing from the new set → close it.
    for (const [name, uri] of snapshot.uriByName) {
      if (seenNames.has(name)) continue
      service.closeDocument(uri)
      snapshot.contentByUri.delete(uri)
      snapshot.uriByName.delete(name)
    }
    // Defensive: also drop content entries whose URIs vanished
    // (e.g. a POU renamed at the same time as a language flip).
    for (const uri of snapshot.contentByUri.keys()) {
      if (!seenUris.has(uri)) {
        snapshot.contentByUri.delete(uri)
      }
    }
  }

  // Subscribe to project.data.pous AND project.meta.name so a
  // project-level open/close also reconciles.  Equality compares
  // by reference; the project slice uses Immer so pous array
  // references update on every mutation.
  const unsubscribe = openPLCStoreBase.subscribe(
    (state) => state.project.data.pous,
    (pous) => reconcile(pous),
  )

  // Initial reconcile against whatever is already in the store.
  reconcile(openPLCStoreBase.getState().project.data.pous)

  return {
    resync() {
      if (disposed) return
      reconcile(openPLCStoreBase.getState().project.data.pous)
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      // Close every doc we'd opened so the worker stays consistent
      // if the service is restarted in the same session.
      for (const uri of snapshot.contentByUri.keys()) {
        service.closeDocument(uri)
      }
      snapshot.contentByUri.clear()
      snapshot.uriByName.clear()
    },
  }
}

/**
 * Wires `libraries:changed` events from the library slice to the
 * service's `refreshStlibs()`.  Subscribes to a stable selector so
 * the callback fires only when the user-library list actually
 * mutates, not on unrelated state changes.
 */
export function attachLibrarySync(service: StLspService): () => void {
  return openPLCStoreBase.subscribe(
    (state) => state.libraries.user.map((l) => l.name).join('|'),
    () => {
      void service.refreshStlibs()
    },
  )
}
