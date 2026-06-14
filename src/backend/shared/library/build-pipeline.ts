/**
 * Library Project build pipeline — pure orchestration.
 *
 * Sequence of transforms the editor backend runs to produce a
 * `.stlib` archive from a library project on disk:
 *
 *   1. `prepareXmlForLibraryBuild(project, manifest)` — synthesizes
 *      a stub main program / task / instance into a transient
 *      PLCProject (the on-disk project remains untouched) and runs
 *      the canonical XmlGenerator on it.  xml2st rejects programless
 *      projects, so the stub is mandatory; the stub's POU body is
 *      intentionally non-empty (`LocalVar := 3;` against a single
 *      INT local) because some xml2st codepaths also reject empty
 *      program bodies.
 *
 *   2. *(caller runs xml2st on the resulting plc.xml — Electron
 *      spawns a local binary, web backend posts to its xml2st
 *      service — produces `program.st`.)*
 *
 *   3. `libraryBuildFromTranspiledSt(programSt, knownPous, manifest)`
 *      — splits `program.st` per-POU via the shared splitter, drops
 *      the synthetic main, runs strucpp's `compileStlib` against
 *      the remaining sources + the parsed manifest, and returns
 *      the archive blob + serialized bytes ready for `.stlib`
 *      write-out.
 *
 *   4. `composeVerificationProject(project)` — produces the same
 *      stubbed PLCProject the verification compile path needs
 *      (Phase 8 — feeds the existing `compileProgram` flow against
 *      the OpenPLC Simulator target to surface generated-C++
 *      compile errors).
 *
 * Everything here is pure: no fs, no spawn, no electron.  The
 * Electron compiler module and the web backend service both
 * consume this same orchestration.
 */

import type { PLCProject, PLCProjectData } from '@root/backend/shared/types/PLC/open-plc'
import { checkPathId } from '@root/backend/shared/utils/path-safety'
import { type KnownPou, splitProgramSt } from '@root/backend/shared/utils/PLC/split-program-st'

import { compileStlib, type CompileStlibError, type CompileStlibSource } from './compile-stlib'

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

/**
 * Result of parsing a `library.json` blob.  Either a structured
 * manifest the build can consume, or a list of validation errors
 * suitable for surfacing in the editor console.
 */
export type ManifestParseResult = { ok: true; manifest: LibraryBuildManifest } | { ok: false; errors: string[] }

/**
 * Narrow surface of the strucpp library manifest that the build
 * pipeline reads.  Mirrors the schema-required fields; optional
 * authoring fields (description, displayName, headers, sourceFiles,
 * etc.) pass through opaquely in `extra`.
 */
export interface LibraryBuildManifest {
  name: string
  version: string
  namespace: string
  /** Whatever else was in the JSON.  Forwarded to strucpp's
   *  compileStlib via the spread in `composeStlibInputs`, so
   *  upstream additions don't require an editor change. */
  extra: Record<string, unknown>
}

/**
 * Parse + validate a `library.json` blob.  Returns either the
 * structured manifest or a list of human-readable errors the editor
 * console can render through the existing diagnostic pipeline.
 *
 * Strucpp itself validates manifests during compile, but doing it
 * here lets the build fail BEFORE running xml2st when the manifest
 * is obviously broken — saves a slow xml2st spawn on every
 * mis-edited save.
 */
function parseLibraryManifest(json: string): ManifestParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return {
      ok: false,
      errors: [`library.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['library.json must be a JSON object'] }
  }
  const obj = raw as Record<string, unknown>
  const errors: string[] = []

  // `manifest.name` doubles as the on-disk archive filename and the
  // identifier the library manager validates with `validatePathId`
  // at install time.  Run the SAME check here so an invalid name
  // (e.g. one with spaces) fails the build instead of producing a
  // `.stlib` that the library manager would later refuse to install.
  const nameError = checkPathId(obj.name, 'manifest.name')
  if (nameError) {
    errors.push(nameError)
  }
  if (typeof obj.version !== 'string' || obj.version.length === 0) {
    errors.push('manifest.version must be a non-empty string')
  }
  if (typeof obj.namespace !== 'string' || obj.namespace.length === 0) {
    errors.push('manifest.namespace must be a non-empty string')
  } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(obj.namespace)) {
    errors.push(
      `manifest.namespace must be a valid C++ identifier (letters, digits, underscore; cannot start with a digit). Got: ${JSON.stringify(obj.namespace)}`,
    )
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    manifest: {
      name: obj.name as string,
      version: obj.version as string,
      namespace: obj.namespace as string,
      extra: obj,
    },
  }
}

// ---------------------------------------------------------------------------
// Stub program — makes xml2st accept a programless library project
// ---------------------------------------------------------------------------

/**
 * Names of the synthetic program / task / instance the library
 * pipeline injects.  The program is literally named `main` because
 * `XmlGenerator` hard-requires a `type === 'program'` POU named
 * `main` and bails otherwise.  Library projects forbid the user from
 * creating program POUs (see `projectCapabilities.hasPrograms`), so
 * the stub can never collide with a real `main` program.  Task and
 * instance names are unambiguous strings — they never leave memory.
 */
const STUB_PROGRAM_NAME = 'main'
const STUB_TASK_NAME = '__openplc_library_stub_task__'
const STUB_INSTANCE_NAME = '__openplc_library_stub_instance__'

/**
 * Build a transient PLCProject with a stub main program added on
 * top of the library's POUs / data types.  The stub is what
 * satisfies xml2st (and strucpp's main-program assumption later in
 * the verification path).  Caller drops the stub's per-POU output
 * before handing the remaining sources to compileStlib.
 *
 * The stub's body is non-empty (`LocalVar := 3;`) because xml2st
 * has been observed to reject programs with completely empty bodies
 * — a single trivial assignment + a single INT local is the smallest
 * shape that gets accepted across every xml2st version.
 */
function stubProgramFor(project: PLCProject): PLCProject {
  return {
    meta: project.meta,
    data: {
      ...project.data,
      pous: [
        ...project.data.pous,
        {
          type: 'program',
          data: {
            name: STUB_PROGRAM_NAME,
            language: 'st',
            variables: [
              {
                name: 'LocalVar',
                class: 'local',
                type: { definition: 'base-type', value: 'INT' },
                location: '',
                documentation: '',
                debug: false,
              },
            ],
            documentation: '',
            body: { language: 'st', value: 'LocalVar := 3;' },
          },
        },
      ],
      configuration: {
        resource: {
          ...project.data.configuration.resource,
          tasks: [
            ...project.data.configuration.resource.tasks,
            { name: STUB_TASK_NAME, triggering: 'Cyclic', interval: 'T#100ms', priority: 1 },
          ],
          instances: [
            ...project.data.configuration.resource.instances,
            { name: STUB_INSTANCE_NAME, program: STUB_PROGRAM_NAME, task: STUB_TASK_NAME },
          ],
        },
      },
    } as PLCProjectData,
  }
}

/**
 * Synthetic filename the splitter emits for the stub program.  The
 * splitter writes its file keys using the caller-side POU name
 * verbatim (case preserved), so this matches what `splitProgramSt`
 * returns regardless of how xml2st upper-cases identifiers in the
 * monolithic ST output.  Caller drops this entry before feeding the
 * rest to compileStlib.
 */
const STUB_SPLIT_FILENAME = `${STUB_PROGRAM_NAME}.st`

// ---------------------------------------------------------------------------
// Stage 1: pre-xml2st (pure)
// ---------------------------------------------------------------------------

export interface PrepareXmlResult {
  /** Stubbed project data — passes directly into the JSON-fed
   *  transpiler via `port.transpileToSt({ projectData })`.  The
   *  stub adds a synthesised `main` program so the transpiler's
   *  "requires a main POU" check passes. */
  projectData: PLCProject['data']
  /** POU list the splitter needs to slice the transpiler output.
   *  Includes the stub so the splitter recognises and emits a slice
   *  for it — caller then drops that slice. */
  knownPous: KnownPou[]
  /** Manifest the second stage reads, parsed here so a malformed
   *  manifest bails BEFORE the transpile step. */
  manifest: LibraryBuildManifest
}

export type PrepareXmlOutcome = PrepareXmlResult | { error: string }

/**
 * Stage 1.  Validates the manifest and returns the stubbed project
 * data the JSON transpiler consumes (plus the POU list the splitter
 * needs).  The "stub" adds a synthesised `main` program so the
 * transpiler's "requires a main POU" guard passes — the caller drops
 * the stub's slice from the splitter output downstream.  Returns
 * `{error}` when the manifest fails validation.
 */
export function prepareXmlForLibraryBuild(project: PLCProject, manifestJson: string): PrepareXmlOutcome {
  const parsed = parseLibraryManifest(manifestJson)
  if (!parsed.ok) {
    return { error: `library.json is invalid:\n${parsed.errors.map((e) => `  • ${e}`).join('\n')}` }
  }

  const stubbed = stubProgramFor(project)

  const knownPous: KnownPou[] = stubbed.data.pous.map((p) => ({
    name: p.data.name,
    kind: p.type === 'program' ? 'PROGRAM' : p.type === 'function' ? 'FUNCTION' : 'FUNCTION_BLOCK',
    language: p.data.language,
  }))

  return { projectData: stubbed.data, knownPous, manifest: parsed.manifest }
}

// ---------------------------------------------------------------------------
// Stage 2: post-xml2st (pure)
// ---------------------------------------------------------------------------

export interface LibraryBuildResult {
  /** True only when strucpp succeeded.  When false `errors` carries
   *  the diagnostics — same shape strucpp emits, so the editor's
   *  existing console-rendering pipeline displays them. */
  success: boolean
  /** Strucpp archive object.  Opaque here; the Electron writer
   *  (Phase 7) JSON-serialises it to the `.stlib` file. */
  archive?: unknown
  /** Compile errors (manifest validation errors are surfaced in
   *  Stage 1, not here). */
  errors: CompileStlibError[]
}

/**
 * Auxiliary inputs the Electron caller supplies alongside the
 * transpiled ST.  All optional — the build still produces a valid
 * `.stlib` without them, just without the bells:
 *
 *   - `pouDocs` — POU name (case-insensitive) → user-authored
 *     documentation text.  Pulled from each POU's editor
 *     "Description" field and stamped onto the corresponding
 *     `manifest.functions[]` / `functionBlocks[]` / `types[]` entry
 *     so authors don't have to duplicate help text in `library.json`.
 *
 *   - `dependencyArchives` — full strucpp archives of every library
 *     the project enables, loaded from disk by the Electron bridge.
 *     Passed to `compileStlib` so cross-library symbol resolution
 *     works (a library that uses an OSCAT FB needs OSCAT's archive
 *     visible during compile).  Opaque shape — strucpp owns it.
 *
 *   - `dependencyRefs` — `{name, version}` tuples mirroring the
 *     project's `libraries` field.  Written verbatim onto the
 *     archive's `dependencies` array so consumers can resolve
 *     transitive deps without re-reading every archive on disk.
 */
/**
 * C/C++ function block carried verbatim through the `.stlib`.
 * Strucpp's library compiler is ST/IL-only, so the editor pulls
 * these out of the strucpp input set and re-attaches them on the
 * resulting archive as a separate field.  At consume time, the
 * editor reads them back, synthesizes user-POU-equivalent entries
 * into the consumer project (with a library-name prefix on the
 * POU name to avoid collisions), and feeds them through the
 * existing user-defined C/C++ block pipeline.  Strucpp never sees
 * them — same shape user-defined C++ POUs use today.
 */
export interface LibraryCppBlock {
  /** FB name as the library author wrote it.  The consumer-side
   *  injection renames this to `<library_name>__<name>` before
   *  feeding to `preprocessPous`, so collisions with the
   *  consumer's own POUs are impossible by construction. */
  name: string
  /** Raw user-authored C++ source.  Same shape `originalCppPous`
   *  carries today (the body of `void setup()` / `void loop()`
   *  plus any helpers). */
  code: string
  /** Variable declarations on the FB (inputs / outputs / etc.).
   *  Same shape `PLCVariable` uses elsewhere; carried opaquely
   *  here so this module stays free of the variable-schema
   *  import. */
  variables: unknown[]
  /** Optional documentation surfaced in the library tree picker. */
  documentation?: string
}

export interface LibraryBuildAux {
  pouDocs?: Record<string, string>
  dependencyArchives?: unknown[]
  dependencyRefs?: Array<{ name: string; version: string }>
  /** C/C++ POUs from the library's project.  Filtered OUT of
   *  strucpp's input set and stamped onto the archive's
   *  `cppBlocks` field after compileStlib returns.  See
   *  `LibraryCppBlock` for the per-entry shape. */
  cppBlocks?: LibraryCppBlock[]
}

/**
 * Stage 2.  Given xml2st's monolithic `program.st`, the POU
 * inventory from Stage 1, and the parsed manifest: split program.st
 * per-POU, drop the stub, hand the remaining sources to strucpp's
 * compileStlib.
 *
 * Failure modes return `{success: false, errors}` rather than
 * throwing — same convention compileStlib uses, so editor consumers
 * funnel through one diagnostic pipeline.
 *
 * `aux` carries opt-in metadata the resulting archive's manifest is
 * post-processed with — description, displayName, per-POU docs,
 * dependency list.  Omitted entirely for unit tests that don't care
 * about manifest decoration.
 */
export function libraryBuildFromTranspiledSt(
  programSt: string,
  knownPous: KnownPou[],
  manifest: LibraryBuildManifest,
  aux?: LibraryBuildAux,
): LibraryBuildResult {
  const split = splitProgramSt(programSt, knownPous)
  if (!split) {
    return {
      success: false,
      errors: [{ message: 'Could not split program.st into per-POU files (no POUs detected).' }],
    }
  }

  // Build the strucpp input list.  Drops:
  //
  //   - The stub program's `.st` file (the library doesn't ship
  //     the stub).
  //   - `_config.st` (xml2st's CONFIGURATION block references the
  //     stub program, which we've just removed — leaving it in
  //     causes strucpp to emit "Unknown program type 'MAIN'"
  //     diagnostics).  Libraries don't carry configurations
  //     anyway — they ship POUs + types for consumer projects to
  //     instantiate.
  //   - Every per-POU file whose source POU was originally a
  //     C/C++ function block.  Those POUs' ST bodies are
  //     `generateCppSTCode`-emitted stubs that reference
  //     `c_blocks.h` externs strucpp's library compiler can't
  //     resolve (no `pouIncludes` on `compileStlib`).  We
  //     re-attach the verbatim C++ source on the archive's
  //     `cppBlocks` field after `compileStlib` returns; the
  //     consumer's program compile reads it back and routes it
  //     through the existing user-C++-block path.
  //
  // Keep `_types.st` and `_globals.st`: they may carry user-defined
  // types and library-internal globals the POUs reference.
  const cppBlockFilenames = new Set((aux?.cppBlocks ?? []).map((b) => `${b.name}.st`))
  const sources: CompileStlibSource[] = []
  for (const [fileName, source] of split.files.entries()) {
    if (fileName === STUB_SPLIT_FILENAME) continue
    if (fileName === '_config.st') continue
    if (cppBlockFilenames.has(fileName)) continue
    sources.push({
      fileName,
      source,
      category: inferCategory(fileName),
    })
  }

  // No real POU files left?  That means the library has no
  // functions / function-blocks / types — a degenerate case but a
  // valid one (a library project may be opened fresh before the
  // user has added any symbols).  Refuse with a clear message
  // rather than producing an empty .stlib that strucpp would
  // accept silently.
  //
  // C/C++ blocks count as "real content" — a library that ships
  // only C/C++ FBs is still useful (no strucpp-compiled chunks,
  // just `cppBlocks` riding through the archive for the consumer
  // to consume).
  const hasRealSources = sources.some((s) => s.fileName !== '_globals.st')
  const hasCppBlocks = (aux?.cppBlocks?.length ?? 0) > 0
  if (!hasRealSources && !hasCppBlocks) {
    return {
      success: false,
      errors: [
        {
          message:
            'Library has no functions, function blocks, or data types to compile.  Add at least one before building.',
        },
      ],
    }
  }

  const compileRes = compileStlib(sources, {
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    ...(aux?.dependencyArchives && aux.dependencyArchives.length > 0
      ? { dependencies: aux.dependencyArchives as never }
      : {}),
  })

  // Post-process the resulting archive with metadata strucpp's
  // `compileStlib` doesn't accept as an option — description,
  // displayName, per-POU documentation, and the dependency list.
  // The archive is JSON-serialised verbatim to disk, so mutating
  // it here is the cleanest place to inject editor-side metadata
  // without introducing a second strucpp pass.
  if (compileRes.success && compileRes.archive) {
    decorateArchive(compileRes.archive, manifest, aux)
  }

  return {
    success: compileRes.success,
    archive: compileRes.archive,
    errors: compileRes.errors ?? [],
  }
}

/**
 * Stamp editor-side metadata onto a strucpp-produced `.stlib`
 * archive in place.  Same shape strucpp's archive writer expects,
 * just with the optional fields filled in:
 *
 *   - `manifest.description` / `manifest.displayName` from the
 *     user's `library.json` (`extra`).
 *   - `manifest.functions[i].documentation` / functionBlocks /
 *     types from the editor's POU "Description" fields, matched
 *     case-insensitively by name.
 *   - `dependencies` from the project's enabled-libraries list.
 */
function decorateArchive(archive: unknown, manifest: LibraryBuildManifest, aux: LibraryBuildAux | undefined): void {
  const arch = archive as {
    manifest?: {
      description?: string
      displayName?: string
      functions?: Array<{ name: string; documentation?: string }>
      functionBlocks?: Array<{ name: string; documentation?: string }>
      types?: Array<{ name: string; documentation?: string }>
    }
    dependencies?: Array<{ name: string; version: string }>
    cppBlocks?: LibraryCppBlock[]
  }
  if (!arch.manifest) return

  const extra = manifest.extra
  if (typeof extra.description === 'string' && extra.description.length > 0) {
    arch.manifest.description = extra.description
  }
  if (typeof extra.displayName === 'string' && extra.displayName.length > 0) {
    arch.manifest.displayName = extra.displayName
  }

  if (aux?.pouDocs) {
    // Strucpp upper-cases POU names in the emitted manifest;
    // editor-side names preserve the user's casing.  Normalise both
    // sides to lowercase for the join.
    const docsByLower = new Map<string, string>()
    for (const [name, doc] of Object.entries(aux.pouDocs)) {
      if (doc && doc.length > 0) docsByLower.set(name.toLowerCase(), doc)
    }
    const lookup = (name: string): string | undefined => docsByLower.get(name.toLowerCase())
    for (const entry of arch.manifest.functions ?? []) {
      const doc = lookup(entry.name)
      if (doc) entry.documentation = doc
    }
    for (const entry of arch.manifest.functionBlocks ?? []) {
      const doc = lookup(entry.name)
      if (doc) entry.documentation = doc
    }
    for (const entry of arch.manifest.types ?? []) {
      const doc = lookup(entry.name)
      if (doc) entry.documentation = doc
    }
  }

  if (aux?.dependencyRefs && aux.dependencyRefs.length > 0) {
    arch.dependencies = aux.dependencyRefs.map((ref) => ({ name: ref.name, version: ref.version }))
  }

  // C/C++ blocks ride through the archive verbatim — strucpp has
  // no notion of them, the consumer-side editor reads them back
  // at program-compile time and grafts them into the project's
  // own C++-POU pipeline.  JSON.stringify preserves the field, so
  // attaching it on the in-memory archive is enough to round-trip
  // to disk.
  if (aux?.cppBlocks && aux.cppBlocks.length > 0) {
    arch.cppBlocks = aux.cppBlocks.map((b) => ({
      name: b.name,
      code: b.code,
      variables: b.variables,
      ...(b.documentation && b.documentation.length > 0 ? { documentation: b.documentation } : {}),
    }))
  }
}

/**
 * Tag each split filename with the category strucpp uses for
 * grouping.  Inferred from the splitter's naming convention — see
 * `_types.st` / `_globals.st` in `split-program-st.ts`.  `_config.st`
 * is filtered out upstream (libraries don't carry configurations),
 * so it never reaches this helper and intentionally has no case.
 */
function inferCategory(fileName: string): string | undefined {
  if (fileName === '_types.st') return 'data-type'
  if (fileName === '_globals.st') return 'globals'
  // POU files are tagged by their suffix-less name; strucpp uses
  // this to group functions vs function-blocks in the manifest, but
  // accepts `undefined` and falls back to detecting from the body.
  return undefined
}

// ---------------------------------------------------------------------------
// Stage 4: verification project (Phase 8)
// ---------------------------------------------------------------------------

/**
 * Build a transient PLCProject the verification compile path
 * consumes.  Same stub-program shape as `stubProgramFor`, but
 * tagged `plc-project` so the existing `compileProgram` flow
 * (Phase 8) doesn't try to recurse back into the library branch.
 *
 * Verification runs the resulting project through the standard
 * ST→C++→arduino-cli pipeline against the OpenPLC Simulator
 * target.  Compile failures there are surfaced as warnings — the
 * `.stlib` is still produced (the user may legitimately target a
 * platform with more memory than the AVR simulator).
 */
export function composeVerificationProject(project: PLCProject): PLCProject {
  const stubbed = stubProgramFor(project)
  return {
    meta: { ...project.meta, type: 'plc-project' },
    data: stubbed.data,
  }
}

// Exposed for test ergonomics only — keeps the stub-name constants
// and pipeline helpers that aren't part of the public API reachable
// from test code without leaking them as importable symbols for
// production callers.
export const __TESTING__ = {
  STUB_PROGRAM_NAME,
  STUB_TASK_NAME,
  STUB_INSTANCE_NAME,
  STUB_SPLIT_FILENAME,
  parseLibraryManifest,
  stubProgramFor,
}
