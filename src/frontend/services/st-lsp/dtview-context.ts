// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Coordinate translation between a `.dt` code view and the aggregate
 * datatypes document.
 *
 * A `.dt` view renders one type under its own `TYPE` frame line, while
 * strucpp only ever sees `DATA_TYPES_URI` — every type in one document,
 * under one frame. So the two frames differ by the type's position in
 * the aggregate, and every request crossing the seam has to be shifted
 * by it.
 *
 * These helpers take `dataTypes` rather than reading the store, so the
 * arithmetic is testable on its own — the seam is where the token and
 * marker defects in DOPE-537 came from.
 */

import type { Diagnostic } from 'vscode-languageserver-protocol'

import type { PLCDataType } from '../../../middleware/shared/ports/types'
import { type DataTypeLineSpan, dataTypeLineSpans } from '../../utils/PLC/data-type-serializer'
import { DT_VIEW_FRAME_LINE_COUNT } from './types'

/** The aggregate document's line span for `dtName`, or null if it has none. */
export function dtViewSpan(dataTypes: PLCDataType[], dtName: string): DataTypeLineSpan | null {
  return dataTypeLineSpans(dataTypes).get(dtName) ?? null
}

/**
 * Lines to add to a `.dt` view position to reach the aggregate document.
 * Both frames open with a `TYPE` line, so the shift is the entry's start
 * minus that frame — 0 for the first type.
 */
export function dtViewLineOffset(span: DataTypeLineSpan): number {
  return span.start - DT_VIEW_FRAME_LINE_COUNT
}

/**
 * Aggregate-document line window backing the view. Holds the entry's own
 * lines only — widening it to cover the view's `TYPE` frame would pull in
 * the previous entry's last line, whose columns overrun that 4-character
 * frame line.
 */
export function dtViewWindow(span: DataTypeLineSpan): { startLine: number; endLineExclusive: number } {
  return { startLine: span.start, endLineExclusive: span.start + span.length }
}

/** The published diagnostics that fall inside the entry's own lines. */
export function diagnosticsInSpan(diagnostics: Diagnostic[], span: DataTypeLineSpan): Diagnostic[] {
  const { startLine, endLineExclusive } = dtViewWindow(span)
  return diagnostics.filter((d) => d.range.start.line >= startLine && d.range.start.line < endLineExclusive)
}
