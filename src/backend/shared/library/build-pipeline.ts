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

import type { PLCProject, PLCProjectData } from '../types/PLC/open-plc'
import { type KnownPou, splitProgramSt } from '../utils/PLC/split-program-st'
import { XmlGenerator } from '../utils/PLC/xml-generator'
import { compileStlib, type CompileStlibError, type CompileStlibSource } from './compile-stlib'

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

/**
 * Result of parsing a `library.json` blob.  Either a structured
 * manifest the build can consume, or a list of validation errors
 * suitable for surfacing in the editor console.
 */
export type ManifestParseResult =
  | { ok: true; manifest: LibraryBuildManifest }
  | { ok: false; errors: string[] }

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
export function parseLibraryManifest(json: string): ManifestParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return { ok: false, errors: [`library.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['library.json must be a JSON object'] }
  }
  const obj = raw as Record<string, unknown>
  const errors: string[] = []

  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    errors.push('manifest.name must be a non-empty string')
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
export function stubProgramFor(project: PLCProject): PLCProject {
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
  /** Plc.xml content the caller passes to xml2st. */
  xml: string
  /** POU list the splitter needs to slice the xml2st output.
   *  Includes the stub so the splitter recognises and emits a slice
   *  for it — caller then drops that slice. */
  knownPous: KnownPou[]
  /** Manifest the second stage reads, parsed here so a malformed
   *  manifest bails BEFORE xml2st runs. */
  manifest: LibraryBuildManifest
}

export type PrepareXmlOutcome = PrepareXmlResult | { error: string }

/**
 * Stage 1.  Validates the manifest and produces the XML xml2st
 * consumes.  Returns `{error}` when the manifest fails validation
 * — caller surfaces that as a build error and bails before
 * spawning xml2st.
 */
export function prepareXmlForLibraryBuild(project: PLCProject, manifestJson: string): PrepareXmlOutcome {
  const parsed = parseLibraryManifest(manifestJson)
  if (!parsed.ok) {
    return { error: `library.json is invalid:\n${parsed.errors.map((e) => `  • ${e}`).join('\n')}` }
  }

  const stubbed = stubProgramFor(project)
  const xmlRes = XmlGenerator(stubbed.data, 'old-editor')
  if (!xmlRes.ok || !xmlRes.data) {
    return { error: `XML generation failed: ${xmlRes.message ?? 'unknown error'}` }
  }

  const knownPous: KnownPou[] = stubbed.data.pous.map((p) => ({
    name: p.data.name,
    kind:
      p.type === 'program' ? 'PROGRAM' : p.type === 'function' ? 'FUNCTION' : 'FUNCTION_BLOCK',
    language: p.data.language,
  }))

  return { xml: xmlRes.data, knownPous, manifest: parsed.manifest }
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
 * Stage 2.  Given xml2st's monolithic `program.st`, the POU
 * inventory from Stage 1, and the parsed manifest: split program.st
 * per-POU, drop the stub, hand the remaining sources to strucpp's
 * compileStlib.
 *
 * Failure modes return `{success: false, errors}` rather than
 * throwing — same convention compileStlib uses, so editor consumers
 * funnel through one diagnostic pipeline.
 */
export function libraryBuildFromTranspiledSt(
  programSt: string,
  knownPous: KnownPou[],
  manifest: LibraryBuildManifest,
): LibraryBuildResult {
  const split = splitProgramSt(programSt, knownPous)
  if (!split) {
    return {
      success: false,
      errors: [{ message: 'Could not split program.st into per-POU files (no POUs detected).' }],
    }
  }

  // Build the strucpp input list.  Convention from
  // `frontend/utils/PLC/split-program-st` consumers: keep the
  // `_types.st` / `_globals.st` aux files (they carry shared type
  // declarations the POUs reference); drop the stub program's own
  // .st file (the library doesn't ship the stub).
  const sources: CompileStlibSource[] = []
  for (const [fileName, source] of split.files.entries()) {
    if (fileName === STUB_SPLIT_FILENAME) continue
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
  const hasRealSources = sources.some((s) => s.fileName !== '_globals.st' && s.fileName !== '_config.st')
  if (!hasRealSources) {
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
  })

  return {
    success: compileRes.success,
    archive: compileRes.archive,
    errors: compileRes.errors ?? [],
  }
}

/**
 * Tag each split filename with the category strucpp uses for
 * grouping.  Inferred from the splitter's naming convention — see
 * `_types.st` / `_globals.st` / `_config.st` in
 * `split-program-st.ts`.
 */
function inferCategory(fileName: string): string | undefined {
  if (fileName === '_types.st') return 'data-type'
  if (fileName === '_globals.st') return 'globals'
  if (fileName === '_config.st') return 'config'
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

// Exposed for test ergonomics — same names the build pipeline reads
// internally, so tests can assert on the stub shape without
// re-declaring the constants.
export const __TESTING_STUB_NAMES__ = {
  STUB_PROGRAM_NAME,
  STUB_TASK_NAME,
  STUB_INSTANCE_NAME,
  STUB_SPLIT_FILENAME,
}
