/**
 * The OpenPLC Simulator build's library units: each library the program's code reaches is compiled from its own whole
 * unit, generated from its archive and its dependencies alone, instead of from the program's `lib_*.cpp` files, so its
 * object is the same in every project and survives every program edit. Each unit is tagged so its object is also kept
 * next to the library.
 */
import { PLC_PROVIDED_HEADERS } from '@root/middleware/shared/utils/hmi/widget-libraries'
import type { StlibArchive } from 'strucpp'

import type { WasmCompileUnit } from '../../../../middleware/shared/ports/wasm-toolchain-types'
import {
  librariesInFiles,
  libraryDependencies,
  libraryUnit,
  type NamedArchive,
  withoutLibraryFiles,
} from '../../library/library-unit'
import { isStrucppArchive } from '../../library/stlib-archive-json'
import { libraryObjectKey } from '../../wasm-toolchain/library-objects'

/** Folder of the library units in the simulator's request; each library gets its own subfolder. */
export const SIMULATOR_LIBRARY_DIR = 'simlib'
/** Where the program's STruC++ output sits in the firmware files. */
const PROGRAM_DIR = 'src/'

export interface SimulatorLibraryUnits {
  /** The firmware files without the program's library code, with the library units' files. */
  files: Record<string, string>
  /** The library units, tagged. */
  units: WasmCompileUnit[]
}

export type SimulatorLibraryUnitsResult = { ok: true; value: SimulatorLibraryUnits } | { ok: false; error: string }

const archiveTexts = new WeakMap<StlibArchive, string>()

/** The archive as text, kept per archive object. */
function archiveText(archive: StlibArchive): string {
  let text = archiveTexts.get(archive)
  if (text === undefined) {
    text = JSON.stringify(archive)
    archiveTexts.set(archive, text)
  }
  return text
}

/**
 * The units of `libraries`, in `available` order, each generated whole from its archive and its dependencies found
 * among `available`, tagged with its library object key for `flags`.
 */
export async function simulatorLibraryUnitsOf(
  libraries: ReadonlySet<string>,
  available: readonly NamedArchive[],
  flags: readonly string[],
): Promise<{ ok: true; files: Record<string, string>; units: WasmCompileUnit[] } | { ok: false; error: string }> {
  const files: Record<string, string> = {}
  const units: WasmCompileUnit[] = []
  const done = new Set<string>()
  for (const library of available) {
    if (!libraries.has(library.name) || done.has(library.name)) continue
    done.add(library.name)
    const dependencies = libraryDependencies(library, available)
    const built = libraryUnit(
      library.archive,
      dependencies.map((d) => d.archive),
      { dir: SIMULATOR_LIBRARY_DIR, providedHeaders: PLC_PROVIDED_HEADERS },
    )
    if (!built.ok) return built
    Object.assign(files, built.unit.files)
    const key = await libraryObjectKey({
      kind: 'simulator',
      archive: archiveText(library.archive),
      dependencies: dependencies.map((d) => archiveText(d.archive)),
      flags,
      providedHeaders: [],
    })
    units.push({ source: built.unit.source, language: 'c++', library: { name: library.name, kind: 'simulator', key } })
  }
  return { ok: true, files, units }
}

/** The build's library archives, verbatim, by the names their manifests give. */
export const namedArchives = (archives: readonly unknown[]): NamedArchive[] =>
  archives.filter(isStrucppArchive).map((archive) => ({ name: archive.manifest.name, archive }))

/**
 * Takes the program's `lib_*.cpp` files out of `firmwareFiles` and gives each of those libraries, and every library
 * they depend on, its own whole unit. `archives` are the build's library archives, verbatim; `flags` the units'
 * compile flags, part of each library object's key. A library with no archive among them keeps its program file.
 */
export async function simulatorLibraryUnits(
  firmwareFiles: Readonly<Record<string, string>>,
  archives: readonly unknown[],
  flags: readonly string[],
): Promise<SimulatorLibraryUnitsResult> {
  const programFiles: Record<string, string> = {}
  for (const [path, content] of Object.entries(firmwareFiles))
    if (path.startsWith(PROGRAM_DIR) && !path.slice(PROGRAM_DIR.length).includes('/'))
      programFiles[path.slice(PROGRAM_DIR.length)] = content
  const reached = librariesInFiles(programFiles)
  const available = namedArchives(archives)
  const shared = new Set<string>()
  for (const library of available) {
    if (!reached.has(library.name)) continue
    shared.add(library.name)
    for (const dependency of libraryDependencies(library, available)) shared.add(dependency.name)
  }
  const built = await simulatorLibraryUnitsOf(shared, available, flags)
  if (!built.ok) return built
  const kept = withoutLibraryFiles(programFiles, shared)
  const rest = Object.fromEntries(
    Object.entries(firmwareFiles).filter(
      ([path]) => !path.startsWith(PROGRAM_DIR) || path.slice(PROGRAM_DIR.length).includes('/'),
    ),
  )
  for (const [name, content] of Object.entries(kept)) rest[`${PROGRAM_DIR}${name}`] = content
  return { ok: true, value: { files: { ...rest, ...built.files }, units: built.units } }
}
