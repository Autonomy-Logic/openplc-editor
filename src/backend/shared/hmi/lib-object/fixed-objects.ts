/**
 * The compiled objects no project changes: of HMI builds, the HMI core, the font tables, the hosts and the widget
 * library units, and every object of the default palette gallery; of OpenPLC Simulator builds, the bundled libraries'
 * units. The application's build compiles them once with the pinned toolchain, from reference builds, and ships them
 * with the preview's precompiled prelude; a project's build then compiles only its own units.
 */
import type { HmiPreviewRequest } from '../../../../middleware/shared/ports/hmi-preview-types'
import type { WasmClangRunner } from '../../../../middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmCompileRequest, WasmCompileResult } from '../../../../middleware/shared/ports/wasm-toolchain-types'
import { HMI_FONT_VARIANTS, hmiSettingsSchema } from '../../../../middleware/shared/utils/hmi/settings'
import { SIMULATOR_CXX_FLAGS, SIMULATOR_LINK_FLAGS } from '../../compile/steps/build-simulator-wasm-request'
import {
  namedArchives,
  SIMULATOR_LIBRARY_DIR,
  simulatorLibraryUnitsOf,
} from '../../compile/steps/simulator-library-units'
import {
  type CachedWasmObject,
  compileToWasm,
  WASM_TARGET,
  type WasmObjectCache,
} from '../../wasm-toolchain/compile-to-wasm'
import { sha256Hex } from '../../wasm-toolchain/content-digest'
import { parseDependencyFile } from '../../wasm-toolchain/dependency-file'
import { filesToTree, isFileBytes, readTreeFile } from '../../wasm-toolchain/file-tree'
import type { StoredWasmObject } from '../../wasm-toolchain/persistent-object-cache'
import { encodeShippedObjects } from '../../wasm-toolchain/shipped-objects'
import { WASM_TOOLCHAIN_IDENTITY } from '../../wasm-toolchain/toolchain-identity'
import { BoundedWasmObjectCache } from '../../wasm-toolchain/wasm-object-cache'
import { composeHmiArtefact } from '../artefact/compose-hmi-artefact'
import { buildHmiPreview, type HmiPreviewResources } from '../preview/build-hmi-preview'
import {
  encodeHmiPrelude,
  HMI_PRELUDE_SOURCE,
  HMI_UNIT_HEADER,
  HMI_UNIT_LIBRARIES_HEADER,
  type HmiPrelude,
  hmiPreludeText,
} from '../preview/hmi-prelude'

/** Generated request files that are the same in every project's build. */
const FIXED_GENERATED = new Set(['unit/hmi_preview_fonts.c', 'unit/hmi_fonts.c'])

/** Whether a request path holds a file no project changes: runtime headers, HMI sources, library units and the above. */
export const isFixedHmiPath = (path: string): boolean =>
  path.startsWith('strucpp_runtime/') ||
  path.startsWith('hmi/') ||
  path.startsWith('hmilib/') ||
  FIXED_GENERATED.has(path)

/** The objects built only from files no project changes; linked modules are left out. */
export const fixedHmiObjects = (objects: readonly StoredWasmObject[]): StoredWasmObject[] =>
  objects.filter(
    ({ entry }) => entry.dependencies.length > 0 && entry.dependencies.every(([path]) => isFixedHmiPath(path)),
  )

/** A cache that also keeps every object set in it. */
class CollectingCache implements WasmObjectCache {
  readonly collected: StoredWasmObject[] = []
  private readonly memory = new BoundedWasmObjectCache(1024 * 1024 * 1024)
  variants(key: string): readonly CachedWasmObject[] {
    return this.memory.variants(key)
  }
  set(key: string, entry: CachedWasmObject): this {
    this.memory.set(key, entry)
    this.collected.push({ key, entry })
    return this
  }
}

const REFERENCE_SCREEN = `FUNCTION_BLOCK Reference EXTENDS HmiScreen
  VAR
    Body : HmiVerticalStack;
    Title : HmiLabel := (Parent := 'Body', Text := 'Reference');
  END_VAR
END_FUNCTION_BLOCK
`

/** The OpenPLC Simulator's firmware skeleton and the bundled library archives, for their library objects. */
export interface SimulatorLibrarySources {
  /** The skeleton as the simulator build lays it out: runtime, STruC++ runtime headers under `src/`, `wasm-sim/`. */
  firmwareFiles: Readonly<Record<string, string>>
  /** The bundled library archives, verbatim. */
  libraries: readonly unknown[]
}

export interface HmiFixedObjectSources {
  /** The preview's resources, as the platforms give them, with the bundled library archives as the project's. */
  preview: HmiPreviewResources
  /** Every file under the HMI sources folder, as the Runtime v4 build reads them. */
  hmiSources: Readonly<Record<string, string | Uint8Array>>
  /** The STruC++ runtime headers by path, `strucpp_runtime/include/<file>`. */
  runtimeHeaders: Readonly<Record<string, string>>
  /** When given, the bundled libraries' simulator objects are shipped too. */
  simulator?: SimulatorLibrarySources
}

/** Where the prelude build writes, as the compile step does. */
const PRELUDE_OUTPUT = '__objects/hmi_prelude.pch'
const PRELUDE_DEPENDENCIES = '__objects/hmi_prelude.d'

/** A prelude and every request file it was built from, with its SHA-256. */
export interface BuiltHmiPrelude {
  prelude: HmiPrelude
  inputs: Array<[path: string, sha256: string]>
}

/**
 * Compiles the prelude of a preview request's unit header with the request's C++ flags: the precompiled header, and
 * the request files clang read for it. Throws when the request has no unit header to take it from or clang fails.
 */
export async function buildHmiPrelude(runner: WasmClangRunner, request: WasmCompileRequest): Promise<BuiltHmiPrelude> {
  const unitHeader = request.files[`unit/${HMI_UNIT_HEADER}`]
  const libraries = request.files[`unit/${HMI_UNIT_LIBRARIES_HEADER}`]
  const header = typeof unitHeader === 'string' ? hmiPreludeText(unitHeader) : null
  if (header === null || typeof libraries !== 'string')
    throw new Error('The preview request has no unit header to take the prelude from.')
  const files: WasmCompileRequest['files'] = { ...request.files, [HMI_PRELUDE_SOURCE]: header }
  const flags = [`--target=${WASM_TARGET}`, ...(request.cxxFlags ?? [])]
  const result = await runner.run({
    argv: [
      'clang++',
      ...flags,
      '-x',
      'c++-header',
      HMI_PRELUDE_SOURCE,
      '-MD',
      '-MF',
      PRELUDE_DEPENDENCIES,
      '-o',
      PRELUDE_OUTPUT,
    ],
    tree: filesToTree(files),
  })
  const pch = readTreeFile(result.tree, PRELUDE_OUTPUT)
  const dependencies = readTreeFile(result.tree, PRELUDE_DEPENDENCIES)
  if (result.exitCode !== 0 || !isFileBytes(pch) || dependencies === undefined)
    throw new Error(`The HMI preview prelude did not compile (exit code ${result.exitCode}): ${result.stderr}`)
  const paths = parseDependencyFile(
    typeof dependencies === 'string' ? dependencies : new TextDecoder().decode(dependencies),
  )
  if (paths === null) throw new Error('The HMI preview prelude has no readable dependency list.')
  const inputs: Array<[string, string]> = []
  for (const path of new Set(paths)) {
    if (path.startsWith('/')) continue
    const content = files[path]
    if (content === undefined) throw new Error(`The HMI preview prelude read ${path}, which is not a request file.`)
    inputs.push([path, await sha256Hex(content)])
  }
  return { prelude: { header, libraries, pch, flags }, inputs }
}

/** The request a preview build compiles, generated without compiling it; throws when the build fails before that. */
async function previewRequestOf(
  request: HmiPreviewRequest,
  resources: HmiPreviewResources,
): Promise<WasmCompileRequest> {
  const requests: WasmCompileRequest[] = []
  const notCompiled: WasmCompileResult = {
    ok: false,
    error: 'not compiled',
    stats: { units: 0, cached: 0, compileMs: 0, linkMs: 0 },
    diagnostics: [],
  }
  const preview = await buildHmiPreview(request, resources, (compiled) => {
    requests.push(compiled)
    return Promise.resolve(notCompiled)
  })
  const [first] = requests
  if (first === undefined)
    throw new Error(preview.ok ? 'The preview compiled nothing.' : preview.errors.map((e) => e.message).join('\n'))
  return first
}

/** Whether an object is a simulator library unit's: built from a source under the simulator's library folder. */
const isSimulatorLibraryObject = ({ entry }: StoredWasmObject): boolean =>
  entry.dependencies.some(([path]) => path.startsWith(`${SIMULATOR_LIBRARY_DIR}/`) && path.endsWith('.cpp'))

/**
 * Compiles every bundled library a PLC build can use, each from its own whole unit as the simulator build lays it out;
 * one whose code needs headers PLC builds do not provide, or that has no code, is left out.
 */
async function compileSimulatorLibraries(
  sources: SimulatorLibrarySources,
  compile: (request: WasmCompileRequest) => Promise<unknown>,
): Promise<void> {
  const available = namedArchives(sources.libraries)
  const usable = new Set<string>()
  for (const library of available) {
    if ((library.archive.manifest.headers ?? []).length > 0) continue
    const alone = await simulatorLibraryUnitsOf(new Set([library.name]), available, SIMULATOR_CXX_FLAGS)
    if (alone.ok) usable.add(library.name)
  }
  const built = await simulatorLibraryUnitsOf(usable, available, SIMULATOR_CXX_FLAGS)
  if (!built.ok) throw new Error(built.error)
  await compile({
    files: { ...sources.firmwareFiles, ...built.files },
    units: built.units,
    cxxFlags: SIMULATOR_CXX_FLAGS,
    linkFlags: [...SIMULATOR_LINK_FLAGS, '-Wl,--allow-undefined'],
    output: 'libraries.wasm',
  })
}

/**
 * Builds the preview's prelude, then the palette gallery in every font variant against it and a one-screen Runtime v4
 * HMI, and returns the shipped set: the fixed objects those builds compiled and every object of the galleries, each
 * record by its file name, the index, and the prelude's files.
 */
export async function buildHmiShippedObjects(
  runner: WasmClangRunner,
  input: HmiFixedObjectSources,
  identity: string = WASM_TOOLCHAIN_IDENTITY,
): Promise<Record<string, Uint8Array>> {
  const cache = new CollectingCache()
  const compile = async (request: WasmCompileRequest) => {
    const result = await compileToWasm(request, { runner, cache })
    if (!result.ok) throw new Error(result.error)
    return result
  }
  const galleryOf = (fontVariant: (typeof HMI_FONT_VARIANTS)[number]) => {
    const settings = hmiSettingsSchema.parse({ fontVariant })
    const project = { screens: [{ name: 'Reference', source: REFERENCE_SCREEN }], widgets: [], settings }
    const sources = { ...project, plcVariables: [], projectNames: [] }
    return { sources, request: { ...sources, libraries: [], gallery: true } }
  }
  const built = await buildHmiPrelude(
    runner,
    await previewRequestOf(galleryOf(HMI_FONT_VARIANTS[0]).request, input.preview),
  )
  const preview = { ...input.preview, prelude: built.prelude }
  const galleryObjects: StoredWasmObject[] = []
  for (const fontVariant of HMI_FONT_VARIANTS) {
    const { sources, request } = galleryOf(fontVariant)
    const from = cache.collected.length
    const gallery = await buildHmiPreview(request, preview, compile)
    if (!gallery.ok) throw new Error(gallery.errors.map((e) => e.message).join('\n'))
    galleryObjects.push(...cache.collected.slice(from))
    const artefact = await composeHmiArtefact({
      sources,
      libraries: input.preview.projectLibraries,
      capabilities: {},
      debugMapJson: JSON.stringify({ version: 2, md5: 'x', leaves: [] }),
      md5: '00000000000000000000000000000000',
      instances: [],
      hmiSources: input.hmiSources,
      runtimeHeaders: input.runtimeHeaders,
      compile,
    })
    if (!artefact.ok) throw new Error(artefact.errors.map((e) => e.message).join('\n'))
  }
  if (input.simulator) await compileSimulatorLibraries(input.simulator, compile)
  const objects = await encodeShippedObjects(identity, [
    ...fixedHmiObjects(cache.collected),
    ...galleryObjects,
    ...cache.collected.filter(isSimulatorLibraryObject),
  ])
  return { ...objects, ...(await encodeHmiPrelude(identity, built.prelude, built.inputs)) }
}
