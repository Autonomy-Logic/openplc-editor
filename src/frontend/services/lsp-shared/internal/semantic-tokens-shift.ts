// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Translate the worker's delta-encoded semantic tokens (in
 * full-document coordinates) into Monaco's view-frame.
 *
 *   1. Decode deltas to absolute (line, col) positions.
 *   2. Keep tokens whose line is in `[startLine, endLineExclusive)`.
 *      Both ends are LSP coordinates.
 *   3. Subtract `startLine` from each surviving token's line so the
 *      output is Monaco-relative.
 *   4. Re-encode as a delta stream Monaco can consume directly.
 *
 * Used in two modes by the ST LSP today:
 *   - **Body view**: `startLine = bodyLineOffset` (preamble line count),
 *     `endLineExclusive = ∞` — drop the preamble, keep everything
 *     from the body onwards.
 *   - **Variables-text view**: `startLine = 1` (declaration line count),
 *     `endLineExclusive = bodyLineOffset` of the underlying synthesized
 *     doc — keep only the VAR block region.
 *
 * Python LSP uses only the body-view mode (no variables-text mirror).
 *
 * When `startLine === 0` and `endLineExclusive === ∞` (e.g. early
 * boot before the registry is populated) the function is a copy;
 * cheap enough that the dead branch isn't worth special-casing.
 */
export function shiftSemanticTokensToBody(
  data: number[],
  startLine: number,
  endLineExclusive: number = Number.POSITIVE_INFINITY,
): Uint32Array {
  // Decode to absolute positions.
  const abs: Array<{ line: number; col: number; len: number; type: number; mods: number }> = []
  let absLine = 0
  let absCol = 0
  for (let i = 0; i + 4 < data.length; i += 5) {
    const dLine = data[i]
    const dStart = data[i + 1]
    if (dLine === 0) absCol += dStart
    else {
      absLine += dLine
      absCol = dStart
    }
    abs.push({ line: absLine, col: absCol, len: data[i + 2], type: data[i + 3], mods: data[i + 4] })
  }
  // Re-encode in-range tokens with shifted line numbers.
  const out: number[] = []
  let prevLine = 0
  let prevCol = 0
  for (const t of abs) {
    if (t.line < startLine) continue
    if (t.line >= endLineExclusive) continue
    const shiftedLine = t.line - startLine
    const dLine = shiftedLine - prevLine
    const dStart = dLine === 0 ? t.col - prevCol : t.col
    out.push(dLine, dStart, t.len, t.type, t.mods)
    prevLine = shiftedLine
    prevCol = t.col
  }
  return new Uint32Array(out)
}
