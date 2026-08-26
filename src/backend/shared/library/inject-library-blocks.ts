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
 * Each block's name is prefixed with the library's manifest name
 * (`<library>__<block>`) so two libraries can both ship a `Foo`, and so a
 * consumer's own POU may also be called `Foo`.  The library-tree picker
 * surfaces the prefixed name, so the user authors their ST against it directly
 * and no source rewriting is needed.
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

/** Build the project-visible POU name for a library block. */
export function libraryBlockPouName(libraryName: string, blockName: string): string {
  return `${libraryName}${LIBRARY_BLOCK_SEPARATOR}${blockName}`
}

/** One native block an archive ships, resolved to its authored source. */
type ResolvedNativeBlock = {
  libraryName: string
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
        libraryName,
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
      name: libraryBlockPouName(block.libraryName, block.blockName),
      pouType: 'function-block',
    })
  }

  if (synthesized.length === 0) return projectData
  return { ...projectData, pous: [...projectData.pous, ...synthesized] }
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
