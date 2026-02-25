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
 * Determines if a board is the built-in simulator target.
 * The simulator uses an emulated ATmega2560 and requires no physical hardware.
 *
 * @param boardInfo - The board information from availableBoards map
 * @returns true if the board is the simulator target, false otherwise
 */
export function isSimulatorTarget(boardInfo: AvailableBoardInfo | undefined): boolean {
  if (!boardInfo) {
    return false
  }
  return boardInfo.compiler === 'simulator'
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
 * Determines if a board target is OpenPLC Runtime v4.
 * This is used to check if features like Modbus Server and Remote IO are supported.
 *
 * @param boardTarget - The board target name (e.g., "OpenPLC Runtime v3", "OpenPLC Runtime v4")
 * @returns true if the board is OpenPLC Runtime v4, false otherwise
 */
export function isOpenPLCRuntimeV4Target(boardTarget: string): boolean {
  const version = getExpectedRuntimeVersion(boardTarget)
  return version === 'v4'
}

/**
 * Result of runtime version validation.
 * - 'ok': Version matches or not a runtime target
 * - 'missing': Runtime didn't report version (older runtime without header)
 * - 'mismatch': Version reported but doesn't match selected target
 */
export type RuntimeVersionValidationResult = {
  status: 'ok' | 'missing' | 'mismatch'
  message?: string
}

/**
 * Validates that the detected runtime version matches the expected version based on the selected board target.
 *
 * @param boardTarget - The selected board target name
 * @param detectedVersion - The runtime version detected from the API response header
 * @returns An object with status ('ok', 'missing', or 'mismatch') and an optional message
 */
export function validateRuntimeVersion(
  boardTarget: string,
  detectedVersion: string | undefined,
): RuntimeVersionValidationResult {
  const expectedVersion = getExpectedRuntimeVersion(boardTarget)

  // If not a runtime target, no validation needed
  if (!expectedVersion) {
    return { status: 'ok' }
  }

  // If no version detected from runtime, it might be an older runtime without the header
  if (!detectedVersion) {
    return {
      status: 'missing',
      message:
        'The runtime you are connecting to is older than the version of the editor. You may experience connection issues. Please update your runtime to the latest version.',
    }
  }

  // Normalize detected version for comparison (expectedVersion is already lowercase from getExpectedRuntimeVersion)
  const normalizedDetected = detectedVersion.toLowerCase()

  if (normalizedDetected !== expectedVersion) {
    return {
      status: 'mismatch',
      message: `Runtime version mismatch: Selected "${boardTarget}" but connected to a ${normalizedDetected.toUpperCase()} runtime. Please update your device configuration to match the connected runtime.`,
    }
  }

  return { status: 'ok' }
}
