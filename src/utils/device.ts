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

/**
 * Extracts the expected runtime version from the board target name.
 * This is used to validate that the connected runtime matches the selected target.
 *
 * @param boardTarget - The board target name (e.g., "OpenPLC Runtime v3", "OpenPLC Runtime v4")
 * @returns The expected runtime version string (e.g., "v3", "v4") or undefined if not a runtime target
 */
export function getExpectedRuntimeVersion(boardTarget: string): string | undefined {
  const match = boardTarget.match(/OpenPLC Runtime (v\d+)/i)
  return match ? match[1].toLowerCase() : undefined
}

/**
 * Validates that the detected runtime version matches the expected version based on the selected board target.
 *
 * @param boardTarget - The selected board target name
 * @param detectedVersion - The runtime version detected from the API response header
 * @returns An object with isValid boolean and an optional error message
 */
export function validateRuntimeVersion(
  boardTarget: string,
  detectedVersion: string | undefined,
): { isValid: boolean; errorMessage?: string } {
  const expectedVersion = getExpectedRuntimeVersion(boardTarget)

  // If not a runtime target, no validation needed
  if (!expectedVersion) {
    return { isValid: true }
  }

  // If no version detected from runtime, it might be an older runtime without the header
  if (!detectedVersion) {
    return {
      isValid: false,
      errorMessage: `Could not detect runtime version. The runtime may need to be updated to support version detection.`,
    }
  }

  // Normalize detected version for comparison (expectedVersion is already lowercase from getExpectedRuntimeVersion)
  const normalizedDetected = detectedVersion.toLowerCase()

  if (normalizedDetected !== expectedVersion) {
    return {
      isValid: false,
      errorMessage: `Runtime version mismatch: Selected "${boardTarget}" but connected to a ${normalizedDetected.toUpperCase()} runtime. Please update your device configuration to match the connected runtime.`,
    }
  }

  return { isValid: true }
}
