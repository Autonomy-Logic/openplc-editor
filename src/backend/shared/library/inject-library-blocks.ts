// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Graft library-supplied C/C++ and Python function blocks into a
 * consumer project's POU list, immediately before `preprocessPous`
 * runs.
 *
 * This module lives in `backend/shared/` and is therefore
 * byte-identical between openplc-editor and openplc-web.  It used to
 * exist only as a private helper inside the editor's compiler
 * adapter, which meant web never performed the graft at all and
 * library C/C++ blocks silently failed to compile there.  Nothing
 * about the graft is platform-specific — only *reading* the archives
 * is (IPC on desktop, HTTP on web) — so the archives arrive as an
 * argument and the decision-making lives here, once.
 *
 * ## Why a graft rather than compiling the blocks into the archive
 *
 * Strucpp compiles ST/IL into the archive's `chunks`, and a consumer
 * links those directly — that is how ordinary IEC library blocks
 * work, and they need none of this.  C/C++ and Python blocks are
 * different: strucpp never compiles them.  Their IEC-visible form is
 * a generated ST stub that calls into `c_blocks.h` / `iec_python.h`
 * externs, and *that stub encodes the current ABI* — the
 * `<NAME>_VARS` struct layout, the `<name>_setup` / `<name>_loop`
 * signatures, the pointer-assignment convention.
 *
 * So the archive carries the author's **original source, verbatim**,
 * and the consuming editor re-derives the stub at compile time with
 * whatever transformation that editor version implements.  A library
 * published today keeps working when the C++/Python bridge changes,
 * because the transformation is applied live rather than frozen into
 * the archive.  Store the transformed ST instead and every previously
 * published library breaks on the next ABI change until it is rebuilt
 * — which is exactly the outcome this design exists to prevent.
 *
 * Because of that, a library archive that ships C/C++ or Python
 * blocks *must* carry their sources; see `assertNativeSourcesPresent`.
 *
 * ## Renaming
 *
 * Each block's name is prefixed with the library's manifest name
 * (`<library>__<block>`) so two libraries can both ship a `Foo`, and
 * so a consumer's own POU may also be called `Foo`.  The library-tree
 * picker surfaces the prefixed name, so the user authors their ST
 * against it directly and no source rewriting is needed.
 *
 * Symbol-level renames inside the synthesized POU (the `<NAME>_VARS`
 * struct, the `<name>_setup` / `<name>_loop` functions) follow
 * automatically, because `generateCppSTCode`, `generateCBlocksHeader`
 * and `generateCBlocksCode` all derive their names from `pou.name`.
 */

import type { StlibArchiveDTO } from '../../../middleware/shared/ports/library-port'
import type { PLCPou, PLCProjectData, PLCVariable } from '../../../middleware/shared/ports/types'

/** Separator between the library name and the block name. */
const LIBRARY_BLOCK_SEPARATOR = '__'

/** One native (non-strucpp) block as the archive carries it. */
type ArchiveNativeBlock = {
  name: string
  code: string
  variables: unknown[]
  documentation?: string
}

/** Build the project-visible POU name for a library block. */
export function libraryBlockPouName(libraryName: string, blockName: string): string {
  return `${libraryName}${LIBRARY_BLOCK_SEPARATOR}${blockName}`
}

/**
 * Every native block an archive ships, paired with the POU language
 * the consumer should treat it as.  `cppBlocks` and `pythonBlocks`
 * are structurally identical; only the language they lower through
 * differs.
 */
function nativeBlocksOf(archive: StlibArchiveDTO): Array<{ block: ArchiveNativeBlock; language: 'cpp' | 'python' }> {
  return [
    ...(archive.cppBlocks ?? []).map((block) => ({ block, language: 'cpp' as const })),
    ...(archive.pythonBlocks ?? []).map((block) => ({ block, language: 'python' as const })),
  ]
}

/**
 * Graft the native blocks of every *enabled* library into
 * `projectData.pous`.
 *
 * Returns the input unchanged (same reference) when the project
 * enables no libraries or none of them ship native blocks, so callers
 * can apply this unconditionally on every compile path without paying
 * a clone.
 *
 * Only archives whose manifest name appears in `projectData.libraries`
 * contribute — an installed-but-not-enabled library must not leak its
 * blocks into the build.
 */
export function injectLibraryBlocks(projectData: PLCProjectData, archives: StlibArchiveDTO[]): PLCProjectData {
  if (!projectData.libraries || projectData.libraries.length === 0) return projectData

  const enabledNames = new Set(projectData.libraries.map((ref) => ref.name))
  const synthesized: PLCPou[] = []

  for (const archive of archives) {
    const libraryName = archive.manifest?.name
    if (!libraryName || !enabledNames.has(libraryName)) continue

    for (const { block, language } of nativeBlocksOf(archive)) {
      synthesized.push({
        name: libraryBlockPouName(libraryName, block.name),
        pouType: 'function-block',
        // `variables` rides through the archive as `unknown[]` by design —
        // the manifest layer doesn't know our PLCVariable shape.  The
        // archives are produced by this same editor's build pipeline from
        // the same PLCVariable type, so the narrowing matches reality.
        interface: { variables: block.variables as PLCVariable[] },
        body: { language, value: block.code },
        documentation: block.documentation ?? '',
      })
    }
  }

  if (synthesized.length === 0) return projectData

  return { ...projectData, pous: [...projectData.pous, ...synthesized] }
}

/**
 * Names of enabled libraries that declare native blocks in their
 * manifest but ship no source for them.
 *
 * A `.stlib` may legitimately omit ST/IL sources (the "don't publish
 * sources" option) because strucpp already compiled those into
 * `chunks`.  C/C++ and Python blocks have no chunks — their source
 * *is* the deliverable, and an archive without it is unbuildable by
 * any consumer.  Callers surface this as a build error naming the
 * library, rather than letting the compile fail later with an
 * undefined-symbol diagnostic that points nowhere useful.
 */
export function findLibrariesMissingNativeSources(projectData: PLCProjectData, archives: StlibArchiveDTO[]): string[] {
  if (!projectData.libraries || projectData.libraries.length === 0) return []

  const enabledNames = new Set(projectData.libraries.map((ref) => ref.name))
  const missing: string[] = []

  for (const archive of archives) {
    const libraryName = archive.manifest?.name
    if (!libraryName || !enabledNames.has(libraryName)) continue

    const blocks = nativeBlocksOf(archive)
    if (blocks.length === 0) continue
    if (blocks.some(({ block }) => typeof block.code !== 'string' || block.code.trim() === '')) {
      missing.push(libraryName)
    }
  }

  return missing
}
