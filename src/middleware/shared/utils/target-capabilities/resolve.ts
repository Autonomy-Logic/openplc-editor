import {
  ALL_ADDRESS_PRODUCERS_ACTIVE,
  ARDUINO_CLI_CAPABILITIES,
  DEFAULT_OPCUA_PROFILE,
  DEFAULT_S7_PROFILE,
  RUNTIME_V4_CAPABILITIES,
  SIMULATOR_CAPABILITIES,
} from './presets'
import type { AddressProducerCapabilities, OpcUaTargetProfile, S7TargetProfile, TargetCapabilities } from './types'

/** Minimal subset of BoardInfo the resolver consumes. Loosely typed
 *  so callers don't have to pin the full interface from middleware. */
/**
 * A capability block as a VPP manifest actually writes it.
 *
 * `Partial<TargetCapabilities>` makes the top-level keys optional but still
 * demands a complete `opcua` / `s7` profile, while the contract for both is
 * "declare only what you raise". The nested blocks have to be partial too.
 *
 * `modbusRtuMaster` is not declarable by a VPP manifest: the resolver ignores it
 * on a VPP board, so the family preset stands, and the master profile narrows it
 * to the board's spare UARTs. Built-in hals.json entries do declare it.
 */
export type DeclaredCapabilities = Omit<Partial<TargetCapabilities>, 'opcua' | 's7' | 'modbusRtuMaster'> & {
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
  modbusTcpMaster: false,
  modbusRtuMaster: false,
  ethercat: false,
  modbusTcpServer: false,
  modbusRtuServer: false,
  opcuaServer: false,
  s7Server: false,
  networkSockets: null,
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

/** Fill an S7 profile from `DEFAULT_S7_PROFILE`, so a VPP manifest can declare only what it raises. */
/** The preset's own profile is the floor, not the microcontroller's: Runtime v4
 *  holds 64 areas and addresses every buffer, and answering it with the
 *  bare-metal eight sized a v4 project short of what its plugin serves. */
function resolveS7Profile(
  declared: Partial<S7TargetProfile> | undefined,
  base: S7TargetProfile | undefined,
): S7TargetProfile {
  const floor = base ?? DEFAULT_S7_PROFILE
  if (!declared) return floor
  return { ...floor, ...declared }
}

export function resolveTargetCapabilities(boardInfo: BoardInfoLike | undefined): TargetCapabilities {
  if (!boardInfo) return EMPTY_CAPABILITIES

  const base = inferFromCompiler(boardInfo)

  const declared = boardInfo.capabilities
  const merged = { ...base, ...(declared ?? {}) } as TargetCapabilities

  if (merged.opcuaServer) {
    merged.opcua = resolveOpcUaProfile(declared?.opcua)
  }

  if (merged.s7Server) {
    merged.s7 = resolveS7Profile(declared?.s7, base.s7)
  }

  if (boardInfo.vpp) {
    merged.modbusRtuMaster = base.modbusRtuMaster
  }

  return merged
}

/** The fields that say a producer is active. A block naming none of them has
 *  not spoken about producers, whatever else it declares. */
const ADDRESS_PRODUCER_KEYS = ['pinMapping', 'vppIo', 'modbusTcpMaster', 'modbusRtuMaster', 'ethercat'] as const

/** True when nothing in the board info says which producers are active. */
function saysNothingAboutProducers(boardInfo: BoardInfoLike | undefined): boolean {
  if (!boardInfo) return true
  const declared: Partial<AddressProducerCapabilities> | undefined = boardInfo.capabilities
  if (declared && ADDRESS_PRODUCER_KEYS.some((key) => declared[key] !== undefined)) return false
  return inferFromCompiler(boardInfo) === EMPTY_CAPABILITIES
}

/** Which producers claim IEC addresses — the answer for ADDRESS SPACE, never for UI or feature gating. */
export function resolveAddressProducerCapabilities(boardInfo: BoardInfoLike | undefined): AddressProducerCapabilities {
  if (saysNothingAboutProducers(boardInfo)) return ALL_ADDRESS_PRODUCERS_ACTIVE
  return resolveTargetCapabilities(boardInfo)
}
