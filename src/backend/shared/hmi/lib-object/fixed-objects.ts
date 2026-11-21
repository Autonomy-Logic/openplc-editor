/**
 * The compiled objects no project changes: of HMI builds, the HMI core, the font tables, the hosts and the widget
 * library units, and every object of the default palette gallery; of OpenPLC Simulator builds, the bundled libraries'
 * units. The application's build compiles them once with the pinned toolchain, from reference builds, and ships them;
 * a project's build then compiles only its own units.
 */
import type { WasmClangRunner } from '../../../../middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmCompileRequest } from '../../../../middleware/shared/ports/wasm-toolchain-types'
import { HMI_FONT_VARIANTS, hmiSettingsSchema } from '../../../../middleware/shared/utils/hmi/settings'
import { SIMULATOR_CXX_FLAGS, SIMULATOR_LINK_FLAGS } from '../../compile/steps/build-simulator-wasm-request'
import {
  namedArchives,
  SIMULATOR_LIBRARY_DIR,
  simulatorLibraryUnitsOf,
} from '../../compile/steps/simulator-library-units'
import { type CachedWasmObject, compileToWasm, type WasmObjectCache } from '../../wasm-toolchain/compile-to-wasm'
import type { StoredWasmObject } from '../../wasm-toolchain/persistent-object-cache'
import { encodeShippedObjects } from '../../wasm-toolchain/shipped-objects'
import { WASM_TOOLCHAIN_IDENTITY } from '../../wasm-toolchain/toolchain-identity'
import { BoundedWasmObjectCache } from '../../wasm-toolchain/wasm-object-cache'
import { composeHmiArtefact } from '../artefact/compose-hmi-artefact'
import { buildHmiPreview, type HmiPreviewResources } from '../preview/build-hmi-preview'

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
 * Builds the palette gallery in every font variant and a one-screen Runtime v4 HMI, and returns the shipped set: the
 * fixed objects those builds compiled and every object of the galleries, each record by its file name, and the index.
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
  const galleryObjects: StoredWasmObject[] = []
  for (const fontVariant of HMI_FONT_VARIANTS) {
    const settings = hmiSettingsSchema.parse({ fontVariant })
    const project = { screens: [{ name: 'Reference', source: REFERENCE_SCREEN }], widgets: [], settings }
    const sources = { ...project, plcVariables: [], projectNames: [] }
    const from = cache.collected.length
    const preview = await buildHmiPreview({ ...sources, libraries: [], gallery: true }, input.preview, compile)
    if (!preview.ok) throw new Error(preview.errors.map((e) => e.message).join('\n'))
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
  return encodeShippedObjects(identity, [
    ...fixedHmiObjects(cache.collected),
    ...galleryObjects,
    ...cache.collected.filter(isSimulatorLibraryObject),
  ])
}
