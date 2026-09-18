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

import {
  ARDUINO_CLI_CAPABILITIES,
  DEFAULT_OPCUA_PROFILE,
  DEFAULT_S7_PROFILE,
  RUNTIME_V4_CAPABILITIES,
  SIMULATOR_CAPABILITIES,
} from './presets'
import type { OpcUaTargetProfile, S7TargetProfile, TargetCapabilities } from './types'

/** Minimal subset of BoardInfo the resolver consumes. Loosely typed
 *  so callers don't have to pin the full interface from middleware. */
/**
 * A capability block as a VPP manifest actually writes it.
 *
 * `Partial<TargetCapabilities>` makes the top-level keys optional but still
 * demands a complete `opcua` / `s7` profile, while the contract for both is
 * "declare only what you raise". The nested blocks have to be partial too.
 */
export type DeclaredCapabilities = Omit<Partial<TargetCapabilities>, 'opcua' | 's7'> & {
  opcua?: Partial<OpcUaTargetProfile>
  s7?: Partial<S7TargetProfile>
}

export type BoardInfoLike = {
  compiler?: string
  capabilities?: DeclaredCapabilities
  /** How the board is flashed. Declared here so readers (e.g.
   *  `isEthernetUploadTarget`) test it without casting BoardInfo to an
   *  anonymous shape. */
  uploadMethod?: 'serial' | 'ethernet'
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
  modbusRtuServer: false,
  opcuaServer: false,
  s7Server: false,
  debuggerTransports: [],
  pythonFunctionBlocks: false,
  arduinoApiCompletions: false,
  hasRuntimeStats: false,
  isInProcessSimulator: false,
  nativeRetainStore: false,
  plcStateControl: false,
  directUsbUpload: false,
  isLicensable: false,
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
 *      cares about (e.g. SLM-RP4 just sets `vppIo: true`; a licensed VPP
 *      sets `isLicensable: true`).
 *   2. Otherwise, the preset matching the legacy `compiler` field.
 *   3. Otherwise, an empty (everything-disabled) block.
 *
 * Pure function — same input always produces the same output. Safe to
 * call from any hot path; expected cost is O(1).
 */
/**
 * Fill an OPC-UA profile from `DEFAULT_OPCUA_PROFILE`, so a VPP manifest can
 * declare only what it raises.
 *
 * Merged one level deep plus `hw`: a manifest that sets `hw: { trng: true }`
 * means "this part has a TRNG", not "and no SHA-256 accelerator either", and a
 * shallow spread would drop the unmentioned hardware facts to `undefined`.
 */
function resolveOpcUaProfile(declared: Partial<OpcUaTargetProfile> | undefined): OpcUaTargetProfile {
  if (!declared) return DEFAULT_OPCUA_PROFILE
  return {
    ...DEFAULT_OPCUA_PROFILE,
    ...declared,
    hw: { ...DEFAULT_OPCUA_PROFILE.hw, ...(declared.hw ?? {}) },
  }
}

/**
 * Fill an S7 profile from `DEFAULT_S7_PROFILE`, so a VPP manifest can declare
 * only what it raises. A flat merge suffices: unlike OPC-UA there is no nested
 * `hw` block, because classic S7 has no crypto to accelerate.
 */
function resolveS7Profile(declared: Partial<S7TargetProfile> | undefined): S7TargetProfile {
  if (!declared) return DEFAULT_S7_PROFILE
  return { ...DEFAULT_S7_PROFILE, ...declared }
}

export function resolveTargetCapabilities(boardInfo: BoardInfoLike | undefined): TargetCapabilities {
  if (!boardInfo) return EMPTY_CAPABILITIES

  const base = inferFromCompiler(boardInfo)

  // The spread may put a partial nested profile on `merged`; both are replaced
  // with fully-resolved ones immediately below, so the partial never escapes.
  const declared = boardInfo.capabilities
  const merged = { ...base, ...(declared ?? {}) } as TargetCapabilities

  // Nested profiles are always resolved, even when the manifest carried no
  // capability block: returning `base` early left `opcua` / `s7` undefined on a
  // target whose preset enables a server, and the pipeline tests
  // `capability && profile` before emitting a config header. Still gated on the
  // server flag, because a profile on a target that cannot host one is noise.
  if (merged.opcuaServer) {
    merged.opcua = resolveOpcUaProfile(declared?.opcua)
  }

  if (merged.s7Server) {
    merged.s7 = resolveS7Profile(declared?.s7)
  }

  return merged
}
