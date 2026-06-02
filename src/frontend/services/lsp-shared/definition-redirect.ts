// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Go-to-definition routing primitives shared by every language
 * service.
 *
 * Each LSP integration parses its own URI scheme (ST has a
 * synthetic `pou://` family + a datatypes URI; Python uses the
 * real `file://` URI Monaco hands it) and decides what *kind* of
 * navigation a Definition target represents — a POU body line, a
 * variables-panel preamble line, or just the POU's tab.  Once
 * that's decided, the actual store actions to open the tab,
 * switch the variables panel to code mode and place the cursor
 * are identical across languages.  This module owns those
 * actions; language services compose them.
 *
 * Why pull this out: the variables-panel-code-mode text is now
 * unified between the Python LSP preamble and the
 * variables-code-editor (see `synthesizeVariablesText`).  That
 * means line N in Pyright IS line N in the variables-code-editor
 * for Python POUs, just like ST's synthesised VAR-block text
 * already aligns with the ST LSP's preamble.  The routing math
 * collapses to identity in both cases; the only divergence left
 * is "which POU did the URI point at?", which is what each
 * service's URI parser answers.
 */

import type { Location, LocationLink } from 'vscode-languageserver-protocol'

import { openPLCStoreBase } from '../../store'
import { CreateEditorObjectFromTab } from '../../store/slices/tabs/utils'

export interface NavTarget {
  uri: string
  lineLsp: number
  characterLsp: number
}

/**
 * Collapse LSP's three definition response shapes (`Location`,
 * `Location[]`, `LocationLink[]`) into a uniform `NavTarget`.
 * Callers that get `Location[]` walk the array themselves and
 * pass each entry through here.
 */
export function normaliseLocation(loc: Location | LocationLink): NavTarget {
  if ('targetUri' in loc) {
    const range = loc.targetSelectionRange ?? loc.targetRange
    return { uri: loc.targetUri, lineLsp: range.start.line, characterLsp: range.start.character }
  }
  return {
    uri: loc.uri,
    lineLsp: loc.range.start.line,
    characterLsp: loc.range.start.character,
  }
}

type TabLanguage = 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'

function buildTabPropsForPou(name: string): Parameters<typeof CreateEditorObjectFromTab>[0] | null {
  const state = openPLCStoreBase.getState()
  const pou = state.project.data.pous.find((p) => p.name === name)
  if (!pou) return null

  // `pou.body.language` carries either the uppercase `PLCLanguage`
  // variant ('IL'/'ST'/…) or the lowercase form depending on the
  // import path — the tabs slice only accepts the lowercase set.
  // Mirror the cast the project tree + compile-error navigation
  // already use so all three paths produce identical tab shapes.
  const language = pou.body.language as TabLanguage
  const elementType =
    pou.pouType === 'program'
      ? { type: 'program' as const, language }
      : pou.pouType === 'function'
        ? { type: 'function' as const, language }
        : { type: 'function-block' as const, language }

  return {
    name: pou.name,
    path: '', // unused by editor model creation
    elementType,
  }
}

/**
 * Open the POU's tab and bring it to the front.  Returns true on
 * success, false when the POU isn't in the project store — caller
 * should fall back to Monaco's default navigation (or, in the
 * Python LSP's case, to the same suppression we use when no
 * definition is reachable).
 */
export function routeToPou(pouName: string): boolean {
  const tabProps = buildTabPropsForPou(pouName)
  if (!tabProps) return false
  const {
    editorActions: { setEditor, addModel, getEditorFromEditors },
    tabsActions: { updateTabs, setSelectedTab },
  } = openPLCStoreBase.getState()

  updateTabs(tabProps)
  const existing = getEditorFromEditors(pouName)
  if (existing) {
    addModel(existing)
    setEditor(existing)
  } else {
    const model = CreateEditorObjectFromTab(tabProps)
    addModel(model)
    setEditor(model)
  }
  // Match the compile-error hook's pattern — bring the tab to the
  // front so the user actually sees the target POU.
  setSelectedTab(pouName)
  return true
}

/**
 * Open the POU's tab + switch its variables panel to code mode +
 * place the variables-code-editor cursor at the given position.
 *
 * `monacoLine` / `monacoColumn` are 1-indexed.  The caller has
 * already translated from LSP-space to whatever frame the
 * variables-code-editor renders in:
 *
 *   - ST POUs: the variables-code-editor shows the synthesised VAR
 *     blocks starting at line 1, so the LSP frame's `line` matches
 *     the Monaco frame's `lineNumber` after the conventional
 *     `lspLine - 1 + 1 = lspLine` swap.
 *   - Python POUs (after `synthesizeVariablesText` unification):
 *     the variables-code-editor renders the same module-globals
 *     preamble Pyright sees, so the LSP line maps directly with
 *     just the 0-indexed → 1-indexed shift: `lspLine + 1`.
 *
 * Returns true on success.
 */
export function routeToPouPreamble(pouName: string, monacoLine: number, monacoColumn: number): boolean {
  if (!routeToPou(pouName)) return false
  const {
    editorActions: { setEditorCursor, updateModelVariablesForName },
  } = openPLCStoreBase.getState()
  updateModelVariablesForName(pouName, { display: 'code' })
  setEditorCursor(pouName, {
    lineNumber: Math.max(1, monacoLine),
    column: Math.max(1, monacoColumn),
    offset: 0,
    target: 'variables',
  })
  return true
}

/**
 * Open the POU's tab + place the body editor cursor.  Same shape
 * as `routeToPouPreamble`; differs only in the cursor `target`
 * (`'body'` instead of `'variables'`) and in not toggling the
 * variables panel.  Caller translates LSP→Monaco coordinates.
 */
export function routeToPouBody(pouName: string, monacoLine: number, monacoColumn: number): boolean {
  if (!routeToPou(pouName)) return false
  const {
    editorActions: { setEditorCursor },
  } = openPLCStoreBase.getState()
  setEditorCursor(pouName, {
    lineNumber: Math.max(1, monacoLine),
    column: Math.max(1, monacoColumn),
    offset: 0,
    target: 'body',
  })
  return true
}
