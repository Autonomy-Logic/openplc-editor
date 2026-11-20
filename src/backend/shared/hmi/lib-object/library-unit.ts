/**
 * The widget libraries' own translation units in HMI builds: each library's code and, for the preview, its factory
 * table, generated from its archive and its dependencies alone, so a library gives the same objects in every project,
 * preview and Runtime v4 build. Each unit is tagged so its object is also kept next to the library.
 */
import { HMI_PROVIDED_HEADERS, type ProvidedHeader } from '@root/middleware/shared/utils/hmi/widget-libraries'

import type { WasmCompileUnit } from '../../../../middleware/shared/ports/wasm-toolchain-types'
import { librariesInFiles, libraryDependencies, libraryUnit, withoutLibraryFiles } from '../../library/library-unit'
import { libraryObjectKey } from '../../wasm-toolchain/library-objects'
import { buildWidgetCatalog } from '../lib/widget-catalog'
import { type HmiWidgetLibraryArchive, loadHmiWidgetLibraries, widgetLibraryNames } from '../lib/widget-libraries'
import { factorySymbol, type PreviewFactoryPart, previewFactoryTable } from '../unit/preview-factory'

export { libraryOfFile } from '../../library/library-unit'

/** C++ namespace of the HMI unit; a library unit declares its classes there, as the unit's own header does. */
export const HMI_UNIT_NAMESPACE = 'hmi'
/** Folder of the library units in a compile request; each library gets its own subfolder. */
export const HMI_LIBRARY_DIR = 'hmilib'
const INCLUDES = ['-Istrucpp_runtime/include', '-Ihmi/core']

/**
 * C++ flags of a library unit in every HMI WebAssembly build (preview and Runtime v4), whatever the build's own
 * flags; part of the key of each stored library object.
 */
export const HMI_LIBRARY_CXX_FLAGS: readonly string[] = [
  '-std=gnu++17',
  '-O2',
  '-fno-exceptions',
  '-fno-rtti',
  '-ffp-contract=off',
  ...INCLUDES,
]

/** `name@version` of each header, as library object keys record what a build provides. */
export const providedHeaderNames = (headers: readonly ProvidedHeader[]): string[] =>
  headers.map((h) => `${h.name}@${h.version ?? ''}`)

export interface HmiLibraryUnit {
  /** The library's name, as its manifest gives it. */
  name: string
  /** Its files by request path: the source, the header of its declarations and the factory table. */
  files: Record<string, string>
  /** The library's code, with the library flags only. */
  unit: WasmCompileUnit
  /** The preview's factory table of the library's widgets, and its unit. */
  factory: { unit: WasmCompileUnit; table: PreviewFactoryPart & { library: string } }
  /**
   * When the library declares the screen base, the folder holding `hmi_preview_widgets.hpp`, its declarations, which
   * the preview's live elements compile against; null otherwise.
   */
  screenBase: { dir: string } | null
}

/** The function block every screen extends, upper case. */
const SCREEN_BASE = 'HMISCREEN'
/** The header the preview's live elements include for the widget declarations they use. */
const LIVE_WIDGETS = 'hmi_preview_widgets.hpp'

export type HmiLibraryUnitsResult = { ok: true; units: HmiLibraryUnit[] } | { ok: false; error: string }

const fileOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** The units of `library`, whose dependencies are found among `available`. */
async function hmiLibraryUnit(
  library: HmiWidgetLibraryArchive,
  available: readonly HmiWidgetLibraryArchive[],
): Promise<{ ok: true; unit: HmiLibraryUnit } | { ok: false; error: string }> {
  const dependencies = libraryDependencies(library, available)
  const built = libraryUnit(
    library.archive,
    dependencies.map((d) => d.archive),
    { dir: HMI_LIBRARY_DIR, namespace: HMI_UNIT_NAMESPACE, providedHeaders: HMI_PROVIDED_HEADERS },
  )
  if (!built.ok) return built
  const { unit } = built
  const widgets = [
    ...buildWidgetCatalog([library.archive, ...dependencies.map((d) => d.archive)]).widgets.values(),
  ].filter((w) => w.library === library.name)
  const table = previewFactoryTable(widgets, factorySymbol(library.name), fileOf(unit.header), HMI_UNIT_NAMESPACE)
  const factorySource = unit.source.replace(/\.cpp$/, '_factory.cpp')
  const keyInput = {
    archive: library.archiveJson,
    dependencies: dependencies.map((d) => d.archiveJson),
    flags: HMI_LIBRARY_CXX_FLAGS,
    providedHeaders: providedHeaderNames(HMI_PROVIDED_HEADERS),
  }
  const [codeKey, factoryKey] = await Promise.all([
    libraryObjectKey({ ...keyInput, kind: 'hmi' }),
    libraryObjectKey({ ...keyInput, kind: 'hmi-factory' }),
  ])
  const ownFlags = (source: string, kind: 'hmi' | 'hmi-factory', key: string): WasmCompileUnit => ({
    source,
    language: 'c++',
    flags: [...HMI_LIBRARY_CXX_FLAGS],
    ownFlags: true,
    library: { name: library.name, kind, key },
  })
  const dir = unit.header.slice(0, unit.header.lastIndexOf('/'))
  const declaresScreenBase = library.archive.manifest.functionBlocks.some((fb) => fb.name.toUpperCase() === SCREEN_BASE)
  return {
    ok: true,
    unit: {
      name: library.name,
      files: {
        ...unit.files,
        [factorySource]: table.source,
        ...(declaresScreenBase ? { [`${dir}/${LIVE_WIDGETS}`]: `#include "${fileOf(unit.header)}"\n` } : {}),
      },
      screenBase: declaresScreenBase ? { dir } : null,
      unit: ownFlags(unit.source, 'hmi', codeKey),
      factory: {
        unit: ownFlags(factorySource, 'hmi-factory', factoryKey),
        table: { symbol: table.symbol, types: table.types, library: library.name },
      },
    },
  }
}

/** The units of each of `libraries`, whose dependencies are found among `available`, in order. */
export async function hmiLibraryUnits(
  libraries: readonly HmiWidgetLibraryArchive[],
  available: readonly HmiWidgetLibraryArchive[] = libraries,
): Promise<HmiLibraryUnitsResult> {
  const units: HmiLibraryUnit[] = []
  for (const library of libraries) {
    const built = await hmiLibraryUnit(library, available)
    if (!built.ok) return built
    units.push(built.unit)
  }
  return { ok: true, units }
}

/** The project's libraries (bundled and listed, verbatim) that declare widgets, each compiled as its own unit. */
export function sharedWidgetLibraries(projectLibraries: readonly unknown[]): {
  shared: HmiWidgetLibraryArchive[]
  all: HmiWidgetLibraryArchive[]
} {
  const { libraries, catalog } = loadHmiWidgetLibraries(projectLibraries)
  const widgets = widgetLibraryNames(catalog)
  return { shared: libraries.filter((l) => widgets.has(l.name)), all: libraries }
}

export type SharedLibraryUnits =
  | { ok: true; units: HmiLibraryUnit[]; unitFiles: Record<string, string> }
  | { ok: false; error: string }

/**
 * Takes the code of each of `libraries` out of a generated HMI unit and gives the library's own units in its place; a
 * library the unit has no code of is left out. `available` are the archives dependencies are found among. The unit
 * keeps its header, whose declarations of the libraries are the ones the library units define.
 */
export async function shareLibraryUnits(
  unitFiles: Readonly<Record<string, string>>,
  libraries: readonly HmiWidgetLibraryArchive[],
  available: readonly HmiWidgetLibraryArchive[] = libraries,
): Promise<SharedLibraryUnits> {
  const present = librariesInFiles(unitFiles)
  const built = await hmiLibraryUnits(
    libraries.filter((l) => present.has(l.name)),
    available,
  )
  if (!built.ok) return built
  return {
    ok: true,
    units: built.units,
    unitFiles: withoutLibraryFiles(unitFiles, new Set(built.units.map((u) => u.name))),
  }
}
