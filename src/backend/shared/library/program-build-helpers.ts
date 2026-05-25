// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Pure helpers shared by every program-build orchestrator.
 *
 * Three things lived inside `backend/editor/compiler/compiler-module.ts`
 * but never touched a Node API.  Centralising them here lets the
 * upcoming web compile adapter call the same helpers without
 * duplicating the implementation across `backend/editor/` and the
 * web's eventual analogue.
 *
 *   - `buildKnownPous`: maps the project's `PLCPou[]` to strucpp's
 *     `KnownPou[]` descriptor used by `splitProgramSt`.  Two
 *     copy-pasted blocks in `compileProgram` / `compileForDebugger`
 *     collapse into one call.
 *
 *   - `formatErrorWithPouContext`: wraps strucpp's gcc-style
 *     diagnostic with the POU / section / body-line context the
 *     editor's click-to-open console relies on.  Pure formatter.
 */
import type * as strucpp from 'strucpp'

import type { PLCPou } from '../types/PLC/open-plc'
import type { KnownPou } from '../utils/PLC/split-program-st'

type StrucppCompileError = strucpp.CompileError
type StrucppFormatDiagnostic = typeof strucpp.formatDiagnostic
type StrucppSourceMap = ReturnType<typeof strucpp.buildSourceMap>

/**
 * Map project POUs to the descriptor `splitProgramSt` expects.
 * Centralised here because two compiler-module call sites (the
 * program build + the debug build) constructed identical inline
 * mappings.
 */
export function buildKnownPous(pous: PLCPou[]): KnownPou[] {
  return pous.map((p) => ({
    name: p.data.name,
    kind:
      p.type === 'program'
        ? ('PROGRAM' as const)
        : p.type === 'function'
          ? ('FUNCTION' as const)
          : ('FUNCTION_BLOCK' as const),
    language: p.data.language as KnownPou['language'],
  }))
}

/**
 * Wrap strucpp's plain `(file:line:col)` diagnostic with the POU /
 * section context the new `CompileError` fields carry, so the editor's
 * console shows something the user can act on:
 *
 *     [Manual_Override / body line 7] Cannot assign WSTRING to BOOL
 *
 * For var-block errors with a known variable name, surface that
 * instead of the raw line number — the variables-table view doesn't
 * always show line numbers (table mode), and a name is more
 * actionable. Falls back to plain `formatDiagnostic` when none of the
 * new fields are populated (e.g. errors in synthetic _types.st /
 * _config.st sections, or before the splitter ran).
 */
export function formatErrorWithPouContext(
  err: StrucppCompileError,
  formatDiagnostic: StrucppFormatDiagnostic,
  sourceMap: StrucppSourceMap,
): string {
  // `preferBodyLine: true` makes strucpp's gcc-style formatter render
  // body errors with the body-relative line in both the header column
  // and the snippet gutter, matching the Monaco body view the user
  // sees and the bracketed `[POU / body line N]` prefix we render
  // alongside.  Var-block errors and non-POU errors are unaffected.
  // CLI and vscode-extension callers don't pass this flag, so their
  // long-standing absolute-file-line output is preserved.
  const base = formatDiagnostic(err, sourceMap, { preferBodyLine: true })
  if (!err.pouName) return base
  let prefix: string
  if (err.section === 'body' && err.bodyLine !== undefined) {
    prefix = `[${err.pouName} / body line ${err.bodyLine}]`
  } else if (err.section === 'var-block') {
    prefix = err.variableName
      ? `[${err.pouName} / variable ${err.variableName}]`
      : `[${err.pouName} / variables, line ${err.line}]`
  } else {
    prefix = `[${err.pouName}]`
  }
  return `${prefix}\n${base}`
}
