/**
 * Which system libraries a project actually uses, read from the blocks and
 * instances in it rather than from what it declares.
 *
 * A project declares its libraries in `project.libraries`, and that list is
 * what the other side (web or desktop) checks to warn about a library it does
 * not have. But placing a block from a library never wrote to that list — only
 * the Library Manager did — so a project could use a library's blocks, save,
 * and travel to the other editor with nothing to warn about: the blocks render
 * from their own node data, the library is simply not there, and the build
 * fails later with no explanation.
 *
 * These helpers close that gap from the usage side. An FB instance is a
 * variable whose type is the block's name, in every language (a ladder block
 * gets one when it is placed, ST declares one by hand), so the variables table
 * is the one place to read usage from.
 *
 * Only the side that HAS the library installed can name it: a block's node
 * carries the block name, not its library, and the mapping lives in the
 * installed archives. That is enough — the ref is written here, saved, and the
 * other side warns.
 */

import type { PLCPou } from '../../middleware/shared/ports/types'

/**
 * The slice of an installed library these helpers read. Declared here rather
 * than imported from the store: `utils` may not depend on `store`, and the
 * store's `SystemLibrary` satisfies this shape structurally.
 */
export type InstalledLibraryShape = {
  name: string
  version: string
  pous: readonly { name: string }[]
}

/** The installed library that provides `pouName`, matched the way the editors resolve blocks: case-insensitively. */
export function findOwningLibrary(
  system: readonly InstalledLibraryShape[],
  pouName: string,
): InstalledLibraryShape | undefined {
  const needle = pouName.toLowerCase()

  return system.find((library) => library.pous.some((pou) => pou.name.toLowerCase() === needle))
}

/**
 * Names of the non-bundled installed libraries that own at least one of
 * `typeNames`. Bundled libraries are always on and never appear in
 * `project.libraries`, so they are left out; a type no installed library owns
 * is skipped, not guessed at.
 */
export function librariesOwningTypes(
  system: readonly InstalledLibraryShape[],
  bundledNames: readonly string[],
  typeNames: readonly string[],
): string[] {
  const bundled = new Set(bundledNames)
  const out: string[] = []

  for (const typeName of typeNames) {
    const owner = findOwningLibrary(system, typeName)
    if (!owner || bundled.has(owner.name) || out.includes(owner.name)) continue
    out.push(owner.name)
  }

  return out
}

/** Every derived type the project's variables instantiate, deduplicated. */
export function derivedTypesInUse(pous: readonly PLCPou[]): string[] {
  const seen = new Set<string>()

  for (const pou of pous) {
    for (const variable of pou.interface?.variables ?? []) {
      // Both spellings name an FB or struct instance; the transpiler treats them alike.
      const { definition, value } = variable.type
      if ((definition === 'derived' || definition === 'user-data-type') && value) {
        seen.add(value)
      }
    }
  }

  return [...seen]
}

/** The non-bundled installed libraries the project's POUs instantiate something from. */
export function librariesUsedByProject(
  pous: readonly PLCPou[],
  system: readonly InstalledLibraryShape[],
  bundledNames: readonly string[],
): string[] {
  return librariesOwningTypes(system, bundledNames, derivedTypesInUse(pous))
}
