import type { AvailableBoardInfo } from '@root/renderer/store/slices/device/types'

/**
 * Determines if a board is an Arduino target based on its compiler.
 * Arduino targets use 'arduino-cli' compiler, while OpenPLC Runtime uses 'openplc-compiler'.
 *
 * @param boardInfo - The board information from availableBoards map
 * @returns true if the board is an Arduino target, false if it's OpenPLC Runtime
 */
export function isArduinoTarget(boardInfo: AvailableBoardInfo | undefined): boolean {
  if (!boardInfo) {
    return false
  }
  return boardInfo.compiler === 'arduino-cli'
}

/**
 * Determines if a board is an OpenPLC Runtime target based on its compiler.
 *
 * @param boardInfo - The board information from availableBoards map
 * @returns true if the board is an OpenPLC Runtime target, false otherwise
 */
export function isOpenPLCRuntimeTarget(boardInfo: AvailableBoardInfo | undefined): boolean {
  if (!boardInfo) {
    return false
  }
  return boardInfo.compiler === 'openplc-compiler'
}
