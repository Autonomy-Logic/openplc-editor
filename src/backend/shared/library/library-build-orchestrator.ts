// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Shared library-build orchestrator.
 *
 * Single source of truth for the `.stlib` compilation flow.  Both
 * desktop and web drive this function through their own
 * `LibraryBuildPort` implementation; every decision, every event,
 * every file name, every error message is owned by this module.  The
 * port carries only the IO primitives (read / write / delete project
 * files, resolve library archives) — anything that looks like
 * business logic stays here, by design.
 *
 * Stages:
 *
 *   0. Read `library.json` manifest.
 *   1. Validate manifest + stub the project for the transpiler
 *      (via shared `prepareXmlForLibraryBuild`).
 *   2. Project IR → program.st (via `LibraryBuildPort.transpileToSt`).
 *      The ST lives in memory only — no intermediate file persistence
 *      (see path-constants comment).
 *   3. Resolve project-enabled library archives + fail on missing
 *      names.
 *   4. Gather `pouDocs` from the project data, and read the authored
 *      C/C++ / Python POU files off disk for strucpp to carry verbatim.
 *   5. strucpp compile via `libraryBuildFromTranspiledSt`.
 *   6. Write `.stlib` archive to `build/{name}.stlib`.
 *
 * The build is deliberately TARGET-NEUTRAL.  It used to end with an
 * avr-gcc verification compile against the OpenPLC Simulator board,
 * which meant every library was judged by whether its generated C++
 * links on an ATmega2560 — a board most libraries never run on, and a
 * ~30 s tax on every clean build.  Worse, the project it verified
 * instantiated nothing (its whole body was `LocalVar := 3;`), so it
 * never said anything about whether the library behaves.  Running a
 * library is now its own action: `composeLibraryDebugHarness` builds
 * a project that instantiates every block and drives it through the
 * simulator with the debugger attached.  strucpp's `compileStlib` is
 * what still fails a bad build.
 *
 * The orchestrator returns a structured result; the adapter wraps it
 * in whatever transport it owns (IPC port message on desktop, Promise
 * resolution on web).  See `LibraryBuildPort` for the contract the
 * adapter implements.
 */

import type { LibraryBuildPort } from '../../../middleware/shared/ports/library-build-port'
import type { CompileLibraryResult } from '../../../middleware/shared/ports/types'
import type { PLCProject, PLCProjectData } from '../types/PLC/open-plc'
import { libraryBuildFromTranspiledSt, type LibraryNativeSource, prepareXmlForLibraryBuild } from './build-pipeline'
import type { NativePouRef } from './native-pou-list'

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface LibraryBuildEvent {
  message: string
  level: 'info' | 'warning' | 'error'
}

export interface LibraryBuildArgs {
  /** Project root path (platform-shaped — desktop fs path, web project
   *  id / S3 prefix).  Passed through to the port verbatim; the port
   *  decides how to interpret it. */
  projectPath: string
  /** Build-pass project data: Python POUs lowered to runtime ST, C/C++
   *  POUs replaced by stubs with the originals on `originalCppPous`. */
  projectData: PLCProjectData
  /** Native (C/C++, Python) POUs, collected from the project data BEFORE
   *  `preprocessPous` ran — see `collectNativePous`. The pipeline cannot
   *  derive this itself: by the time it sees `projectData`, every native body
   *  has been lowered to bridge ST and the language tag rewritten with it, so
   *  nothing identifies a native POU any more. Omitted or empty means the
   *  project has none. */
  nativePous?: NativePouRef[]
}

// Standard project-relative paths the orchestrator owns.  Centralised
// here so adapters never hardcode them — both platforms write to the
// same project-relative locations, which is what makes a desktop-
// produced project tree byte-identical to a web-produced one.
//
// Intermediate files (plc.xml, program.st) are deliberately NOT
// persisted.  They're transient artifacts that exist only between
// `prepareXmlForLibraryBuild` and `libraryBuildFromTranspiledSt` —
// passing them through the port would force every platform to spend
// a round-trip on data nobody reads after the build finishes.  The
// user-visible `.stlib` artifact is the only thing this pipeline
// writes to the project tree.
const LIBRARY_MANIFEST_REL_PATH = 'library.json'
const STLIB_OUT_DIR = 'build'

/**
 * Run the full library-build pipeline.  Pure with respect to its
 * arguments — every side effect funnels through `port` or `emit`.
 *
 * The result mirrors the existing `CompileLibraryResult` shape so the
 * desktop's MessagePort wrapper and the web adapter both surface the
 * same structure to the renderer.  `success: false` from this function
 * is a fatal build error.
 */
export async function runLibraryBuildPipeline(
  args: LibraryBuildArgs,
  port: LibraryBuildPort,
  emit: (event: LibraryBuildEvent) => void,
): Promise<CompileLibraryResult> {
  const { projectPath, projectData, nativePous = [] } = args

  emit({ message: 'Starting library build...', level: 'info' })

  // -------------------------------------------------------------------------
  // Stage 0: read library.json manifest
  // -------------------------------------------------------------------------
  let manifestJson: string | null
  try {
    manifestJson = await port.readBuildFile(projectPath, LIBRARY_MANIFEST_REL_PATH)
  } catch (error) {
    return fail(emit, `Could not read library.json: ${formatError(error)}`)
  }
  if (manifestJson === null) {
    return fail(emit, 'Could not read library.json: file missing from project')
  }

  // -------------------------------------------------------------------------
  // Stage 1: manifest validation + XML generation
  // -------------------------------------------------------------------------
  const project: PLCProject = {
    meta: { name: '', type: 'plc-library' },
    data: projectData,
  }
  const stage1 = prepareXmlForLibraryBuild(project, manifestJson)
  if ('error' in stage1) {
    return fail(emit, stage1.error)
  }
  const { projectData: stubbedData, knownPous, manifest } = stage1
  emit({ message: `Manifest OK — building "${manifest.name}" v${manifest.version}.`, level: 'info' })

  // -------------------------------------------------------------------------
  // Stage 2: project → ST via the shared compiler platform port.
  //
  // The port routes through the in-process JSON-fed transpiler
  // (`st-transpiler/`).  Native STRUCT emission is the only
  // mode — no equivalents of the old `--keep-structs` flag exist.
  // The resulting ST lives in memory only.
  // -------------------------------------------------------------------------
  emit({ message: 'Transpiling project to Structured Text', level: 'info' })
  // `stubbedData` is editor schema-shape; the port's signature is
  // port-shape.  Each platform port impl knows the actual shape it
  // receives (desktop → `fromSchemaShape`; web → `fromPortShape` after
  // its adapter converts).  See the matching cast site in
  // `pipeline.ts` (Step 1) for the same comment.
  const transpile = await port.transpileToSt({ projectData: stubbedData as never }, (message, level) =>
    emit({ message, level }),
  )
  if (!transpile.ok || !transpile.programSt) {
    const firstError = transpile.errors?.[0]?.message ?? 'transpile-from-json failed'
    return fail(emit, `transpile-from-json failed: ${firstError}`, { libraryName: manifest.name })
  }
  const programSt = transpile.programSt

  // -------------------------------------------------------------------------
  // Stage 3: resolve project-enabled library archives
  //
  // Missing names fail fast with a Library-Manager-pointing message
  // before the strucpp compile runs.  The bundled IEC standard set
  // (TON, TP, CTU, etc.) is included automatically by every port impl
  // — desktop reads it off disk, web pulls it from its bundled-stlibs
  // asset glob.  THIS is the step whose absence on web caused the
  // "Undefined type 'TON'" bug.
  // -------------------------------------------------------------------------
  const enabledLibraryRefs = (projectData.libraries ?? []).map((ref) => ({
    name: ref.name,
    version: ref.version,
  }))
  const { archives: depArchives, missing: missingDeps } = await port.loadLibraryArchives({
    projectLibraryRefs: enabledLibraryRefs,
  })
  if (missingDeps.length > 0) {
    return fail(
      emit,
      `Library build aborted: enabled libraries are not installed (${missingDeps.join(', ')}). ` +
        'Open the Library Manager to install or remove them.',
      { libraryName: manifest.name },
    )
  }

  // -------------------------------------------------------------------------
  // Stage 4: gather per-symbol documentation
  //
  // POUs contribute their editor "Description" field; data types
  // contribute their own optional documentation.  Both ride through
  // `libraryBuildFromTranspiledSt`'s aux block and get stamped onto
  // the corresponding manifest entries via `decorateArchive`.  (Native
  // blocks get their documentation from strucpp instead, which reads the
  // leading ST comment out of the authored file.)
  // -------------------------------------------------------------------------
  const pouDocs: Record<string, string> = {}
  for (const pou of projectData.pous) {
    if (pou.data.documentation && pou.data.documentation.length > 0) {
      pouDocs[pou.data.name] = pou.data.documentation
    }
  }
  for (const dt of projectData.dataTypes ?? []) {
    const doc = (dt as { documentation?: string }).documentation
    const name = (dt as { name?: string }).name
    if (typeof name === 'string' && typeof doc === 'string' && doc.length > 0) {
      pouDocs[name] = doc
    }
  }
  // -------------------------------------------------------------------------
  // Stage 4b: read the authored C/C++ and Python POU files off the project
  //
  // Read from disk, NOT from the preprocessed project data: by this point
  // `preprocessPous` has replaced every native body with generated bridge ST,
  // and the archive must carry what the author wrote.  Strucpp stores these
  // verbatim and the consumer re-derives the bridge at its own build time —
  // that is what keeps a published library working when the bridge changes.
  //
  // A file that cannot be read fails the build naming the block, rather than
  // producing an archive whose manifest promises a block with no source.
  // -------------------------------------------------------------------------
  const nativeSources: LibraryNativeSource[] = []
  for (const ref of nativePous) {
    const fileName = ref.relPath.split('/').pop() ?? ref.name
    let source: string | null
    try {
      source = await port.readBuildFile(projectPath, ref.relPath)
    } catch (error) {
      return fail(emit, `Could not read "${ref.relPath}": ${formatError(error)}`, { libraryName: manifest.name })
    }
    if (source === null || source.trim() === '') {
      return fail(
        emit,
        `Could not read the source for "${ref.name}" at ${ref.relPath}. ` +
          'C/C++ and Python blocks ship their source verbatim, so the file must be present.',
        { libraryName: manifest.name },
      )
    }
    nativeSources.push({ fileName, source })
  }

  // -------------------------------------------------------------------------
  // Stage 5: strucpp compileStlib
  // -------------------------------------------------------------------------
  emit({ message: 'Compiling library archive...', level: 'info' })
  const stage5 = libraryBuildFromTranspiledSt(programSt, knownPous, manifest, {
    pouDocs,
    dependencyArchives: depArchives,
    dependencyRefs: enabledLibraryRefs,
    nativeSources,
  })
  if (!stage5.success) {
    for (const err of stage5.errors) {
      const where = err.file ? `[${err.file}${err.line ? `:${err.line}` : ''}] ` : ''
      emit({ message: `${where}${err.message}`, level: 'error' })
    }
    return {
      success: false,
      error: stage5.errors[0]?.message ?? 'Library compilation failed.',
      libraryName: manifest.name,
    }
  }

  // -------------------------------------------------------------------------
  // Stage 6: write .stlib archive
  // -------------------------------------------------------------------------
  const stlibRelPath = `${STLIB_OUT_DIR}/${manifest.name}.stlib`
  try {
    await port.writeBuildFile(projectPath, stlibRelPath, JSON.stringify(stage5.archive, null, 2) + '\n')
  } catch (error) {
    return fail(emit, `Could not write ${manifest.name}.stlib: ${formatError(error)}`, { libraryName: manifest.name })
  }

  emit({ message: `Library built successfully: ${stlibRelPath}`, level: 'info' })
  return {
    success: true,
    stlibPath: stlibRelPath,
    libraryName: manifest.name,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(
  emit: (event: LibraryBuildEvent) => void,
  message: string,
  extra: Partial<CompileLibraryResult> = {},
): CompileLibraryResult {
  emit({ message, level: 'error' })
  return { success: false, error: message, ...extra }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
