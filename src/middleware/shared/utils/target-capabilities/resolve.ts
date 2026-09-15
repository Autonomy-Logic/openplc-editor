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
 * `Partial<TargetCapabilities>` is not quite right: it makes the top-level
 * keys optional but still demands a COMPLETE `opcua` / `s7` profile, while the
 * documented contract for both is "declare only what you raise"
 * (`{ maxSessions: 2 }` and nothing else). The nested blocks have to be
 * partial too, which is exactly what the resolver functions below already
 * accept — this type just says so.
 */
export type DeclaredCapabilities = Omit<Partial<TargetCapabilities>, 'opcua' | 's7'> & {
  opcua?: Partial<OpcUaTargetProfile>
  s7?: Partial<S7TargetProfile>
}

export type BoardInfoLike = {
  compiler?: string
  capabilities?: DeclaredCapabilities
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
 * declare only what it raises (`{ maxSessions: 2 }` and nothing else).
 *
 * Merged one level deep plus `hw`, because a manifest that sets
 * `hw: { trng: true }` means "this part has a TRNG", not "and it has no
 * SHA-256 accelerator either" — a shallow spread would silently drop the
 * unmentioned hardware facts to `undefined` and the generated header would
 * emit them as absent rather than false.
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
 * only what it raises (`{ maxClients: 4 }` and nothing else).
 *
 * A flat merge suffices here — unlike the OPC-UA profile there is no nested
 * `hw` block, because classic S7 has no crypto to accelerate.
 */
function resolveS7Profile(declared: Partial<S7TargetProfile> | undefined): S7TargetProfile {
  if (!declared) return DEFAULT_S7_PROFILE
  return { ...DEFAULT_S7_PROFILE, ...declared }
}

export function resolveTargetCapabilities(boardInfo: BoardInfoLike | undefined): TargetCapabilities {
  if (!boardInfo) return EMPTY_CAPABILITIES

  const base = inferFromCompiler(boardInfo)

  // The spread may put a PARTIAL nested profile on `merged`; both are replaced
  // with fully-resolved ones immediately below, so the partial never escapes.
  // The assertion is the narrow, local statement of that.
  const declared = boardInfo.capabilities
  const merged = { ...base, ...(declared ?? {}) } as TargetCapabilities

  // ---------------------------------------------------------------------
  // Nested profiles are ALWAYS resolved, whether or not the manifest
  // mentioned them — and whether or not it carried a capability block at all.
  //
  // This used to return `base` early when there was no `capabilities` block,
  // which left `opcua` / `s7` undefined on any target whose PRESET enables a
  // server. The pipeline tests `capability && profile` before emitting a
  // config header, so such a target silently got no server: the capability
  // said yes and the profile said nothing.
  //
  // It also means a VPP published before these profiles existed keeps working
  // as it is. A manifest that says `opcuaServer: true` and stops there gets
  // the defaults, so nothing has to be rebuilt to pick up a new field --
  // which is the whole point of having defaults rather than requirements.
  //
  // The defaults are deliberately the MOST COMPATIBLE rather than the most
  // capable: OPC-UA with no security policy, no certificates and no assumed
  // crypto hardware; S7 with two clients and the 240-byte PDU every client
  // copes with. A target that can do more says so; one that says nothing gets
  // the configuration that works everywhere.
  //
  // Still gated on the server flag itself, because a profile on a target that
  // cannot host a server is noise -- and that flag is a real per-target fact
  // (open62541 needs ~190 KB of flash), so it cannot be defaulted on.
  // ---------------------------------------------------------------------
  if (merged.opcuaServer) {
    merged.opcua = resolveOpcUaProfile(declared?.opcua)
  }

  if (merged.s7Server) {
    merged.s7 = resolveS7Profile(declared?.s7)
  }

  return merged
}
