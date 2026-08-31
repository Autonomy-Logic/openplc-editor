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
 *   4. Verification compile against the manifest's verify target
 *      via `LibraryBuildPort.verifyCompile`.  MD5 cache hit short-
 *      circuits.  Cache record persisted under `build/`.
 *   5. Gather `pouDocs` from the project data, and read the authored
 *      C/C++ / Python POU files off disk for strucpp to carry verbatim.
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
import {
  LIBRARY_FOLDER_RULE,
  LIBRARY_PROPERTIES,
  LIBRARY_SRC_DIR,
} from '../../../middleware/shared/utils/library/library-folder'
import type { PLCProject, PLCProjectData } from '../types/PLC/open-plc'
import { isSafeRelativePath } from '../utils/path-safety'
import {
  composeVerificationProject,
  libraryBuildFromTranspiledSt,
  type LibraryNativeSource,
  type LibraryResource,
  prepareXmlForLibraryBuild,
} from './build-pipeline'
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
  /** Verification-pass project data: Python POUs lowered to no-op
   *  stubs (the AVR simulator has no Python interpreter). */
  verifyProjectData: PLCProjectData
  /** Skip the MD5 verification cache and force a fresh verify run. */
  cleanBuild: boolean
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
// a round-trip on data nobody reads after the build finishes.  Only
// the user-visible `.stlib` artifact and the verification cache are
// written to the project tree.
const VERIFY_CACHE_REL_PATH = 'build/.verify-cache-library.json'

/** Where a library project keeps the files it ships alongside its blocks. */
const RESOURCES_REL_PATH = 'resources'

const LIBRARY_MANIFEST_REL_PATH = 'library.json'
const STLIB_OUT_DIR = 'build'

/**
 * Read the library folders under `resources/`, paths intact — the consumer
 * reproduces the layout and resolves each folder as a library.
 *
 * Only the library is read: `library.properties` and everything under `src/`,
 * which is what arduino-cli and the runtime Makefile resolve. `library-folder.ts`
 * owns the rule, and the picker copies by the same one.
 *
 * A folder that is not a library fails the build naming it, rather than
 * shipping an empty directory that fails at the consumer.
 */
async function readResources(
  port: LibraryBuildPort,
  projectPath: string,
  emit: (event: LibraryBuildEvent) => void,
): Promise<{ resources: LibraryResource[] } | { error: string }> {
  const folders = await port.listProjectDirs(projectPath, RESOURCES_REL_PATH)
  const resources: LibraryResource[] = []
  for (const folder of folders) {
    if (!isSafeRelativePath(folder)) {
      return { error: `Resource folder "${folder}" is not a usable folder name.` }
    }
    const folderPath = `${RESOURCES_REL_PATH}/${folder}`
    const properties = await port.readBuildFile(projectPath, `${folderPath}/${LIBRARY_PROPERTIES}`)
    const sourcePaths = await port.listProjectFiles(projectPath, `${folderPath}/${LIBRARY_SRC_DIR}`)

    if (properties === null || sourcePaths.length === 0) {
      const missing: string[] = []
      if (properties === null) missing.push(LIBRARY_PROPERTIES)
      if (sourcePaths.length === 0) missing.push(`${LIBRARY_SRC_DIR}/`)
      return {
        error: `Resource folder "${folder}" has no ${missing.join(' and no ')} — ${LIBRARY_FOLDER_RULE}.`,
      }
    }

    resources.push({ path: `${folder}/${LIBRARY_PROPERTIES}`, content: properties })
    for (const sourcePath of sourcePaths) {
      const relPath = `${folder}/${LIBRARY_SRC_DIR}/${sourcePath}`
      const text = await port.readBuildFile(projectPath, `${RESOURCES_REL_PATH}/${relPath}`)
      if (text === null) continue
      // A `precompiled=true` library ships a `.a` beside its headers, so it
      // travels too — base64, since the archive is JSON. U+FFFD is what
      // non-UTF-8 bytes decode to; a text file containing one is carried the
      // same way, costing a third of its size.
      if (text.includes('\uFFFD')) {
        const bytes = await port.readBuildFileBase64(projectPath, `${RESOURCES_REL_PATH}/${relPath}`)
        if (bytes === null) continue
        resources.push({ path: relPath, content: bytes, encoding: 'base64' })
        continue
      }
      resources.push({ path: relPath, content: text })
    }
  }

  const binaries = resources.filter((resource) => resource.encoding === 'base64')
  if (binaries.length > 0) {
    // Reported because base64 grows a file by a third and a Runtime v4 upload
    // is capped per file and in total.
    const kb = Math.round(binaries.reduce((total, resource) => total + resource.content.length, 0) / 1024)
    emit({
      message: `Carrying ${binaries.length} binary file(s) from resources, ${kb} KB encoded.`,
      level: 'info',
    })
  }
  return { resources }
}

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
  const { projectPath, projectData, verifyProjectData, cleanBuild, nativePous = [] } = args

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
  //
  // Read before verification because the cache key hashes these bodies: a
  // native body never reaches `program.st` — the emitted ST is a bridge stub
  // built from the pins — so hashing that alone replays a stale result after
  // an author edits a block.
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
  // Stage 5: verification compile
  //
  // Hash the verified sources and consult the cache; cache hit
  // short-circuits the slow compile.  cleanBuild forces a fresh run.
  // Verification failures are advisory: they surface as warnings on
  // `verification.success` with the build still producing a `.stlib`.
  //
  // The key covers the C/C++ block bodies and the resources as well as
  // `program.st`.  A block's body never reaches `program.st` — the emitted ST
  // is a stub built from its pins — so hashing that alone replays a stale
  // result after a body or a resource changes.
  //
  // The MD5 routes through the platform port instead of `node:crypto`
  // so the shared module ships without a host-runtime dependency.
  // Editor's port wires it to Node's hash; web's port wires it to
  // spark-md5 — both produce byte-identical output.
  //
  // `build.verify: "off"` in the manifest skips the whole stage, cache
  // included: a library whose C++ targets no toolchain the editor can drive
  // would otherwise carry a permanent failure that reports nothing.
  // -------------------------------------------------------------------------
  const resourcesRead = await readResources(port, projectPath, emit)
  if ('error' in resourcesRead) {
    return fail(emit, resourcesRead.error, { libraryName: manifest.name })
  }
  const resources = resourcesRead.resources
  const verifyTarget = manifest.verifyTarget
  const nativeSource = nativeSources.map((n) => `${n.fileName}\n${n.source}`).join('\n')
  const resourceSource = resources.map((r) => `${r.path}\n${r.content}`).join('\n')
  // The target is part of the key: the same sources verified against a
  // different toolchain are a different question.
  const targetSource = `${verifyTarget.mode}\n${verifyTarget.core ?? ''}`
  const verifyInputsMd5 = await port.computeMd5(`${programSt}\n${nativeSource}\n${resourceSource}\n${targetSource}`)
  let verification: CompileLibraryResult['verification']
  let usedCache = false
  if (verifyTarget.mode === 'off') {
    emit({ message: 'Verification is off in Build Settings — skipping.', level: 'info' })
  } else if (!cleanBuild) {
    const cached = await readVerificationCache(port, projectPath, verifyInputsMd5)
    if (cached) {
      verification = cached
      usedCache = true
      emit({
        message: `Skipping verification (cached: ${cached.success ? 'pass' : 'fail'}). Use "Clean build" to force re-verification.`,
        level: 'info',
      })
    }
  }
  if (!verification && verifyTarget.mode !== 'off') {
    const verifyProject = composeVerificationProject({
      meta: { name: manifest.name, type: 'plc-library' },
      data: verifyProjectData,
    })
    emit({ message: 'Verifying library compile...', level: 'info' })
    try {
      verification = await port.verifyCompile({
        projectPath,
        // A library project does not list itself, so its resources have to be
        // handed over explicitly for its own blocks to resolve their includes.
        verifyProjectData: { ...verifyProject.data, ownLibraryResources: resources } as PLCProjectData,
        target: verifyTarget,
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
        JSON.stringify({ md5: verifyInputsMd5, ...verification }, null, 2),
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
  // Stage 7: strucpp compileStlib
  // -------------------------------------------------------------------------
  emit({ message: 'Compiling library archive...', level: 'info' })
  const stage7 = libraryBuildFromTranspiledSt(programSt, knownPous, manifest, {
    pouDocs,
    dependencyArchives: depArchives,
    dependencyRefs: enabledLibraryRefs,
    nativeSources,
    resources,
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
 * sources being verified.  Malformed cache files and missing files are
 * indistinguishable from a fresh build — both return null so the
 * caller falls through to a real verification run.
 */
async function readVerificationCache(
  port: LibraryBuildPort,
  projectPath: string,
  verifyInputsMd5: string,
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
    if (parsed?.md5 === verifyInputsMd5 && typeof parsed.success === 'boolean') {
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
