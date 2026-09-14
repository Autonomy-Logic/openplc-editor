// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Coordinate helpers for the `pouvars://` code view.
 *
 * The view renders a POU's VAR blocks only, while strucpp sees the whole
 * synthesized document: declaration line, VAR blocks, body. The VAR
 * blocks sit on document lines `[POU_DECLARATION_LINE_COUNT, bodyLineOffset)`,
 * and everything crossing that seam is shifted by the declaration line.
 *
 * Takes texts and offsets rather than reading the store or Monaco, so the
 * arithmetic is testable on its own — same reason as `dtview-context.ts`.
 */

import type { Diagnostic } from 'vscode-languageserver-protocol'

import { lspLineInWindow, type LspLineWindow, modelMatchesDocumentLines } from '../lsp-shared/internal/line-window'
import { POU_DECLARATION_LINE_COUNT } from './types'

export interface PouVarsTokenViewport {
  startLine: number
  endLineExclusive: number
  keepLine?: (lspLine: number) => boolean
}

const EMPTY_VIEWPORT: PouVarsTokenViewport = { startLine: 0, endLineExclusive: 0 }

/**
 * Document lines the view renders, or null while project-sync has not
 * registered the body line yet — an unpopulated registry reads 0.
 */
export function pouVarsWindow(bodyLineOffset: number): LspLineWindow | null {
  if (bodyLineOffset <= POU_DECLARATION_LINE_COUNT) return null
  return { startLine: POU_DECLARATION_LINE_COUNT, endLineExclusive: bodyLineOffset }
}

/** The published diagnostics that fall inside the VAR blocks. */
export function diagnosticsInVarBlocks(diagnostics: Diagnostic[], bodyLineOffset: number): Diagnostic[] {
  const varsWindow = pouVarsWindow(bodyLineOffset)
  if (!varsWindow) return []
  return diagnostics.filter((d) => lspLineInWindow(d.range.start.line, varsWindow))
}

/**
 * Semantic-token window for the view. Tokens describe the synced document,
 * so a line keeps its colours only while the buffer still shows that
 * document's text for it: an uncommitted edit blanks the lines it moved and
 * nothing else. No colours beats colours describing the previous text.
 */
export function pouVarsTokenViewport(
  modelText: string | undefined,
  documentText: string | undefined,
  bodyLineOffset: number,
): PouVarsTokenViewport {
  const varsWindow = pouVarsWindow(bodyLineOffset)
  if (!varsWindow || modelText === undefined || documentText === undefined) return EMPTY_VIEWPORT
  return { ...varsWindow, keepLine: modelMatchesDocumentLines(modelText, documentText, POU_DECLARATION_LINE_COUNT) }
}
