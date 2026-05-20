/**
 * Capability resolution from the platform-abstracted BoardInfo shape.
 *
 * Every UI / build check that used to switch on `boardInfo.compiler`
 * goes through this helper instead. The platform that built the
 * BoardInfo is responsible for attaching the right capability block:
 *
 *   Desktop: hals.json entries declare `capabilities`; the VPP merger
 *            attaches a capability block to every injected VPP board.
 *   Web:     orchestrator devices attach Simulator / Runtime-v4
 *            capabilities depending on the device kind.
 *
 * For backward compatibility with hals.json files that haven't been
 * migrated yet, the helper falls back to the legacy `compiler` string.
 * This is a transition affordance — once every shipped hals.json has
 * been updated, the fallback path becomes dead code (but stays for
 * defensive purposes against user-supplied JSON).
 */

import { ARDUINO_CLI_CAPABILITIES, RUNTIME_V4_CAPABILITIES, SIMULATOR_CAPABILITIES } from './presets'
import type { TargetCapabilities } from './types'

/** Minimal subset of BoardInfo the resolver consumes. Loosely typed
 *  so callers don't have to pin the full interface from middleware. */
export type BoardInfoLike = {
  compiler?: string
  capabilities?: Partial<TargetCapabilities>
  /** Legacy hals.json BoardInfo flag: present and truthy when the board
   *  came from a VPP package. Used to flip `vppIo` on for v4-derived
   *  VPP boards that didn't ship an explicit capability block. */
  vpp?: unknown
}

/**
 * Last-resort default when nothing — no capability block, no
 * recognizable compiler, no board info at all — is available. Safer
 * to assume nothing works than to leak hidden permissions.
 */
const EMPTY_CAPABILITIES: TargetCapabilities = {
  pinMapping: false,
  vppIo: false,
  modbusTcpRemote: false,
  ethercat: false,
  modbusTcpServer: false,
  opcuaServer: false,
  s7Server: false,
  debuggerTransports: [],
  pythonFunctionBlocks: false,
  arduinoApiCompletions: false,
  hasRuntimeStats: false,
  isInProcessSimulator: false,
  directUsbUpload: false,
}

/**
 * Derive a baseline capability block from the legacy `compiler` field
 * (and the `vpp` hint, for v4-derived VPP boards).
 *
 * Used when the BoardInfo doesn't carry an explicit `capabilities`
 * block — older hals.json entries or test fixtures that pre-date the
 * capability concept.
 */
function inferFromCompiler(boardInfo: BoardInfoLike): TargetCapabilities {
  const isVpp = !!boardInfo.vpp
  switch (boardInfo.compiler) {
    case 'simulator':
      return SIMULATOR_CAPABILITIES
    case 'arduino-cli':
      return ARDUINO_CLI_CAPABILITIES
    case 'openplc-compiler':
      // Both Runtime v3 and Runtime v4 used `openplc-compiler` historically.
      // VPP boards always derive from v4 today; the v3 / v4 distinction for
      // non-VPP boards has to come from somewhere else (the board name —
      // the only existing signal). Default to v4 since it's the active
      // runtime; v3 is mapped explicitly on the board entry it belongs to.
      if (isVpp) {
        return { ...RUNTIME_V4_CAPABILITIES, vppIo: true }
      }
      return RUNTIME_V4_CAPABILITIES
    default:
      return EMPTY_CAPABILITIES
  }
}

/**
 * Resolve the effective capability block for a board.
 *
 * Resolution order:
 *   1. If `boardInfo.capabilities` is present, it's authoritative.
 *      Missing fields are filled in from the matching preset (compiler
 *      + vpp hint), so a manifest can declare only the overrides it
 *      cares about (e.g. SLM-RP4 just sets `vppIo: true`).
 *   2. Otherwise, the preset matching the legacy `compiler` field.
 *   3. Otherwise, an empty (everything-disabled) block.
 *
 * Pure function — same input always produces the same output. Safe to
 * call from any hot path; expected cost is O(1).
 */
export function resolveTargetCapabilities(boardInfo: BoardInfoLike | undefined): TargetCapabilities {
  if (!boardInfo) return EMPTY_CAPABILITIES

  const base = inferFromCompiler(boardInfo)
  if (!boardInfo.capabilities) return base

  return { ...base, ...boardInfo.capabilities }
}
