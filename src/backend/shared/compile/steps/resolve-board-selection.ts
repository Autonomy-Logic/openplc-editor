/**
 * Resolve the user's selected board to the canonical pipeline inputs
 * (`boardEntry`, `boardRuntime`, plus the three mutually-exclusive
 * runtime-classification flags) the shared `runCompilePipeline`
 * branches on.
 *
 * Both platforms used to do this lookup + adapt inline at the entry
 * to `compileProgram`, duplicated almost character-for-character.
 * Centralising the editor's `BoardInfoResolver`-backed flow here
 * means a future tweak (new runtime kind, new VPP-side capability)
 * lands once and the editor + web compile entrypoints stay in lockstep.
 *
 * Pure dispatch — no I/O.  Caller wires the resolver with its own
 * `hals.json` source (editor: filesystem; web: bundled via Vite's
 * `import.meta.glob`) and `PackageManagerPort` (editor: the real
 * module; web: a no-op stub until the VPP catalog lands there).
 *
 * Returns either the resolved selection or an `error` discriminator
 * with a human-readable message the renderer can surface verbatim.
 */

import type { BoardInfoResolver } from '../../hardware/board-info-resolver'
import type { BoardHalsBuildEntry } from '../pipeline'

export type ResolvedBoardSelection =
  | {
      ok: true
      boardEntry: BoardHalsBuildEntry
      boardRuntime: string
      isSimulator: boolean
      isRuntimeV4: boolean
      isRuntimeV3: boolean
    }
  | { ok: false; error: string }

export function resolveBoardSelection(resolver: BoardInfoResolver, boardTarget: string): ResolvedBoardSelection {
  // `BoardInfoResolver.resolve` covers both hals.json and installed
  // VPP packages — the editor's canonical lookup.  Either source can
  // raise (unknown board, malformed manifest, etc.); the caller only
  // needs the boolean ok / error message split.
  try {
    const boardInfo = resolver.resolve(boardTarget)

    // Adapt `BoardBuildInfo` → pipeline's `BoardHalsBuildEntry` shape.
    // Runtime-v3 / runtime-v4 / simulator targets carry an empty
    // `platform` (intentionally — they don't go through arduino-cli),
    // so the cast bypasses the shape's required-platform constraint;
    // downstream code only dereferences `platform` on the arduino-cli
    // compile + upload paths, which those runtimes skip.
    const boardEntry: BoardHalsBuildEntry = {
      ...(boardInfo.platform ? { platform: boardInfo.platform } : {}),
      ...(boardInfo.core ? { core: boardInfo.core } : {}),
      ...(boardInfo.define ? { define: boardInfo.define } : {}),
      // Presence of a VPP license-store backend → gates the
      // `VPP_HAS_LICENSE_STORE` capability define. The resolver already
      // collapsed the string|array `hal.licenseStore` into resolved
      // paths; forward the (basename-preserving) list so the pipeline
      // reads a single truthy field.
      ...(boardInfo.licenseStoreSourceFiles.length > 0
        ? { licenseStore: boardInfo.licenseStoreSourceFiles.map((p) => p.split(/[\\/]/).pop() ?? p) }
        : {}),
      ...(boardInfo.compilerFlags?.c_flags ? { c_flags: boardInfo.compilerFlags.c_flags } : {}),
      ...(boardInfo.compilerFlags?.cxx_flags ? { cxx_flags: boardInfo.compilerFlags.cxx_flags } : {}),
      ...(boardInfo.compilerFlags?.ld_flags ? { ld_flags: boardInfo.compilerFlags.ld_flags } : {}),
      ...(boardInfo.maxDataSize !== undefined ? { max_data_size: boardInfo.maxDataSize } : {}),
      // Per-board extra libraries — the editor's arduino-cli `lib
      // install` step uses these.  Identical contract for static
      // hals.json (`extra_libraries`) and VPP manifests
      // (`hal.extraArduinoLibraries`); both arrive in
      // `BoardBuildInfo.extraArduinoLibraries` from the resolver.
      ...(boardInfo.extraArduinoLibraries && boardInfo.extraArduinoLibraries.length > 0
        ? { extra_libraries: boardInfo.extraArduinoLibraries }
        : {}),
      // Prebuilt arduino-hal (mixed): the precompiled vendor library to link
      // (2nd --library) + the ABI-locked core version to install/verify. Both
      // come from the VPP manifest via BoardBuildInfo; absent for source boards.
      ...(boardInfo.precompiledLibraryDir ? { precompiledLibraryDir: boardInfo.precompiledLibraryDir } : {}),
      ...(boardInfo.coreVersion ? { coreVersion: boardInfo.coreVersion } : {}),
      // Capability resolution inputs.  `resolveTargetCapabilities`
      // reads `compiler` + `vpp` + `capabilities` on whatever board
      // shape it's handed — without forwarding all three the
      // resolver picks the empty preset and `vppIo` collapses to
      // false, which silently disables `vpp_config.h` emission for
      // every VPP arduino-cli target (Opta, future P1AM VPP).
      compiler: boardInfo.compiler,
      ...(boardInfo.source === 'vpp' ? { vpp: true } : {}),
      ...(boardInfo.capabilities ? { capabilities: boardInfo.capabilities } : {}),
    } as unknown as BoardHalsBuildEntry

    return {
      ok: true,
      boardEntry,
      boardRuntime: boardInfo.boardRuntime,
      isSimulator: boardInfo.isSimulator,
      isRuntimeV4: boardInfo.isRuntimeV4,
      isRuntimeV3: boardInfo.isRuntimeV3,
    }
  } catch {
    return {
      ok: false,
      error: `Board "${boardTarget}" not found in hals.json or installed VPP packages.`,
    }
  }
}
