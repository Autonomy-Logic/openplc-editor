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
/**
 * Strucpp populates `pouName` / `section` / `bodyLine` on errors during
 * its semantic annotation pass.  Parse errors short-circuit that pass:
 * they ship with `file` (the per-POU `.st` filename) and `line`/`column`,
 * but no POU context — so both the editor's bracketed click target
 * (rendered from `formatErrorWithPouContext`) and the navigation hook's
 * `pouName` lookup (see `use-navigate-to-compile-error.ts`) lose their
 * anchor and clicking the diagnostic becomes a no-op.
 *
 * Derive the missing fields from the filename + per-POU source:
 *   - `pouName` / `pouKind` come from matching `err.file` against the
 *     project's known POUs (case-insensitive — strucpp uppercases per
 *     IEC).
 *   - `section` / `bodyLine` come from scanning the synthetic per-POU
 *     `.st` text the splitter handed strucpp.  Body starts on the line
 *     after the last `END_VAR` (or line 2 when the POU has no var
 *     blocks).  Errors before that boundary are tagged `'var-block'`;
 *     errors at/after it are `'body'` with the offset remapped to the
 *     body view's 1-indexed numbering.
 *
 * Returns the error unchanged when there's nothing useful to add
 * (already enriched, no filename, or no matching POU).
 */
export function enrichErrorWithPouContext(
  err: StrucppCompileError,
  pous: KnownPou[],
  perPouSources?: Map<string, string>,
): StrucppCompileError {
  if (err.pouName) return err
  if (!err.file) return err
  const baseName = err.file.replace(/\.st$/i, '')
  const pou = pous.find((p) => p.name.toLowerCase() === baseName.toLowerCase())
  if (!pou) return err

  const enriched: StrucppCompileError = { ...err, pouName: pou.name, pouKind: pou.kind }

  // Case-insensitive filename lookup: strucpp may emit `cvavava.st`
  // (lowercase) while the splitter keyed the map by the project's
  // canonical casing.  Matching pouName already normalised via the
  // pou table lookup above, but the per-POU file map is keyed by the
  // filename string strucpp can echo back in any case the user
  // originally typed.
  let source: string | undefined
  if (perPouSources) {
    const targetKey = err.file.toLowerCase()
    for (const [key, value] of perPouSources) {
      if (key.toLowerCase() === targetKey) {
        source = value
        break
      }
    }
  }
  if (source && err.line > 0) {
    const lines = source.split('\n')
    let lastEndVar = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*END_VAR\b/i.test(lines[i])) lastEndVar = i + 1 // 1-indexed
    }
    // Body starts after the last END_VAR, but the ST generator
    // (`pou-text-serializer.ts` and xml2st on the compile path)
    // inserts blank separator lines between END_VAR and the body
    // content.  Those blank lines exist in the per-POU file the
    // splitter handed strucpp but NOT in `pou.body.value`, which is
    // what the body Monaco editor renders.  Counting them shifts
    // bodyLine past the editor's actual line count and used to
    // surface as `BugIndicatingError: Illegal value for lineNumber`
    // from `getLineMaxColumn` on click-to-navigate.  Scan past any
    // consecutive blank lines to land on the first real body line.
    let bodyStart = lastEndVar > 0 ? lastEndVar + 1 : 2
    while (bodyStart <= lines.length && /^\s*$/.test(lines[bodyStart - 1])) {
      bodyStart++
    }
    if (err.line >= bodyStart) {
      enriched.section = 'body'
      enriched.bodyLine = err.line - bodyStart + 1
    } else if (err.line >= 2) {
      enriched.section = 'var-block'
    }
  }

  return enriched
}

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

/**
 * Platform-agnostic log sink the compile orchestrator hands to
 * `emitCompileErrorEvents`.  Editor and web wire this to their
 * respective channels — Electron's `handleOutputData(text, level,
 * compileError?)` IPC callback, and web's `onProgress({ stage:
 * 'error', message, compileError? })` event bus — by adapting their
 * own signature to this minimal shape inside a one-line closure.
 *
 * Keeping the adapter trivial is the whole point: the iteration
 * pattern + bracketed header + per-error attachment of
 * `compileError` lives in one shared place, while platforms keep
 * full control of how the emission actually reaches the renderer.
 */
export type CompileLogEmit = (message: string, level: 'info' | 'error', compileError?: StrucppCompileError) => void

/**
 * Emit one log entry per error in a failed strucpp pipeline result,
 * with the structured `CompileError` attached to each line.
 *
 * The renderer's console (see `console/log.tsx`) keys click-to-open
 * navigation off `compileError.pouName`.  Joining errors into a
 * single string discards that structured data and breaks the
 * bracketed-prefix click target — every consumer must funnel through
 * here so the shape stays uniform across platforms.
 *
 * Emits a plain "STruC++ compilation failed:" header first (no
 * `compileError` — it's a section break, not navigable), then one
 * event per error carrying `err.raw`.  Callers should pass through
 * the diagnostics exactly as returned by `runProgramBuildPipeline`;
 * no preprocessing is required.
 */
export function emitCompileErrorEvents(
  errors: { formatted: string; raw: StrucppCompileError }[],
  emit: CompileLogEmit,
): void {
  emit('STruC++ compilation failed:', 'error')
  for (const err of errors) {
    // Falsy fallback (`||`) rather than nullish (`??`) so an
    // accidentally-empty `formatted` (defensive, the pipeline never
    // produces one in practice) still surfaces something readable
    // from the raw strucpp message instead of an empty log row.
    emit(err.formatted || err.raw?.message || 'unknown error', 'error', err.raw)
  }
}
