// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Shared library-build orchestrator.
 *
 * Single source of truth for the `.stlib` compilation flow.  Both
 * desktop and web drive this function through their own
 * `LibraryBuildPort` implementation; every decision, every event,
 * every file name, every hash, every error message, every cache rule
 * is owned by this module.  The port carries only the IO primitives
 * (read / write / delete project files, resolve library archives,
 * run a verification compile) — anything that looks like business
 * logic stays here, by design.
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
 *      names (one place — feeds BOTH verification and strucpp).
 *   4. Verification compile against the OpenPLC Simulator target
 *      via `LibraryBuildPort.verifyCompile`.  MD5 cache hit short-
 *      circuits.  Cache record persisted under `build/`.
 *   5. Gather `pouDocs` + `cppBlocks` from the project data.
 *   6. strucpp compile via `libraryBuildFromTranspiledSt`.
 *   7. Write `.stlib` archive to `build/{name}.stlib`.
 *
 * The orchestrator returns a structured result; the adapter wraps it
 * in whatever transport it owns (IPC port message on desktop, Promise
 * resolution on web).  See `LibraryBuildPort` for the contract the
 * adapter implements.
 */

import type { LibraryBuildPort } from '../../../middleware/shared/ports/library-build-port'
import type { CompileLibraryResult } from '../../../middleware/shared/ports/types'
import type { PLCProject, PLCProjectData } from '../types/PLC/open-plc'
import {
  composeVerificationProject,
  libraryBuildFromTranspiledSt,
  type LibraryCppBlock,
  prepareXmlForLibraryBuild,
} from './build-pipeline'

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
  /** Verification-pass project data: Python POUs lowered to no-op
   *  stubs (the AVR simulator has no Python interpreter). */
  verifyProjectData: PLCProjectData
  /** Skip the MD5 verification cache and force a fresh verify run. */
  cleanBuild: boolean
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
// a round-trip on data nobody reads after the build finishes.  Only
// the user-visible `.stlib` artifact and the verification cache are
// written to the project tree.
const VERIFY_CACHE_REL_PATH = 'build/.verify-cache-library.json'
const LIBRARY_MANIFEST_REL_PATH = 'library.json'
const STLIB_OUT_DIR = 'build'

/**
 * Run the full library-build pipeline.  Pure with respect to its
 * arguments — every side effect funnels through `port` or `emit`.
 *
 * The result mirrors the existing `CompileLibraryResult` shape so the
 * desktop's MessagePort wrapper and the web adapter both surface the
 * same structure to the renderer.  `success: false` from this function
 * is a fatal build error; verification failures show up under
 * `verification.success: false` with `success: true` overall.
 */
export async function runLibraryBuildPipeline(
  args: LibraryBuildArgs,
  port: LibraryBuildPort,
  emit: (event: LibraryBuildEvent) => void,
): Promise<CompileLibraryResult> {
  const { projectPath, projectData, verifyProjectData, cleanBuild } = args

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
  // Stage 4: resolve project-enabled library archives
  //
  // ONE resolution path feeding both verification (so the simulator
  // compile sees the same symbol set the user's project sees) and
  // the strucpp library compile.  Missing names fail fast with a
  // Library-Manager-pointing message before either heavy step runs.
  // The bundled IEC standard set (TON, TP, CTU, etc.) is included
  // automatically by every port impl — desktop reads it off disk,
  // web pulls it from its bundled-stlibs asset glob.  THIS is the
  // step whose absence on web caused the "Undefined type 'TON'" bug.
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
  // Stage 5: verification compile
  //
  // Hash program.st and consult the cache; cache hit short-circuits
  // the slow avr-gcc compile.  cleanBuild forces a fresh run.
  // Verification failures are advisory: they surface as warnings on
  // `verification.success` with the build still producing a `.stlib`.
  //
  // The MD5 routes through the platform port instead of `node:crypto`
  // so the shared module ships without a host-runtime dependency.
  // Editor's port wires it to Node's hash; web's port wires it to
  // spark-md5 — both produce byte-identical output.
  // -------------------------------------------------------------------------
  const programStMd5 = await port.computeMd5(programSt)
  let verification: CompileLibraryResult['verification']
  let usedCache = false
  if (!cleanBuild) {
    const cached = await readVerificationCache(port, projectPath, programStMd5)
    if (cached) {
      verification = cached
      usedCache = true
      emit({
        message: `Skipping verification (cached: ${cached.success ? 'pass' : 'fail'}). Use "Clean build" to force re-verification.`,
        level: 'info',
      })
    }
  }
  if (!verification) {
    const verifyProject = composeVerificationProject({
      meta: { name: manifest.name, type: 'plc-library' },
      data: verifyProjectData,
    })
    emit({ message: 'Verifying with OpenPLC Simulator (avr-gcc)...', level: 'info' })
    try {
      verification = await port.verifyCompile({
        projectPath,
        verifyProjectData: verifyProject.data,
        emit: (message, logLevel) => {
          // Demote inner errors to warnings on the way out.  `.stlib`
          // is still produced, so an error-level `[verify]` line in
          // the console would falsely suggest the build failed.
          const level = logLevel === 'error' ? 'warning' : (logLevel ?? 'info')
          emit({ message: `[verify] ${message}`, level })
        },
      })
    } catch (error) {
      verification = { success: false, message: formatError(error) }
    }
    if (verification.success) {
      emit({ message: 'Verification passed.', level: 'info' })
    } else {
      emit({
        message: `Verification reported issues (warning only — .stlib will still be generated): ${verification.message ?? 'see log'}`,
        level: 'warning',
      })
    }
  }
  if (!usedCache && verification) {
    try {
      await port.writeBuildFile(
        projectPath,
        VERIFY_CACHE_REL_PATH,
        JSON.stringify({ md5: programStMd5, ...verification }, null, 2),
      )
    } catch (cacheErr) {
      emit({ message: `Could not write verification cache: ${formatError(cacheErr)}`, level: 'warning' })
    }
  }

  // -------------------------------------------------------------------------
  // Stage 6: gather per-symbol documentation
  //
  // POUs contribute their editor "Description" field; data types
  // contribute their own optional documentation.  Both ride through
  // `libraryBuildFromTranspiledSt`'s aux block and get stamped onto
  // the corresponding manifest entries via `decorateArchive`.
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
  const cppBlocks: LibraryCppBlock[] = (
    (projectData as { originalCppPous?: Array<{ name: string; code: string; variables: unknown[] }> })
      .originalCppPous ?? []
  ).map((b) => ({
    name: b.name,
    code: b.code,
    variables: b.variables,
  }))

  // -------------------------------------------------------------------------
  // Stage 7: strucpp compileStlib
  // -------------------------------------------------------------------------
  emit({ message: 'Compiling library archive...', level: 'info' })
  const stage7 = libraryBuildFromTranspiledSt(programSt, knownPous, manifest, {
    pouDocs,
    dependencyArchives: depArchives,
    dependencyRefs: enabledLibraryRefs,
    cppBlocks,
  })
  if (!stage7.success) {
    for (const err of stage7.errors) {
      const where = err.file ? `[${err.file}${err.line ? `:${err.line}` : ''}] ` : ''
      emit({ message: `${where}${err.message}`, level: 'error' })
    }
    return {
      success: false,
      error: stage7.errors[0]?.message ?? 'Library compilation failed.',
      libraryName: manifest.name,
    }
  }

  // -------------------------------------------------------------------------
  // Stage 8: write .stlib archive
  // -------------------------------------------------------------------------
  const stlibRelPath = `${STLIB_OUT_DIR}/${manifest.name}.stlib`
  try {
    await port.writeBuildFile(projectPath, stlibRelPath, JSON.stringify(stage7.archive, null, 2) + '\n')
  } catch (error) {
    return fail(emit, `Could not write ${manifest.name}.stlib: ${formatError(error)}`, { libraryName: manifest.name })
  }

  emit({ message: `Library built successfully: ${stlibRelPath}`, level: 'info' })
  return {
    success: true,
    stlibPath: stlibRelPath,
    libraryName: manifest.name,
    verification,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read + validate the verification cache.  Returns the cached
 * `{ success, message }` only when the persisted MD5 matches the
 * current `programSt`.  Malformed cache files and missing files are
 * indistinguishable from a fresh build — both return null so the
 * caller falls through to a real verification run.
 */
async function readVerificationCache(
  port: LibraryBuildPort,
  projectPath: string,
  programStMd5: string,
): Promise<{ success: boolean; message?: string } | null> {
  let raw: string | null
  try {
    raw = await port.readBuildFile(projectPath, VERIFY_CACHE_REL_PATH)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { md5?: string; success?: boolean; message?: string }
    if (parsed?.md5 === programStMd5 && typeof parsed.success === 'boolean') {
      return { success: parsed.success, message: parsed.message }
    }
  } catch {
    /* malformed cache — fall through to fresh run */
  }
  return null
}

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
