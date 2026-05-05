/**
 * Minimal board info shape used by device utility functions.
 * Compatible with both BoardInfo from ports and store slice types.
 */
type BoardLike = { compiler?: string; vpp?: unknown } | undefined

/**
 * Determines if a board is an Arduino target based on its compiler.
 */
export function isArduinoTarget(boardInfo: BoardLike): boolean {
  if (!boardInfo) return false
  return boardInfo.compiler === 'arduino-cli'
}

/**
 * Determines if a board is an OpenPLC Runtime target based on its compiler.
 */
export function isOpenPLCRuntimeTarget(boardInfo: BoardLike): boolean {
  if (!boardInfo) return false
  return boardInfo.compiler === 'openplc-compiler'
}

/**
 * Determines if a board is the built-in simulator target.
 */
export function isSimulatorTarget(boardInfo: BoardLike): boolean {
  if (!boardInfo) return false
  return boardInfo.compiler === 'simulator'
}

/**
 * Extracts the expected runtime version from the board target name.
 */
export function getExpectedRuntimeVersion(boardTarget: string): string | undefined {
  const match = boardTarget.match(/OpenPLC Runtime (v\d+)/i)
  return match ? match[1].toLowerCase() : undefined
}

/**
 * Determines if a board target is OpenPLC Runtime v4.
 *
 * Returns true for:
 *   - The hardcoded "OpenPLC Runtime v4" board in hals.json
 *   - Any VPP board whose manifest declared target.type = 'runtime-v4'
 *     (mergeVppBoards sets compiler='openplc-compiler' only for those)
 *
 * The boardInfo argument is optional for backward compatibility with
 * callers that only have the board name, but VPP boards require it —
 * their board names (e.g., "SLM-RP4") don't contain the "v4" suffix.
 */
export function isOpenPLCRuntimeV4Target(boardTarget: string, boardInfo?: BoardLike): boolean {
  if (boardInfo?.vpp && boardInfo.compiler === 'openplc-compiler') return true
  const version = getExpectedRuntimeVersion(boardTarget)
  return version === 'v4'
}

export type RuntimeVersionValidationResult = {
  status: 'ok' | 'missing' | 'mismatch'
  message?: string
}

/**
 * Validates that the detected runtime version matches the expected version.
 */
export function validateRuntimeVersion(
  boardTarget: string,
  detectedVersion: string | undefined,
): RuntimeVersionValidationResult {
  const expectedVersion = getExpectedRuntimeVersion(boardTarget)

  if (!expectedVersion) {
    return { status: 'ok' }
  }

  if (!detectedVersion) {
    return {
      status: 'missing',
      message:
        'The runtime you are connecting to is older than the version of the editor. You may experience connection issues. Please update your runtime to the latest version.',
    }
  }

  const normalizedDetected = detectedVersion.toLowerCase()

  if (normalizedDetected !== expectedVersion) {
    return {
      status: 'mismatch',
      message: `Runtime version mismatch: Selected "${boardTarget}" but connected to a ${normalizedDetected.toUpperCase()} runtime. Please update your device configuration to match the connected runtime.`,
    }
  }

  return { status: 'ok' }
}
