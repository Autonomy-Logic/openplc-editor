// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Go-to-definition redirect for graphical POUs.
 *
 * Cross-POU symbol resolution from an ST POU may land the user on
 * a symbol whose definition lives in a Ladder / FBD / SFC body.
 * The LSP returns the location as a `inmemory://stub/<name>.st`
 * URI — a synthetic signature stub Monaco has no model for.
 * Navigating to it would dead-end at "model not found".
 *
 * `redirectToGraphicalPou(name)` checks the Zustand store for a
 * POU with that name and an LD/FBD/SFC body, opens the matching
 * graphical editor tab, and returns true.  Returns false when the
 * POU doesn't exist or isn't graphical — caller falls back to
 * Monaco's default behaviour in that case.
 */

import { openPLCStoreBase } from '../../store'
import { createEditorObjectForPou } from '../../store/slices/shared/utils'
import { parsePouUri } from './types'

const GRAPHICAL_LANGUAGES = new Set(['ld', 'fbd', 'sfc'])

/**
 * Returns true if the URI matches a stub:// URI AND the project
 * holds a POU with that name AND the POU's body is graphical.  The
 * caller must always treat false as "no redirect happened" and
 * fall back to whatever the default navigation flow would be.
 */
export function redirectToGraphicalPou(uri: string): boolean {
  const parsed = parsePouUri(uri)
  if (!parsed || parsed.kind !== 'stub') return false

  const state = openPLCStoreBase.getState()
  const pou = state.project.data.pous.find((p) => p.name === parsed.name)
  if (!pou) return false
  if (!GRAPHICAL_LANGUAGES.has(pou.body.language)) return false

  // Reuse the same tab-open sequence that pouActions.create uses —
  // create the editor model, register the file entry, surface the
  // tab, and set the active editor.  No POU is created on disk;
  // we're just routing the user to an existing one.
  const editorModel = createEditorObjectForPou(pou.name, pou.pouType, pou.body.language)
  state.editorActions.addModel(editorModel)
  state.fileActions.addFile({
    name: pou.name,
    type: pou.pouType,
    filePath: pou.name,
    isNew: false,
  })
  state.tabsActions.updateTabs({
    name: pou.name,
    elementType: { type: pou.pouType, language: pou.body.language as 'ld' | 'fbd' | 'sfc' },
  })
  state.tabsActions.setSelectedTab(pou.name)
  state.editorActions.setEditor(editorModel)
  return true
}
