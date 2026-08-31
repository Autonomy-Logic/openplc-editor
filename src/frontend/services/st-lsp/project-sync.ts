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

import type {
  PLCDataType,
  PLCGlobalVariableList,
  PLCPou,
  PLCRemoteDevice,
  PLCVariable,
} from '../../../middleware/shared/ports/types'
import { serializeSoftMotionAxisGlobalsToST } from '../../../middleware/shared/utils/ethercat'
import { openPLCStoreBase } from '../../store'
import { serializeDataTypesToST } from '../../utils/PLC/data-type-serializer'
import {
  globalVariableListIsReferencedIn,
  referenceSearchText,
  serializeGlobalVariableListInstances,
  serializeGlobalVariableListsToTypes,
} from '../../utils/PLC/global-variable-list-serializer'
import { serializePouSignatureToSTWithBodyOffset } from '../../utils/PLC/pou-signature-serializer'
import { serializeResourceGlobalsToST } from '../../utils/PLC/resource-globals-serializer'
import { deleteBodyLineOffset, setBodyLineOffset } from '../lsp-shared/body-offsets'
import {
  DATA_TYPES_URI,
  GLOBAL_VARIABLE_LISTS_URI,
  pouUri,
  RESOURCE_GLOBALS_URI,
  SOFTMOTION_GLOBALS_URI,
  type StLspService,
  stubUri,
} from './types'

/**
 * Determines whether a POU's source goes through the live-body
 * `pou://` URI scheme (ST only) or the signature-stub `stub://`
 * scheme (everything else).  Centralised so the diff layer and
 * the sync layer agree.
 */
function uriForPou(pou: PLCPou): string {
  return pou.body.language === 'st' ? pouUri(pou.name) : stubUri(pou.name)
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
  /**
   * Re-publish every open document with a bumped version, forcing
   * the worker to re-run analysis even when the document text hasn't
   * changed.  Required after a stlib-cache mutation (enable/disable
   * a project library): the worker updates its library cache in
   * place but only re-analyses on `didChange`, so previously-cached
   * `analysisResult`s would otherwise stay stale.
   */
  forceResync(): void
  dispose(): void
}

let syncedTextReader: ((uri: string) => string | undefined) | null = null

/** The text of `uri` as last sent to the worker, from the live project sync. */
export function getSyncedDocumentText(uri: string): string | undefined {
  return syncedTextReader?.(uri)
}

export function attachProjectSync(service: StLspService): ProjectSyncHandle {
  const snapshot = emptySnapshot()
  const readSyncedText = (uri: string) => snapshot.contentByUri.get(uri)
  syncedTextReader = readSyncedText
  let disposed = false

  // A variable's `location` holds EITHER a producer alias name OR a literal
  // `%addr`. `AT <alias>` is not valid IEC ST — strucpp abandons the whole VAR
  // block on it, so every symbol after the first alias-bound variable vanishes
  // from the POU's scope. The LSP therefore sees the same resolved addresses
  // the compiler does (`getCompileReadyProjectData`); only the projection is
  // resolved, the store keeps the alias names for display. The store memoizes
  // this on producer-state identity, so calling it per reconcile is cheap.
  const aliasIndex = (): ReadonlyMap<string, string> => openPLCStoreBase.getState().projectActions.getAliasIndex()

  // Reconcile a single fixed-URI synthesized document (data types, resource
  // globals, softmotion axes …) against the worker: open on first non-empty
  // text, didChange on a text change, didClose when it becomes empty. Centralised
  // so every synthesized doc shares one diff engine instead of copy-pasting it.
  function reconcileSyntheticDoc(uri: string, nextText: string): boolean {
    if (disposed) return false
    const previousText = snapshot.contentByUri.get(uri)
    if (nextText.length === 0) {
      if (previousText === undefined) return false
      service.closeDocument(uri)
      snapshot.contentByUri.delete(uri)
      return true
    }
    if (previousText === undefined) {
      service.openDocument(uri, nextText)
    } else if (previousText !== nextText) {
      snapshot.version += 1
      service.changeDocument(uri, nextText, snapshot.version)
    } else {
      return false
    }
    snapshot.contentByUri.set(uri, nextText)
    return true
  }

  // The whole `TYPE … END_TYPE` block, so any POU that references a user data
  // type resolves it.
  function reconcileDataTypes(dataTypes: PLCDataType[]): void {
    reconcileSyntheticDoc(DATA_TYPES_URI, serializeDataTypesToST(dataTypes))
  }

  // The project's configuration-level `VAR_GLOBAL`s wrapped in a CONFIGURATION,
  // so a POU's `VAR_EXTERNAL` resolves against a matching global.
  function reconcileResourceGlobals(globals: PLCVariable[]): void {
    reconcileSyntheticDoc(RESOURCE_GLOBALS_URI, serializeResourceGlobalsToST(globals, aliasIndex()))
  }

  // A `VAR_GLOBAL <axis> : AXIS_REF_SM3` per recognized CiA 402 drive, so editor
  // code that names an axis resolves it (AXIS_REF_SM3 comes from the bundled
  // stlib the LSP already ingests).
  /**
   * Global Variable Lists, as the compiler sees them: a STRUCT type per list and one global
   * instance of each, built by the SAME serializers the transpiler uses. Sharing those is the
   * point — the language server's picture of a GVL cannot drift from the one that compiles,
   * so `GVL.Output1` completing in the editor means it will also compile.
   *
   * This is what puts a GVL in scope AT ALL. A POU never declares one — historically an
   * OpenPLC global reached a POU through a `VAR_EXTERNAL` the user wrote, and a list has no
   * such declaration anywhere — so without this document strucpp has never heard the name and
   * every consumer fails identically: no completion in ST, none in the graphical editors, and
   * a typed-in `GVL.Output2` resolves to nothing and is drawn as an unknown symbol.
   */
  function reconcileGlobalVariableLists(lists: PLCGlobalVariableList[] | undefined): boolean {
    const all = lists ?? []
    // Both serializers already return '' for a list with no members, and each ends in a
    // newline, so `END_TYPE` and `VAR_GLOBAL` never run together.
    return reconcileSyntheticDoc(
      GLOBAL_VARIABLE_LISTS_URI,
      `${serializeGlobalVariableListsToTypes(all)}${serializeGlobalVariableListInstances(all)}`,
    )
  }

  /**
   * Re-publish the POU documents that reach into a list.
   *
   * Changing the synthesized document does not change one character of any POU: a POU only
   * ever names the list (`GVL : GVL_TYPE;`), never its members. The worker analyses per
   * document and answers from that analysis, so with the declaration alone re-sent, a POU
   * keeps the scope it was last analysed against — `GVL.` then completes against the members
   * as they were one edit ago, whichever view made the edit. Re-sending the POU with a bumped
   * version is the trigger; the text is deliberately unchanged.
   *
   * Only the POUs that reference a list are re-sent. Re-publishing every document on every
   * edited cell is analysis work nothing asked for, and `referenceSearchText` is the same
   * scan the `VAR_EXTERNAL` projection already runs per POU.
   */
  function republishGlobalVariableListConsumers(lists: PLCGlobalVariableList[] | undefined): void {
    if (disposed) return
    const declared = (lists ?? []).filter((list) => list.variables.length > 0)
    if (declared.length === 0) return

    for (const pou of openPLCStoreBase.getState().project.data.pous) {
      const searchText = referenceSearchText(pou)
      if (!declared.some((list) => globalVariableListIsReferencedIn(list.name, searchText))) continue
      const uri = snapshot.uriByName.get(pou.name)
      const text = uri === undefined ? undefined : snapshot.contentByUri.get(uri)
      if (uri === undefined || text === undefined) continue
      snapshot.version += 1
      service.changeDocument(uri, text, snapshot.version)
    }
  }

  function reconcileSoftMotionGlobals(remoteDevices: PLCRemoteDevice[] | undefined): void {
    reconcileSyntheticDoc(SOFTMOTION_GLOBALS_URI, serializeSoftMotionAxisGlobalsToST({ remoteDevices } as never))
  }

  function reconcile(pous: PLCPou[]): void {
    if (disposed) return

    // Read once per reconcile — every POU stub resolves against the same index.
    const resolvedAliases = aliasIndex()
    const seenNames = new Set<string>()
    const seenUris = new Set<string>()
    // The synthesized documents (data types, resource globals, SoftMotion axes)
    // survive every POU reconcile — mark their URIs as seen so the catch-all
    // cleanup loop below doesn't drop them.
    seenUris.add(DATA_TYPES_URI)
    seenUris.add(RESOURCE_GLOBALS_URI)
    seenUris.add(SOFTMOTION_GLOBALS_URI)
    seenUris.add(GLOBAL_VARIABLE_LISTS_URI)

    for (const pou of pous) {
      seenNames.add(pou.name)
      const nextUri = uriForPou(pou)
      const previousUri = snapshot.uriByName.get(pou.name)
      // POUs are serialised verbatim — no axis VAR_EXTERNAL injection here.
      // Axes are surfaced as ambient globals (SOFTMOTION_GLOBALS_URI), so the
      // editor documents keep the exact line layout the user wrote and
      // go-to-definition line mapping stays correct.
      const { text: nextText, bodyLineOffset } = serializePouSignatureToSTWithBodyOffset(pou, resolvedAliases)

      // POU name unchanged but URI switched (body language change).
      // Send didClose for the previous URI before didOpen on the new.
      if (previousUri && previousUri !== nextUri) {
        service.closeDocument(previousUri)
        snapshot.contentByUri.delete(previousUri)
        deleteBodyLineOffset(previousUri)
      }

      seenUris.add(nextUri)
      // Track the body offset so providers/diagnostics can translate
      // LSP line numbers back to Monaco's body-only view.  Stored on
      // every reconcile because variable-count changes shift the body.
      setBodyLineOffset(nextUri, bodyLineOffset)
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
      deleteBodyLineOffset(uri)
    }
    // Defensive: also drop content entries whose URIs vanished
    // (e.g. a POU renamed at the same time as a language flip).
    for (const uri of snapshot.contentByUri.keys()) {
      if (!seenUris.has(uri)) {
        snapshot.contentByUri.delete(uri)
        deleteBodyLineOffset(uri)
      }
    }
  }

  // Subscribe to project.data.pous AND project.meta.name so a
  // project-level open/close also reconciles.  Equality compares
  // by reference; the project slice uses Immer so pous array
  // references update on every mutation.
  const unsubscribePous = openPLCStoreBase.subscribe(
    (state) => state.project.data.pous,
    (pous) => reconcile(pous),
  )
  // Data types live in their own slice and change independently of
  // POUs (a user can add an enum without touching any POU body).
  // Subscribe separately so a type-only mutation refreshes the LSP
  // without waiting on a POU edit.
  const unsubscribeDataTypes = openPLCStoreBase.subscribe(
    (state) => state.project.data.dataTypes,
    (dataTypes) => reconcileDataTypes(dataTypes),
  )
  // Resource globals live under the configuration and change independently of
  // POUs, so a POU's VAR_EXTERNAL resolves without waiting on a POU edit.
  const unsubscribeResourceGlobals = openPLCStoreBase.subscribe(
    (state) => state.project.data.configurations.resource.globalVariables,
    (globals) => reconcileResourceGlobals(globals),
  )
  // SoftMotion axis globals derive from the EtherCAT remote devices — adding,
  // renaming, or enabling a CiA 402 drive must refresh the synthesized globals
  // doc so editor code resolves the new axis without a POU edit.
  const unsubscribeRemoteDevices = openPLCStoreBase.subscribe(
    (state) => state.project.data.remoteDevices,
    (remoteDevices) => reconcileSoftMotionGlobals(remoteDevices),
  )
  // Global Variable Lists change on their own too — creating one, renaming it, or editing a
  // member has to refresh the synthesized document, or the editor keeps completing against
  // the list as it was.
  const unsubscribeGlobalVariableLists = openPLCStoreBase.subscribe(
    (state) => state.project.data.globalVariableLists,
    (lists) => {
      // A documentation-only edit moves the store without moving the document — nothing to
      // re-analyse then.
      if (reconcileGlobalVariableLists(lists)) republishGlobalVariableListConsumers(lists)
    },
  )
  // Every document that declares variables is serialized against the alias →
  // address index, so a producer-only change must re-emit them.  Renaming an
  // alias already cascades into `project.data.pous` (via `renameAlias`) and
  // reconciles through the subscription above, but a pure *re-address*
  // (`recalculateIecAddresses` compacting after an IO point is removed)
  // touches only the producers — the stubs would otherwise keep the old
  // `%addr`.  Selecting the index itself is the exact trigger: the store
  // memoizes it on producer-state identity, so this selector is a handful of
  // `===` checks and the listener fires only when the index really moved.
  const unsubscribeAliasIndex = openPLCStoreBase.subscribe(
    (state) => state.projectActions.getAliasIndex(),
    () => {
      const live = openPLCStoreBase.getState()
      reconcileResourceGlobals(live.project.data.configurations.resource.globalVariables)
      reconcile(live.project.data.pous)
    },
  )

  // Initial reconcile against whatever is already in the store.  The
  // synthesized globals/types load first so any POU that references
  // them resolves on the first didOpen, not on a follow-up didChange.
  reconcileDataTypes(openPLCStoreBase.getState().project.data.dataTypes)
  reconcileResourceGlobals(openPLCStoreBase.getState().project.data.configurations.resource.globalVariables)
  reconcileSoftMotionGlobals(openPLCStoreBase.getState().project.data.remoteDevices)
  reconcileGlobalVariableLists(openPLCStoreBase.getState().project.data.globalVariableLists)
  reconcile(openPLCStoreBase.getState().project.data.pous)

  return {
    resync() {
      if (disposed) return
      reconcileDataTypes(openPLCStoreBase.getState().project.data.dataTypes)
      reconcileResourceGlobals(openPLCStoreBase.getState().project.data.configurations.resource.globalVariables)
      reconcileSoftMotionGlobals(openPLCStoreBase.getState().project.data.remoteDevices)
      reconcileGlobalVariableLists(openPLCStoreBase.getState().project.data.globalVariableLists)
      reconcile(openPLCStoreBase.getState().project.data.pous)
    },
    forceResync() {
      if (disposed) return
      // Re-publish every tracked document with a bumped version.  The
      // worker debounces analysis per-URI, so back-to-back calls for
      // the same URI coalesce; that's fine — we just need one
      // analysis pass after the stlib cache settled.
      for (const [uri, text] of snapshot.contentByUri) {
        snapshot.version += 1
        service.changeDocument(uri, text, snapshot.version)
      }
    },
    dispose() {
      if (syncedTextReader === readSyncedText) syncedTextReader = null
      if (disposed) return
      disposed = true
      unsubscribePous()
      unsubscribeDataTypes()
      unsubscribeResourceGlobals()
      unsubscribeRemoteDevices()
      unsubscribeGlobalVariableLists()
      unsubscribeAliasIndex()
      // Close every doc we'd opened so the worker stays consistent
      // if the service is restarted in the same session.
      for (const uri of snapshot.contentByUri.keys()) {
        service.closeDocument(uri)
        deleteBodyLineOffset(uri)
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
 *
 * `onAfterRefresh` (when supplied) is invoked once `refreshStlibs()`
 * resolves.  Callers wire this to `ProjectSyncHandle.forceResync` so
 * the worker re-runs analysis against the new stlib cache; without
 * it, open documents would keep stale `analysisResult`s.
 */
export function attachLibrarySync(service: StLspService, onAfterRefresh?: () => void): () => void {
  return openPLCStoreBase.subscribe(
    (state) => state.libraries.user.map((l) => l.name).join('|'),
    () => {
      void service.refreshStlibs().then(() => {
        onAfterRefresh?.()
      })
    },
  )
}

/**
 * Wires project-level library enablement to the service's
 * `refreshStlibs()`.  The Library Manager's enable/disable actions
 * mutate `project.data.libraries` (and the derived `enabledLibraries`
 * view); user-defined POUs do not.  Watching the derived view keeps
 * this independent of `attachLibrarySync` and ensures the LSP worker
 * re-loads its stlib cache the moment the user toggles a `.stlib`
 * library on or off for the current project.
 *
 * The selector is sorted so a reorder doesn't fire a spurious refresh.
 *
 * `onAfterRefresh` is invoked once `refreshStlibs()` resolves; wire
 * it to `forceResync` so open documents are re-analysed against the
 * new library cache.
 */
export function attachEnabledLibrariesSync(service: StLspService, onAfterRefresh?: () => void): () => void {
  return openPLCStoreBase.subscribe(
    (state) => state.enabledLibraries.slice().sort().join('|'),
    () => {
      void service.refreshStlibs().then(() => {
        onAfterRefresh?.()
      })
    },
  )
}

/**
 * Wires the always-on bundled-library list to `refreshStlibs()`.
 *
 * `bundledLibraryNames` is populated asynchronously at app boot by
 * `hydrateLibraries()` in `App.tsx`, in parallel with `bootStLsp`.
 * If the LSP finishes initialising before the bundled list lands,
 * the initial `pushAllStlibs` filters with an empty bundled set and
 * standard archives (IEC FBs like `TON`, `CTU`, …) never reach the
 * worker — surfacing as "Undefined type 'TON'" diagnostics.  This
 * subscription closes that race: as soon as bundled names arrive
 * (or later toggle), the cache is repushed and open documents are
 * re-analysed.
 */
export function attachBundledLibrariesSync(service: StLspService, onAfterRefresh?: () => void): () => void {
  return openPLCStoreBase.subscribe(
    (state) => state.bundledLibraryNames.slice().sort().join('|'),
    () => {
      void service.refreshStlibs().then(() => {
        onAfterRefresh?.()
      })
    },
  )
}
