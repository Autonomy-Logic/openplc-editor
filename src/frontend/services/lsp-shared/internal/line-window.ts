// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Bounds of the slice a partial code view (`dtview://`, `pouvars://`)
 * renders, as half-open aggregate-document lines. Absent window means
 * the model owns the whole document, as every body editor does.
 */

import type { TextEdit as LspTextEdit } from 'vscode-languageserver-protocol'

export interface LspLineWindow {
  startLine: number
  endLineExclusive: number
}

export function lspLineInWindow(lspLine: number, lineWindow?: LspLineWindow): boolean {
  if (!lineWindow) return true
  return lspLine >= lineWindow.startLine && lspLine < lineWindow.endLineExclusive
}

/**
 * Edits fully inside the window. A straddling edit is dropped, not
 * truncated: a half-applied range rewrites text the view never shows.
 * One exception: LSP end positions are exclusive, so a whole-line edit
 * on the window's LAST line may legitimately end at
 * `{endLineExclusive, 0}` (line plus its newline). That edit is kept,
 * clamped back inside the window so the newline seam is never touched.
 */
export function clipEditsToWindow(edits: LspTextEdit[], lineWindow?: LspLineWindow): LspTextEdit[] {
  if (!lineWindow) return edits
  const clipped: LspTextEdit[] = []
  for (const e of edits) {
    if (e.range.start.line < lineWindow.startLine) continue
    if (e.range.end.line < lineWindow.endLineExclusive) {
      clipped.push(e)
      continue
    }
    if (e.range.end.line === lineWindow.endLineExclusive && e.range.end.character === 0) {
      clipped.push({
        ...e,
        range: {
          start: e.range.start,
          end: { line: lineWindow.endLineExclusive - 1, character: Number.MAX_SAFE_INTEGER },
        },
        newText: e.newText.endsWith('\n') ? e.newText.slice(0, -1) : e.newText,
      })
    }
  }
  return clipped
}

/**
 * True when the model's rendering of the window matches the LSP
 * document's own lines. Formatting edits carry columns computed
 * against the LSP document, so a drifted buffer must not apply them.
 */
export function modelMatchesDocumentWindow(
  modelText: string,
  documentText: string,
  lineOffset: number,
  lineWindow: LspLineWindow,
): boolean {
  const modelLines = modelText.split(/\r?\n/)
  const documentLines = documentText.split(/\r?\n/)
  const modelStart = lineWindow.startLine - lineOffset
  if (modelStart < 0) return false
  for (let i = 0; i < lineWindow.endLineExclusive - lineWindow.startLine; i++) {
    if (modelLines[modelStart + i] !== documentLines[lineWindow.startLine + i]) return false
  }
  return true
}
