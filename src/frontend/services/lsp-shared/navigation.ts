// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Where navigation actually happens.
 *
 * The providers answer "where is this?" and nothing more. The tab switch,
 * view toggle and cursor placement run only from here, on a real
 * activation: Monaco asking to open a target (Ctrl/Cmd+click, F12, the
 * peek widget), or a Go to Symbol entry being accepted. Ctrl+hover resolves
 * definitions to draw its link and preview and never reaches this file.
 */

import type * as monaco from 'monaco-editor'

import { getBodyLineOffset } from './body-offsets'
import type { NavTarget } from './definition-redirect'
import { parseLspMirrorUri } from './lsp-mirror'

/** Route `target` (LSP coordinates) into the application; true when handled. */
export type NavigateToTarget = (target: NavTarget) => boolean

/**
 * The LSP target behind a resource Monaco wants opened. A mirror URI
 * carries LSP coordinates as they are; a body model's line is
 * body-relative and shifts back by its document's preamble.
 */
export function navTargetForResource(resourceUri: string, position: monaco.IPosition): NavTarget {
  const mirrored = parseLspMirrorUri(resourceUri)
  if (mirrored !== null) {
    return { uri: mirrored, lineLsp: position.lineNumber - 1, characterLsp: position.column - 1 }
  }
  return {
    uri: resourceUri,
    lineLsp: position.lineNumber - 1 + getBodyLineOffset(resourceUri),
    characterLsp: position.column - 1,
  }
}

function startOf(selectionOrPosition?: monaco.IRange | monaco.IPosition): monaco.IPosition {
  if (!selectionOrPosition) return { lineNumber: 1, column: 1 }
  if ('startLineNumber' in selectionOrPosition) {
    return { lineNumber: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
  }
  return selectionOrPosition
}

/**
 * Handle Monaco's "open this target" for one language service. A target
 * inside the source model itself is left to Monaco, a plain in-editor
 * jump; everything else is `navigate`d. Openers run before Monaco's
 * default and in any order, so one that does not own the URI returns
 * false and the request moves on.
 */
export function registerDefinitionOpener(monacoApi: typeof monaco, navigate: NavigateToTarget): monaco.IDisposable {
  return monacoApi.editor.registerEditorOpener({
    openCodeEditor(source, resource, selectionOrPosition) {
      const resourceUri = resource.toString()
      if (source.getModel()?.uri.toString() === resourceUri) return false
      // True names the source editor as the target too, so Monaco flashes its
      // symbol highlight there at the target's range. Cosmetic, inherent to an opener.
      return navigate(navTargetForResource(resourceUri, startOf(selectionOrPosition)))
    },
  })
}

// ---------------------------------------------------------------------------
// Outline entries that point outside the model
// ---------------------------------------------------------------------------

/** No real line is this wide, so a column past it can only be a bound entry. */
export const OUTLINE_TARGET_COLUMN_BASE = 1 << 20

interface OutlineBinding {
  target: NavTarget
  navigate: NavigateToTarget
}

const outlineBindings = new Map<string, OutlineBinding[]>()

/** Forget the bindings of `modelUri` before a provider lists them afresh. */
export function resetOutlineTargets(modelUri: string): void {
  outlineBindings.delete(modelUri)
}

/**
 * Give an outline entry that points outside the model a range Monaco can
 * hold, and remember where it really points. The range sits on `line`
 * with a column past any real text: accepting the entry is recognisable
 * in `setSelection`, and previewing it reveals nothing but that line.
 */
export function bindOutlineTarget(
  modelUri: string,
  line: number,
  target: NavTarget,
  navigate: NavigateToTarget,
): monaco.IRange {
  let bindings = outlineBindings.get(modelUri)
  if (!bindings) {
    bindings = []
    outlineBindings.set(modelUri, bindings)
  }
  const column = OUTLINE_TARGET_COLUMN_BASE + bindings.length
  bindings.push({ target, navigate })
  return { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column }
}

/** The binding a Go to Symbol accept encoded into `range`, if any. */
export function outlineBindingFor(modelUri: string, range: monaco.IRange): OutlineBinding | null {
  const index = range.startColumn - OUTLINE_TARGET_COLUMN_BASE
  if (index < 0) return null
  return outlineBindings.get(modelUri)?.[index] ?? null
}

/** Monaco's `TextEditorSelectionSource.JUMP`, the source Go to Symbol selects with. */
const JUMP_SOURCE = 'code.jump'

const activatedApis = new WeakSet<typeof monaco>()

/**
 * Go to Symbol accepts an entry by selecting its range with the jump
 * source. Catch that on every editor and, when the range is a bound one,
 * navigate instead of selecting: the real target lives in a document
 * this editor does not render. Installed once per Monaco namespace, for
 * the life of the page.
 */
export function attachOutlineActivation(monacoApi: typeof monaco): void {
  if (activatedApis.has(monacoApi)) return
  activatedApis.add(monacoApi)
  const patch = (editor: monaco.editor.ICodeEditor) => {
    const original = editor.setSelection.bind(editor)
    editor.setSelection = (
      selection: monaco.IRange | monaco.Range | monaco.ISelection | monaco.Selection,
      source?: string,
    ) => {
      if (!('startLineNumber' in selection)) {
        original(selection, source)
        return
      }
      if (source === JUMP_SOURCE) {
        const modelUri = editor.getModel()?.uri.toString()
        const binding = modelUri ? outlineBindingFor(modelUri, selection) : null
        if (binding && binding.navigate(binding.target)) return
      }
      original(selection, source)
    }
  }
  for (const editor of monacoApi.editor.getEditors()) patch(editor)
  monacoApi.editor.onDidCreateEditor(patch)
}
