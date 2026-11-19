/**
 * A widget library's own translation unit, generated from its archive and the archives it depends on, never from a
 * project: the same library gives the same C++ and so the same object in every project, preview or Runtime v4 build.
 */
import type { StlibArchive } from 'strucpp'

import type { WasmCompileUnit } from '../../../../middleware/shared/ports/wasm-toolchain-types'
import { loadStrucpp } from '../../library/strucpp-runtime'

/** C++ namespace of the HMI unit; a library unit declares its classes there, as the unit's own header does. */
export const HMI_UNIT_NAMESPACE = 'hmi'
/** Folder of the library units in a compile request; each library gets its own subfolder. */
export const HMI_LIBRARY_DIR = 'hmilib'
const HEADER = 'hmi_lib.hpp'
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

export interface HmiLibraryUnit {
  /** The library's name, as its manifest gives it. */
  name: string
  /** Its files by request path: the source and the header of its declarations. */
  files: Record<string, string>
  /** The unit to compile, with the library flags only. */
  unit: WasmCompileUnit
}

export type HmiLibraryUnitResult = { ok: true; unit: HmiLibraryUnit } | { ok: false; error: string }

const LIBRARY_LINE = /^\/\/ Library: (.+)$/m

/** The library a STruC++ `lib_*.cpp` file holds, from its `// Library:` line; null for any other file. */
export function libraryOfFile(name: string, content: string): string | null {
  if (!/^lib_\w+\.cpp$/.test(name)) return null
  return LIBRARY_LINE.exec(content.slice(0, 512))?.[1] ?? null
}

/** A folder name for a library: its name with anything but letters, digits, `-` and `_` replaced. */
const folderOf = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '_')

const units = new WeakMap<StlibArchive, HmiLibraryUnitResult>()

/**
 * The translation unit of `archive`, whole: every chunk, whatever a project reaches. `dependencies` are the archives
 * it declares as dependencies; only their declarations are emitted. Kept per archive for the session.
 */
export function hmiLibraryUnit(
  archive: StlibArchive,
  dependencies: readonly StlibArchive[] = [],
): HmiLibraryUnitResult {
  const kept = units.get(archive)
  if (kept) return kept
  const name = archive.manifest.name
  const compiled = loadStrucpp().compile('', {
    fileName: `${folderOf(name)}.st`,
    libraries: [archive, ...dependencies],
    namespace: HMI_UNIT_NAMESPACE,
    headerFileName: HEADER,
    separateLibraryFiles: true,
    wholeLibraries: [name],
  })
  const source = compiled.cppFiles.find((f) => libraryOfFile(f.name, f.content) === name)
  const result: HmiLibraryUnitResult =
    compiled.errors.length > 0
      ? { ok: false, error: `${name}: ${compiled.errors.map((e) => e.message).join('; ')}` }
      : !source || !compiled.libraryHeader
        ? { ok: false, error: `${name}: the library has no code of its own` }
        : {
            ok: true,
            unit: {
              name,
              files: {
                [`${HMI_LIBRARY_DIR}/${folderOf(name)}/${compiled.libraryHeader.name}`]: compiled.libraryHeader.content,
                [`${HMI_LIBRARY_DIR}/${folderOf(name)}/library.cpp`]: source.content,
              },
              unit: {
                source: `${HMI_LIBRARY_DIR}/${folderOf(name)}/library.cpp`,
                language: 'c++',
                flags: [...HMI_LIBRARY_CXX_FLAGS],
                ownFlags: true,
              },
            },
          }
  units.set(archive, result)
  return result
}

export type SharedLibraryUnits =
  | { ok: true; units: HmiLibraryUnit[]; unitFiles: Record<string, string> }
  | { ok: false; error: string }

/**
 * Takes the code of each of `archives` out of a generated HMI unit and gives the library's own translation unit in its
 * place. The unit keeps its header, whose declarations of the libraries are the ones the library units define.
 */
export function shareLibraryUnits(
  unitFiles: Readonly<Record<string, string>>,
  archives: readonly StlibArchive[],
): SharedLibraryUnits {
  const units: HmiLibraryUnit[] = []
  for (const archive of archives) {
    const built = hmiLibraryUnit(archive)
    if (!built.ok) return built
    units.push(built.unit)
  }
  const shared = new Set(units.map((u) => u.name))
  const kept = Object.entries(unitFiles).filter(([name, content]) => {
    const library = libraryOfFile(name, content)
    return library === null || !shared.has(library)
  })
  return { ok: true, units, unitFiles: Object.fromEntries(kept) }
}
