// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Shared program-build pipeline.
 *
 * Mirrors `build-pipeline.ts` (library projects) for the program
 * case: takes already-loaded ST source + options, invokes
 * `strucpp.compile`, and returns the artefacts as in-memory
 * `{ name, content }[]` files plus structured error / warning lists.
 *
 * Why a separate shared module: the same logic is needed by the
 * Electron editor (which writes the result to disk and feeds the
 * cpp files into arduino-cli) and the web editor (which packs the
 * same cpp files into the upload zip).  Keeping it in
 * `backend/editor/compiler/compiler-module.ts` would force a
 * copy-paste when web ports rc1.
 *
 * Constraints that keep this pure:
 *
 *   - No disk I/O — caller does `readFile(program.st)` first and
 *     `writeFile(...)` on each returned entry.  The Electron wrapper
 *     writes them under `build/<target>/src/`; the web wrapper
 *     packs them into a JSZip.
 *
 *   - No MD5 hashing inside — Node has `crypto.createHash('md5')`
 *     and the web has its own hashing (WebCrypto doesn't expose
 *     MD5; web side uses a tiny portable implementation).  Caller
 *     pre-computes the hash and passes it in; strucpp embeds it
 *     into the debug map for stale-layout detection.
 *
 *   - No external-process orchestration — `xml2st` (XML→ST) and
 *     `arduino-cli` (firmware compile) stay in the platform-specific
 *     orchestrator that wraps this pipeline.  This module is purely
 *     about the strucpp invocation slice.
 */
import type * as strucpp from 'strucpp'

import type { KnownPou } from '../utils/PLC/split-program-st'
import { splitProgramSt } from '../utils/PLC/split-program-st'
import { enrichErrorWithPouContext, formatErrorWithPouContext } from './program-build-helpers'
import { loadStrucpp } from './strucpp-runtime'

type StrucppCompileError = strucpp.CompileError
type StrucppLibraries = NonNullable<Parameters<typeof strucpp.compile>[1]>['libraries']

export interface ProgramBuildPipelineOptions {
  /** Full program.st text (or the merged ST source the caller produced). */
  source: string
  /** MD5 hex digest of `source`.  Strucpp embeds it into the debug map
   *  so the editor can detect stale layouts without re-reading the file. */
  md5: string
  /** Project POUs in the order they appear in `source`, used by the
   *  splitter to emit per-POU error file names. */
  pous: KnownPou[]
  /** Pre-loaded `.stlib` archives — bundled + the project-enabled
   *  subset — passed through to strucpp's `libraries:` option. */
  libraries: unknown[]
  /** Names of libraries the project enables but the system pool
   *  doesn't currently have on disk.  Surfaced as a pre-compile
   *  error so the user gets a clear "open the Library Manager"
   *  message instead of strucpp's per-symbol cascade. */
  missingLibraries: string[]
  /** True when the project carries any C/C++ POUs.  Causes every
   *  generated TU to `#include "c_blocks.h"`. */
  hasCBlocks: boolean
}

/** A single artefact the editor should persist (Electron) or pack
 *  into the upload zip (web).  `name` is a relative file name; the
 *  caller prefixes the destination directory. */
export interface ProgramBuildArtefact {
  name: string
  content: string
}

/** One error / warning produced during the pipeline run, paired with
 *  the raw strucpp `CompileError` so the editor's console can drive
 *  click-to-open from the structured fields. */
export interface ProgramBuildDiagnostic {
  formatted: string
  raw: StrucppCompileError
}

export interface ProgramBuildPipelineResult {
  success: boolean
  /** Files to write under the destination build dir.  Includes the
   *  generated.cpp / generated.hpp (or per-POU .cpp files), the
   *  per-POU offset map (`program.st.map.json`), generated_debug.cpp,
   *  and debug-map.json — whatever strucpp produced for this run.
   *  Always empty on failure. */
  files: ProgramBuildArtefact[]
  errors: ProgramBuildDiagnostic[]
  warnings: ProgramBuildDiagnostic[]
  /** Echo of the input MD5 — convenient for the caller that needs
   *  it later (build pipeline manifests, debugger cache keys). */
  md5Hash: string
  /** Info-level log produced when the per-POU splitter falls back to
   *  monolithic compilation (no error, but worth telling the user
   *  because error line numbers won't match Monaco's body view). */
  splitterFallbackMessage: string | null
  /** Info-level "Debug map: N leaves in M arrays" summary when
   *  strucpp emitted a debug map.  `null` otherwise. */
  debugMapSummary: string | null
}

/**
 * Run the strucpp compile pipeline against an already-loaded ST
 * source.  Pure: no disk I/O, no `child_process.spawn`.
 */
export function runProgramBuildPipeline(opts: ProgramBuildPipelineOptions): ProgramBuildPipelineResult {
  const { source, md5, pous, libraries, missingLibraries, hasCBlocks } = opts

  // Pre-compile gate: every library the project enables must be
  // resolvable before strucpp runs.  Without this, the user gets a
  // confusing "function 'X' not found" cascade instead of a clear
  // "library 'Y' is enabled but not installed" message.
  if (missingLibraries.length > 0) {
    const list = missingLibraries.join(', ')
    return {
      success: false,
      files: [],
      errors: [
        {
          formatted:
            `Cannot compile: project enables libraries that are not installed (${list}). ` +
            'Open the Library Manager to install or remove them.',
          raw: {
            message: `Libraries not installed: ${list}`,
            line: 0,
            column: 0,
            severity: 'error',
          },
        },
      ],
      warnings: [],
      md5Hash: md5,
      splitterFallbackMessage: null,
      debugMapSummary: null,
    }
  }

  const {
    compile: strucppCompile,
    formatDiagnostic: strucppFormatDiagnostic,
    buildSourceMap: strucppBuildSourceMap,
  } = loadStrucpp()

  // Try to split program.st into per-POU files so strucpp errors come
  // back with `error.file === '<PouName>.st'` and the new pouName /
  // section / bodyLine fields populated.  Failure is non-fatal: we
  // fall back to monolithic compilation, exactly today's behaviour.
  const split = pous.length > 0 ? splitProgramSt(source, pous) : null
  const splitterFallbackMessage =
    pous.length > 0 && !split
      ? 'ST splitter could not segment program.st; falling back to monolithic compilation. ' +
        'Error line numbers may not match the editor view.'
      : null

  const stFileName = 'program.st'
  // When the project has C/C++ POUs, every per-POU TU may reference the
  // user-defined `<NAME>_VARS` struct and `<name>_setup` / `<name>_loop`
  // extern declarations.  They live in c_blocks.h (generated immediately
  // after this step), so plumb the include through.
  const pouIncludes = hasCBlocks ? ['c_blocks.h'] : []

  let primaryFileName = stFileName
  let primarySource = source
  let additionalSources: { fileName: string; source: string }[] | undefined
  if (split) {
    const entries = [...split.files.entries()]
    // Take the first as primary; rest go through additionalSources.
    // Order doesn't affect compilation correctness — strucpp merges
    // every parsed unit before semantic analysis.
    const [firstName, firstSource] = entries[0]
    primaryFileName = firstName
    primarySource = firstSource
    additionalSources = entries.slice(1).map(([fileName, src]) => ({ fileName, source: src }))
  }

  const result = strucppCompile(primarySource, {
    headerFileName: 'generated.hpp',
    fileName: primaryFileName,
    debug: true,
    lineMapping: true,
    libraries: libraries as StrucppLibraries,
    md5,
    pouIncludes,
    ...(additionalSources ? { additionalSources } : {}),
  })

  // Source map covers every file we fed strucpp, so formatDiagnostic
  // can pull the offending source line whichever per-POU file the
  // error came from.
  const diagFiles = split
    ? [...split.files.entries()].map(([fileName, src]) => ({ fileName, source: src }))
    : [{ fileName: stFileName, source }]
  const diagSourceMap = strucppBuildSourceMap(diagFiles)

  // Per-POU file map so the error enricher can locate `END_VAR` and
  // remap parse-error line numbers into the editor's body / var-block
  // sections.  Only meaningful when the splitter ran — monolithic
  // fallback skips enrichment, which is fine because the only
  // available filename there is `program.st` and there's no per-POU
  // segmentation to remap into.
  const perPouSources = split ? split.files : undefined

  if (!result.success) {
    return {
      success: false,
      files: [],
      errors: result.errors.map((err) => {
        const enriched = enrichErrorWithPouContext(err, pous, perPouSources)
        return {
          formatted: formatErrorWithPouContext(enriched, strucppFormatDiagnostic, diagSourceMap),
          raw: enriched,
        }
      }),
      warnings: result.warnings.map((warn) => {
        const enriched = enrichErrorWithPouContext(warn, pous, perPouSources)
        return {
          formatted: formatErrorWithPouContext(enriched, strucppFormatDiagnostic, diagSourceMap),
          raw: enriched,
        }
      }),
      md5Hash: md5,
      splitterFallbackMessage,
      debugMapSummary: null,
    }
  }

  // Build the artefact list.  Order doesn't matter — the caller
  // writes each entry independently.
  const files: ProgramBuildArtefact[] = []

  // Per-POU split offsets (handy for future iec2c-error remapping on
  // Runtime v3, no current consumer but trivial to produce).
  if (split) {
    const offsets: Record<string, { kind: string; startLine: number; endLine: number }> = {}
    for (const [name, off] of split.pouOffsets) offsets[name] = off
    files.push({
      name: 'program.st.map.json',
      content: JSON.stringify({ pouOffsets: offsets }, null, 2),
    })
  }

  // STruC++ splits the implementation across one TU per POU plus a
  // shared `configuration.cpp`.  The runtime's Makefile picks up
  // every `*.cpp` under core/generated/ via wildcard, so emitting
  // more files just gives `make -j$(nproc)` more parallel work and
  // lets ccache reuse .o files for POUs whose source didn't change.
  // Falling back to `result.cppCode` keeps older strucpp builds (no
  // cppFiles) working — the runtime build sees a single generated.cpp
  // and compiles it serially, exactly as before.
  if (result.cppFiles && result.cppFiles.length > 0) {
    for (const f of result.cppFiles) files.push({ name: f.name, content: f.content })
  } else {
    files.push({ name: 'generated.cpp', content: result.cppCode })
  }
  files.push({ name: 'generated.hpp', content: result.headerCode })

  // Phase 4 debugger artifacts (present starting with strucpp v0.3.0).
  // debugTableCpp is the per-project pointer table for generated_debug.cpp.
  // debugMap is the editor-consumed manifest (path -> (arrayIdx, elemIdx)).
  if (result.debugTableCpp !== undefined) {
    files.push({ name: 'generated_debug.cpp', content: result.debugTableCpp })
  }
  let debugMapSummary: string | null = null
  if (result.debugMap !== undefined) {
    files.push({
      name: 'debug-map.json',
      content: JSON.stringify(result.debugMap, null, 2),
    })
    debugMapSummary = `Debug map: ${result.debugMap.leaves.length} leaves in ${result.debugMap.arrays.length} arrays`
  }

  return {
    success: true,
    files,
    errors: [],
    warnings: result.warnings.map((warn) => {
      const enriched = enrichErrorWithPouContext(warn, pous, perPouSources)
      return {
        formatted: formatErrorWithPouContext(enriched, strucppFormatDiagnostic, diagSourceMap),
        raw: enriched,
      }
    }),
    md5Hash: md5,
    splitterFallbackMessage,
    debugMapSummary,
  }
}
