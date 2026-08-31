// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Graft library-supplied C/C++ and Python function blocks into a consumer
 * project's POU list, immediately before `preprocessPous` runs.
 *
 * This module lives in `backend/shared/` and is therefore byte-identical
 * between openplc-editor and openplc-web.  The graft used to exist only as a
 * private helper inside the editor's compiler adapter, which meant web never
 * performed it and library C/C++ blocks silently failed to compile there.
 * Nothing about it is platform-specific — only *reading* the archives is (IPC
 * on desktop, HTTP on web) — so the archives arrive as an argument and the
 * decision-making lives here, once.
 *
 * ## Why a graft rather than linking a compiled chunk
 *
 * Strucpp compiles ST/IL into the archive's `chunks`, and a consumer links
 * those directly — that is how ordinary IEC library blocks work, and they need
 * none of this.  C/C++ and Python blocks are different: strucpp deliberately
 * does not compile them.  It recovers their interface from the ST header every
 * such file carries, marks the manifest entry `implementation: 'cpp' |
 * 'python'`, emits no chunk, and ships the authored file verbatim in
 * `archive.sources`.
 *
 * The consumer therefore re-derives the native bridge at *its* build time,
 * with whatever transformation that editor version implements.  A library
 * published today keeps working when the C++/Python bridge changes, because
 * the transformation is applied live rather than frozen into the archive.
 * Were the lowered ST stored instead, every previously published library would
 * break on the next bridge change until rebuilt.
 *
 * ## Renaming
 *
 * Each block's name is prefixed with the library's `namespace`
 * (`<namespace>__<block>`) so two libraries can both ship a `Foo`, and so a
 * consumer's own POU may also be called `Foo`.  The library-tree picker
 * surfaces the prefixed name, so the user authors their ST against it directly
 * and no source rewriting is needed.
 *
 * The prefix is the NAMESPACE, not `manifest.name`: `name` is checked only for
 * path safety, so a hyphenated `my-lib` would yield `my-lib__FOO`, which no ST
 * parser accepts. `namespace` is validated as a C++ identifier.
 *
 * Symbol-level renames inside the synthesized POU (the `<NAME>_VARS` struct,
 * the `<name>_setup` / `<name>_loop` functions) follow automatically, because
 * `generateCppSTCode`, `generateCBlocksHeader` and `generateCBlocksCode` all
 * derive their names from `pou.name`.
 */

import { parseHybridPouFromString } from '../../../frontend/utils/PLC/pou-text-parser'
import type { StlibArchiveDTO } from '../../../middleware/shared/ports/library-port'
import type { PLCPou, PLCProjectData } from '../../../middleware/shared/ports/types'

/** Separator between the library name and the block name. */
const LIBRARY_BLOCK_SEPARATOR = '__'

/**
 * Build the project-visible POU name for a library block.
 *
 * `libraryIdentifier` is the manifest's `namespace`, not its `name`: the result
 * is parsed as an ST identifier.
 */
export function libraryBlockPouName(libraryIdentifier: string, blockName: string): string {
  return `${libraryIdentifier}${LIBRARY_BLOCK_SEPARATOR}${blockName}`
}

/**
 * The identifier an archive's blocks are prefixed with.
 *
 * `namespace` is required of every manifest this editor builds, and validated
 * as a C++ identifier. A foreign archive may lack one, so the name is folded
 * into an identifier rather than trusted as it stands.
 */
function libraryIdentifierOf(manifest: { name: string; namespace?: string }): string {
  const declared = manifest.namespace
  if (declared && /^[A-Za-z_][A-Za-z0-9_]*$/.test(declared)) return declared
  const folded = manifest.name.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[0-9]/.test(folded) ? `_${folded}` : folded
}

/** One native block an archive ships, resolved to its authored source. */
type ResolvedNativeBlock = {
  /** Identifier form, for the POU name — see the Renaming note above. */
  libraryIdentifier: string
  blockName: string
  language: 'cpp' | 'python'
  /** The authored file, verbatim — ST header plus native body. */
  source: string
}

/**
 * Every native block an *enabled* library ships, paired with its source.
 *
 * A manifest entry whose `sourceFile` is missing from `archive.sources` is
 * skipped here and reported by `findLibrariesMissingNativeSources`, so the
 * caller can fail the build naming the library rather than letting the compile
 * die later on an undefined type.
 */
function resolveNativeBlocks(
  projectData: PLCProjectData,
  archives: StlibArchiveDTO[],
): { blocks: ResolvedNativeBlock[]; librariesMissingSource: string[] } {
  const blocks: ResolvedNativeBlock[] = []
  const librariesMissingSource = new Set<string>()

  if (!projectData.libraries || projectData.libraries.length === 0) {
    return { blocks, librariesMissingSource: [] }
  }
  const enabledNames = new Set(projectData.libraries.map((ref) => ref.name))

  for (const archive of archives) {
    const libraryName = archive.manifest?.name
    if (!libraryName || !enabledNames.has(libraryName)) continue

    const sourceByFile = new Map((archive.sources ?? []).map((s) => [s.fileName, s.source]))

    for (const entry of archive.manifest.functionBlocks ?? []) {
      if (!entry.implementation) continue
      const source = entry.sourceFile === undefined ? undefined : sourceByFile.get(entry.sourceFile)
      if (source === undefined || source.trim() === '') {
        librariesMissingSource.add(libraryName)
        continue
      }
      blocks.push({
        libraryIdentifier: libraryIdentifierOf(archive.manifest),
        blockName: entry.name,
        language: entry.implementation,
        source,
      })
    }
  }

  return { blocks, librariesMissingSource: [...librariesMissingSource] }
}

/**
 * Graft the native blocks of every *enabled* library into
 * `projectData.pous`.
 *
 * Returns the input unchanged (same reference) when the project enables no
 * libraries or none of them ship native blocks, so callers can apply this
 * unconditionally on every compile path without paying a clone.
 *
 * Only archives whose manifest name appears in `projectData.libraries`
 * contribute — an installed-but-not-enabled library must not leak its blocks
 * into the build.
 *
 * The authored file is parsed by `parseHybridPouFromString`, the same function
 * that reads a native POU off disk.  Interface, body and documentation are
 * therefore derived exactly as they are for a user-authored block: one parser,
 * one representation, nothing for the archive to hold stale.
 */
export function injectLibraryBlocks(projectData: PLCProjectData, archives: StlibArchiveDTO[]): PLCProjectData {
  const { blocks } = resolveNativeBlocks(projectData, archives)
  if (blocks.length === 0) return projectData

  const synthesized: PLCPou[] = []
  for (const block of blocks) {
    let parsed: PLCPou
    try {
      parsed = parseHybridPouFromString(block.source, block.language, 'function-block')
    } catch {
      // A block whose header the parser rejects is skipped rather than
      // aborting the build: the consumer's compile then fails on the
      // undefined type, which names the block the user actually referenced.
      continue
    }
    synthesized.push({
      ...parsed,
      name: libraryBlockPouName(block.libraryIdentifier, block.blockName),
      pouType: 'function-block',
    })
  }

  if (synthesized.length === 0) return projectData
  return { ...projectData, pous: [...projectData.pous, ...synthesized] }
}

/**
 * Every data-type name in scope for a compile: the project's own, plus those
 * the enabled libraries declare.
 *
 * The native bridge spells a pin's type from this set: strucpp declares a
 * POU member of a data type as `IEC_<NAME>`, while a function block instance
 * keeps its bare class name, and `mapUserTypeToIEC` tells them apart by
 * membership.
 *
 * A library's types are emitted into the consuming project exactly as its own
 * are, so they must be in the set too — built from the project alone, a pin
 * typed by a library got `strucpp::MB_SPACE *` against strucpp's own
 * `IEC_MB_SPACE`.
 */
export function projectAndLibraryTypeNames(
  // Only the two fields this reads, so it takes the port shape and the schema
  // shape alike — they differ on `configuration`/`configurations`, which is
  // nothing to do with type names.
  projectData: { dataTypes?: { name: string }[]; libraries?: { name: string }[] },
  archives: readonly unknown[],
): string[] {
  const names = (projectData.dataTypes ?? []).map((dataType) => dataType.name)

  const enabled = new Set((projectData.libraries ?? []).map((ref) => ref.name))
  for (const archive of archives as StlibArchiveDTO[]) {
    const libraryName = archive?.manifest?.name
    if (!libraryName || !enabled.has(libraryName)) continue
    for (const type of archive.manifest.types ?? []) {
      names.push(type.name)
    }
  }
  return names
}

/**
 * Names of enabled libraries that declare native blocks whose source is
 * missing from the archive.
 *
 * A `.stlib` may legitimately omit ST sources (published closed-source)
 * because strucpp already compiled those into `chunks`.  Native blocks have no
 * chunk — their source *is* the deliverable — so strucpp keeps them even under
 * `--no-source`.  An archive that lacks them is malformed or was truncated in
 * transit; callers surface this naming the library, rather than letting the
 * compile fail later with an undefined-type diagnostic that points nowhere
 * useful.
 */
export function findLibrariesMissingNativeSources(projectData: PLCProjectData, archives: StlibArchiveDTO[]): string[] {
  return resolveNativeBlocks(projectData, archives).librariesMissingSource
}
