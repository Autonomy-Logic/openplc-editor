// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Go-to-definition redirect for variable declarations and cross-POU
 * targets.
 *
 * The LSP returns positions in the *full* serialized document — the
 * synthesized declaration line + VAR blocks + body — but Monaco's
 * body editor only displays the body, and the VAR blocks live in a
 * separate variables panel.  Letting Monaco navigate to a preamble
 * position lands the cursor on line 1 of the body (clamped from a
 * negative line number), which is wrong.
 *
 * Strategy: intercept LSP `Definition` results.  If a target points
 * into a POU's preamble (`line < bodyOffset`), open that POU's tab,
 * force-switch the variables panel into text mode, and jump the
 * variables-code-editor caret to the declaration line.  If a target
 * points into a different POU's body, open that POU's tab and place
 * the body cursor — the registered model means Monaco's own peek
 * widget could do this too, but going through the store keeps the
 * tab list and "available editors" set consistent.
 *
 * Returns `true` when the redirect handled navigation (caller should
 * cancel Monaco's default).  Returns `false` for targets the redirect
 * can't resolve (unknown URI, missing POU, etc.) so the caller falls
 * back to Monaco's default behaviour.
 */

import type { Location, LocationLink } from 'vscode-languageserver-protocol'

import type { PLCDataType } from '../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../store'
import { CreateEditorObjectFromTab } from '../../store/slices/tabs/utils'
import { getBodyLineOffset } from './body-offsets'
import { DATA_TYPES_URI, parsePouUri } from './types'

interface NavTarget {
  uri: string
  lineLsp: number
  characterLsp: number
}

function normaliseLocation(loc: Location | LocationLink): NavTarget {
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

/**
 * Resolve a POU name to a TabsProps shape so we can hand it through
 * the existing `addTab` / `CreateEditorObjectFromTab` path the
 * project tree uses.  Returns null when the POU isn't known —
 * caller falls back to Monaco's default navigation.
 */
type TabLanguage = 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'

function buildTabPropsForPou(name: string):
  | Parameters<typeof CreateEditorObjectFromTab>[0]
  | null {
  const state = openPLCStoreBase.getState()
  const pou = state.project.data.pous.find((p) => p.name === name)
  if (!pou) return null

  // `pou.body.language` can carry either the uppercase
  // `PLCLanguage` variant ('IL'/'ST'/…) or the lowercase form
  // depending on the import path — the tabs slice only accepts the
  // lowercase set, matching what the project tree passes when it
  // opens a POU.  Mirror the cast `use-navigate-to-compile-error`
  // does so both paths produce the same tab shape.
  const language = pou.body.language as TabLanguage
  const elementType =
    pou.pouType === 'program'
      ? ({ type: 'program' as const, language })
      : pou.pouType === 'function'
        ? ({ type: 'function' as const, language })
        : ({ type: 'function-block' as const, language })

  return {
    name: pou.name,
    path: '', // unused by editor model creation
    elementType,
  }
}

function openPouEditor(name: string): boolean {
  const tabProps = buildTabPropsForPou(name)
  if (!tabProps) return false
  const {
    editorActions: { setEditor, addModel, getEditorFromEditors },
    tabsActions: { updateTabs, setSelectedTab },
  } = openPLCStoreBase.getState()

  updateTabs(tabProps)
  const existing = getEditorFromEditors(name)
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
  setSelectedTab(name)
  return true
}

/**
 * Try to handle a Definition result by routing through the Zustand
 * store.  Returns true iff navigation was performed (in which case
 * Monaco should NOT navigate to the location).
 */
/**
 * Number of lines a single data type takes inside the serialized
 * `TYPE…END_TYPE` document.  Mirrors `serializeDataTypesToST` —
 * enumerated and array each render as one indented line, structures
 * span the declaration line + one per field + an `END_STRUCT;` line.
 * The map is used to locate which data type an LSP line falls into
 * when we route a datatypes-URI Definition target through the store.
 */
function dataTypeLineCount(dt: PLCDataType): number {
  if (dt.derivation === 'enumerated') return 1
  if (dt.derivation === 'array') return 1
  if (dt.derivation === 'structure') return 2 + (dt.variable?.length ?? 0)
  return 0
}

/**
 * Map an LSP line in the synthesized datatypes document to the
 * `PLCDataType` whose entry occupies that line.  Returns null when
 * the line falls on the `TYPE` / `END_TYPE` framing lines or beyond
 * the last entry — caller treats that as "not navigable".
 */
function findDataTypeAtLine(lspLine: number, dataTypes: PLCDataType[]): PLCDataType | null {
  // Synthesized doc: line 0 is `TYPE`, entries start at line 1.
  if (lspLine < 1) return null
  let cursor = 1
  for (const dt of dataTypes) {
    const span = dataTypeLineCount(dt)
    if (span === 0) continue
    if (lspLine >= cursor && lspLine < cursor + span) {
      return dt
    }
    cursor += span
  }
  return null
}

/**
 * Open the Data Type editor for `dataType`, mirroring the
 * project-tree click path (updateTabs + addModel + setEditor +
 * setSelectedTab).  Returns true on success; false if no tab can be
 * built (defensive — shouldn't happen for a known PLCDataType).
 */
function openDataTypeEditor(dataType: PLCDataType): boolean {
  const tabProps: Parameters<typeof CreateEditorObjectFromTab>[0] = {
    name: dataType.name,
    path: '',
    elementType: { type: 'data-type', derivation: dataType.derivation },
  }
  const {
    editorActions: { setEditor, addModel, getEditorFromEditors },
    tabsActions: { updateTabs, setSelectedTab },
  } = openPLCStoreBase.getState()
  updateTabs(tabProps)
  const existing = getEditorFromEditors(dataType.name)
  if (existing) {
    addModel(existing)
    setEditor(existing)
  } else {
    const model = CreateEditorObjectFromTab(tabProps)
    addModel(model)
    setEditor(model)
  }
  setSelectedTab(dataType.name)
  return true
}

export function redirectDefinitionToStore(loc: Location | LocationLink): boolean {
  const target = normaliseLocation(loc)

  // Datatypes URI → open the matching data-type editor tab.  The LSP
  // emits this URI for every reference into the synthesized
  // TYPE…END_TYPE block (enum members, struct fields, array element
  // types).  Monaco has no editor host for that URI, so without this
  // branch the redirect would dead-end silently.
  if (target.uri === DATA_TYPES_URI) {
    const dataTypes = openPLCStoreBase.getState().project.data.dataTypes
    const dt = findDataTypeAtLine(target.lineLsp, dataTypes)
    if (!dt) return false
    openDataTypeEditor(dt)
    return true
  }

  const parsed = parsePouUri(target.uri)
  if (!parsed) return false

  const bodyOffset = getBodyLineOffset(target.uri)
  // LSP line 0 of any POU's synthesized doc is the `PROGRAM` /
  // `FUNCTION` / `FUNCTION_BLOCK` declaration — that's where strucpp
  // points "Go to Definition" for a POU type name reference (e.g.
  // clicking on `Manual_Override` in `inst : Manual_Override;`).
  // Variable declarations sit on LSP lines 1..bodyOffset-1.  Treating
  // line 0 the same as a variable would force the target POU's
  // variables panel into text mode with no useful position to land
  // on — and on first open the panel renders empty because the
  // VariablesEditor state initialises from an empty `tableData`.
  // Open the tab and let the editor settle into its natural default
  // (variables in table mode, cursor at body line 1).
  const isPouDeclaration = target.lineLsp === 0
  const isInPreamble = target.lineLsp < bodyOffset

  if (!openPouEditor(parsed.name)) return false

  if (isPouDeclaration) {
    // openPouEditor already brought the tab to the front and the
    // editor model defaults to `variable.display: 'table'`; no
    // cursor jump is meaningful for "click on the POU name itself".
    return true
  }

  const {
    editorActions: { setEditorCursor, updateModelVariablesForName },
  } = openPLCStoreBase.getState()

  if (isInPreamble) {
    // The variables-code-editor renders only the VAR blocks (the
    // synthesized declaration line is not part of its model).
    // Subtract 1 (the declaration's single line) to translate LSP
    // 0-indexed line → variables editor LSP frame, then +1 to get
    // Monaco's 1-indexed line.  Net: lspLine - 1 + 1 = lspLine.
    const monacoLine = Math.max(1, target.lineLsp)
    const column = Math.max(1, target.characterLsp + 1)
    updateModelVariablesForName(parsed.name, { display: 'code' })
    setEditorCursor(parsed.name, {
      lineNumber: monacoLine,
      column,
      offset: 0,
      target: 'variables',
    })
    return true
  }

  // Body target — shift the LSP line into Monaco's body-relative
  // frame and let the body editor's reactive cursorPosition effect
  // do the highlight.
  const monacoLine = Math.max(1, target.lineLsp - bodyOffset + 1)
  const column = Math.max(1, target.characterLsp + 1)
  setEditorCursor(parsed.name, {
    lineNumber: monacoLine,
    column,
    offset: 0,
    target: 'body',
  })
  return true
}
