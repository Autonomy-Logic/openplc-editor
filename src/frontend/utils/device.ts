/**
 * Thin façade over `resolveTargetCapabilities` so legacy callers
 * keep working with the predicates they already use. Every helper
 * here delegates to the capability resolver — no compiler-string
 * checks remain.
 *
 * New code should call `resolveTargetCapabilities(boardInfo)`
 * directly and read the specific capability flag it cares about.
 * These predicates exist mainly as adapters for sites that asked
 * the older question "is this <kind> of target?" rather than the
 * cleaner "does this target support <feature>?".
 */

import { parseRuntimeVersion } from '@root/backend/shared/firmware/runtime-version-gate'
import { type BoardInfoLike, resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'

/**
 * Minimal board info shape used by device utility functions.
 * Compatible with both BoardInfo from ports and store slice types.
 */
type BoardLike = BoardInfoLike | undefined

/**
 * Determines if a board is an Arduino target — pin-mapping based,
 * not the in-process simulator. Used at call sites that need to
 * distinguish a "real Arduino board" from Runtime / Simulator.
 */
export function isArduinoTarget(boardInfo: BoardLike): boolean {
  if (!boardInfo) return false
  const caps = resolveTargetCapabilities(boardInfo)
  return caps.pinMapping && !caps.isInProcessSimulator
}

/**
 * Determines if a board is an OpenPLC Runtime target (v3 or v4) —
 * i.e. a networked runtime, not Arduino USB upload, not the
 * in-process simulator.
 *
 * The `debuggerTransports.length > 0` guard treats EMPTY_CAPABILITIES
 * (unknown / unrecognized boards) as "not a runtime" — otherwise an
 * empty capability block would pass the `!directUsbUpload &&
 * !isInProcessSimulator` predicate by default-falsey-ness.
 */
export function isOpenPLCRuntimeTarget(boardInfo: BoardLike): boolean {
  if (!boardInfo) return false
  const caps = resolveTargetCapabilities(boardInfo)
  if (caps.debuggerTransports.length === 0) return false
  return !caps.directUsbUpload && !caps.isInProcessSimulator
}

/**
 * Determines if a board is the in-process Simulator target.
 */
export function isSimulatorTarget(boardInfo: BoardLike): boolean {
  return resolveTargetCapabilities(boardInfo).isInProcessSimulator
}

/**
 * Extracts the expected runtime version from the board target name.
 */
export function getExpectedRuntimeVersion(boardTarget: string): string | undefined {
  const match = boardTarget.match(/OpenPLC Runtime (v\d+)/i)
  return match ? match[1].toLowerCase() : undefined
}

/**
 * Determines if a board target is OpenPLC Runtime v4 (including any
 * VPP board that derives from v4).
 *
 * Driven by the websocket debugger transport, which is v4-specific
 * — Runtime v3 only speaks Modbus TCP, Arduino uses Modbus RTU/TCP,
 * Simulator uses RTU over emulated serial. Falls back to the board
 * name when boardInfo is unavailable, since older callers only had
 * the name string.
 */
export function isOpenPLCRuntimeV4Target(boardTarget: string, boardInfo?: BoardLike): boolean {
  if (boardInfo) {
    const caps = resolveTargetCapabilities(boardInfo)
    if (caps.debuggerTransports.includes('websocket')) return true
  }
  return getExpectedRuntimeVersion(boardTarget) === 'v4'
}

export type RuntimeVersionValidationResult = {
  status: 'ok' | 'missing' | 'mismatch'
  message?: string
}

/**
 * Pull the major version number out of a runtime version string.
 *
 * Handles two shapes the runtime has returned over time:
 *   - Legacy short form: `"v4"`, `"v3"` (what `getExpectedRuntimeVersion`
 *     extracts from a board target name).
 *   - Full SemVer-ish: `"4.1.0-RC3"`, `"4.2.0-rc1"`, `"3.0.0"` (what
 *     `/api/version` actually emits on the wire today).
 *
 * For SemVer-ish strings we route through the shared
 * `parseRuntimeVersion` so the parser stays in one place; legacy
 * short forms (`"v4"` / `"v3"`) are pre-strucpp and don't parse,
 * so we strip the leading `v` ourselves and pull the first numeric
 * run.  Returns the leading digit(s) with no `v` prefix; falls back
 * to the raw input when the string starts with neither a `v` nor a
 * digit (so unexpected formats stay loud rather than silently
 * passing).
 */
function extractRuntimeMajor(version: string): string {
  const parsed = parseRuntimeVersion(version)
  if (parsed) return String(parsed.major)
  // Pre-strucpp short forms (`"v4"`, `"v3"`) — `parseRuntimeVersion`
  // rejects these on purpose because they're not enough to gate
  // strucpp compatibility, but the *major* digit is still well-defined
  // and useful for the board-target equality check below.
  const stripped = version.replace(/^v/i, '')
  const match = stripped.match(/^\d+/)
  return match ? match[0] : version
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

  // Compare on the major version number only — `expectedVersion` is
  // `"v4"`/`"v3"` (from the board target), `detectedVersion` is now
  // a full SemVer-ish string like `"4.1.0-RC3"` on current runtimes
  // (older builds answered with the short `"v4"` form).  Both
  // collapse to `"4"`/`"3"` for the actual compatibility check.
  const expectedMajor = extractRuntimeMajor(expectedVersion)
  const detectedMajor = extractRuntimeMajor(detectedVersion)

  if (expectedMajor !== detectedMajor) {
    return {
      status: 'mismatch',
      message: `Runtime version mismatch: Selected "${boardTarget}" but connected to a ${detectedVersion} runtime. Please update your device configuration to match the connected runtime.`,
    }
  }

  return { status: 'ok' }
}
