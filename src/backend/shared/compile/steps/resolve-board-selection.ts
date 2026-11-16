import { type BoardInfoResolver, BoardNotFoundError } from '../../hardware/board-info-resolver'
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
  try {
    const boardInfo = resolver.resolve(boardTarget)

    const boardEntry: BoardHalsBuildEntry = {
      ...(boardInfo.platform ? { platform: boardInfo.platform } : {}),
      ...(boardInfo.core ? { core: boardInfo.core } : {}),
      ...(boardInfo.define ? { define: boardInfo.define } : {}),
      ...(boardInfo.compilerFlags?.c_flags ? { c_flags: boardInfo.compilerFlags.c_flags } : {}),
      ...(boardInfo.compilerFlags?.cxx_flags ? { cxx_flags: boardInfo.compilerFlags.cxx_flags } : {}),
      ...(boardInfo.compilerFlags?.ld_flags ? { ld_flags: boardInfo.compilerFlags.ld_flags } : {}),
      ...(boardInfo.maxDataSize !== undefined ? { max_data_size: boardInfo.maxDataSize } : {}),
      ...(boardInfo.precompiledLibraryDir ? { precompiledLibraryDir: boardInfo.precompiledLibraryDir } : {}),
      ...(boardInfo.uploadMethod ? { uploadMethod: boardInfo.uploadMethod } : {}),
      compiler: boardInfo.compiler,
      ...(boardInfo.vppScreenNames ? { vppScreenNames: boardInfo.vppScreenNames } : {}),
      ...(boardInfo.serialPorts ? { serialPorts: boardInfo.serialPorts } : {}),
      ...(boardInfo.defaultSerial ? { defaultSerial: boardInfo.defaultSerial } : {}),
      ...(boardInfo.networkInterfaces ? { networkInterfaces: boardInfo.networkInterfaces } : {}),
      ...(boardInfo.rs485FixedPins ? { rs485FixedPins: boardInfo.rs485FixedPins } : {}),
      perUartAware: boardInfo.perUartAware,
      ...(boardInfo.pinPull ? { pinPull: boardInfo.pinPull } : {}),
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
  } catch (error) {
    if (error instanceof Error && !(error instanceof BoardNotFoundError)) {
      return { ok: false, error: error.message }
    }
    return {
      ok: false,
      error: `Board "${boardTarget}" not found in hals.json or installed VPP packages.`,
    }
  }
}
