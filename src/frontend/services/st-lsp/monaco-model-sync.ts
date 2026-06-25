// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Pre-register Monaco text models for every POU.
 *
 * The LSP returns cross-POU `Location[]` for go-to-references,
 * peek-definition, etc.  Monaco's reference / peek widgets resolve
 * each `Location.uri` through `StandaloneTextModelService` which only
 * knows about models the runtime has registered.  Before this layer
 * existed, those URIs (every POU other than the one currently open
 * in the body editor) had no model — so the widget threw
 * "Model not found" the moment a user expanded a foreign POU's group
 * or clicked into one of its references.
 *
 * The fix: for every POU in the project, create a Monaco model at the
 * same URI the LSP service opens documents under, and keep its
 * content in sync with the project store.  When the user later opens
 * that POU's tab, `@monaco-editor/react`'s `PrimitiveEditor` finds the
 * existing model and re-uses it; the model already carries the
 * correct body, so no flash of empty content.
 *
 * Model content matches what Monaco's *body editor* would show — for
 * ST POUs that's the body verbatim (no preamble), for non-ST POUs
 * it's the opaque placeholder (those bodies are never read through
 * Monaco anyway, but reference widgets still need *something* to
 * render against the URI).
 */

import type * as monaco from 'monaco-editor'

import type { PLCPou } from '../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../store'
import { OPAQUE_BODY_PLACEHOLDER } from '../../utils/PLC/pou-signature-serializer'
import { pouUri, stubUri } from './types'

const ST_LANGUAGE_ID = 'st'

export interface MonacoModelSyncHandle {
  dispose(): void
}

/**
 * Subscribe to `project.data.pous` and keep one Monaco model per POU
 * at the URI the LSP service uses.  Idempotent on initial mount;
 * dispose tears down every model the sync created.
 */
export function attachMonacoModelSync(monacoApi: typeof monaco): MonacoModelSyncHandle {
  let disposed = false
  // URIs we minted ourselves; we only dispose models from this set on
  // teardown so we don't yank a model some other consumer registered.
  const ownedUris = new Set<string>()

  function getOrCreate(uri: string, body: string): monaco.editor.ITextModel | null {
    const monacoUri = monacoApi.Uri.parse(uri)
    let model = monacoApi.editor.getModel(monacoUri)
    if (!model) {
      model = monacoApi.editor.createModel(body, ST_LANGUAGE_ID, monacoUri)
      ownedUris.add(uri)
    } else {
      // Pre-existing model (created by @monaco-editor/react when the
      // body editor mounted before sync).  Take ownership so we keep
      // it in sync and clean it up on dispose.
      ownedUris.add(uri)
    }
    return model
  }

  function bodyTextFor(pou: PLCPou): string {
    if (pou.body.language === 'st') {
      return typeof pou.body.value === 'string' ? pou.body.value : ''
    }
    return OPAQUE_BODY_PLACEHOLDER
  }

  function reconcile(pous: PLCPou[]): void {
    if (disposed) return
    // Skip the transient empty state.  `handleOpenProjectResponse` clears the
    // store (`pous = []`) before repopulating it on every project (re)load —
    // e.g. the reload after a stash apply/pop.  Our store subscription fires
    // synchronously on that empty list; without this guard the disappeared-POU
    // sweep below would dispose EVERY owned model, including the one the
    // currently-open `<Editor>` is bound to.  Monaco then detaches the disposed
    // model, leaving `editorRef.current.getModel()` null, and
    // `@monaco-editor/react`'s value-sync effect crashes with
    // "null is not an object (evaluating 'getModel().getFullModelRange')".
    // A real project always has at least one POU; genuine full teardown goes
    // through `dispose()`, so an empty list here is never a real deletion.
    if (pous.length === 0) return
    const seen = new Set<string>()
    for (const pou of pous) {
      // ST POUs live at pou://; everything else at stub://.  Matches
      // the URI scheme `project-sync.ts` opens documents under so the
      // reference / peek widget URI lookups resolve to a real model.
      const uri = pou.body.language === 'st' ? pouUri(pou.name) : stubUri(pou.name)
      seen.add(uri)
      const text = bodyTextFor(pou)
      const model = getOrCreate(uri, text)
      // Skip when content already matches — `setValue` resets cursor
      // and selection on every editor wired to the model, so doing it
      // for an already-correct body would clobber the user's caret.
      if (model && model.getValue() !== text) {
        model.setValue(text)
      }
    }
    // Dispose models for POUs that disappeared (renamed or deleted).
    for (const uri of [...ownedUris]) {
      if (seen.has(uri)) continue
      const monacoUri = monacoApi.Uri.parse(uri)
      const model = monacoApi.editor.getModel(monacoUri)
      model?.dispose()
      ownedUris.delete(uri)
    }
  }

  const unsubscribe = openPLCStoreBase.subscribe(
    (state) => state.project.data.pous,
    (pous) => reconcile(pous),
  )

  reconcile(openPLCStoreBase.getState().project.data.pous)

  return {
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      for (const uri of ownedUris) {
        const monacoUri = monacoApi.Uri.parse(uri)
        monacoApi.editor.getModel(monacoUri)?.dispose()
      }
      ownedUris.clear()
    },
  }
}
