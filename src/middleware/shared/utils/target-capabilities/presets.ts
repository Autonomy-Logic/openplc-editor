/**
 * Capability presets for the targets shipped with the vanilla editor.
 * Each preset is intentionally complete (no implicit defaults) so the
 * matrix is auditable in one place.
 *
 * Boards in hals.json should declare their capability block explicitly.
 * `resolveTargetCapabilities` falls back to deriving one from these
 * presets via the legacy `compiler` field if the block is missing —
 * that path exists only for older hals.json files that haven't been
 * updated yet.
 */

import type { TargetCapabilities } from './types'

export const SIMULATOR_CAPABILITIES: TargetCapabilities = {
  pinMapping: false,
  vppIo: false,
  // Servers and remote IO are no-ops at the bytecode level but reported
  // available so projects authored for Runtime v4 don't get nagged
  // when the user simulates them.
  modbusTcpRemote: true,
  ethercat: true,
  modbusTcpServer: true,
  opcuaServer: true,
  s7Server: true,
  // RTU over the emulated virtual serial port the in-process simulator
  // exposes — not Modbus TCP.
  debuggerTransports: ['modbus-serial'],
  pythonFunctionBlocks: true,
  arduinoApiCompletions: true,
  hasRuntimeStats: false,
  isInProcessSimulator: true,
  directUsbUpload: true,
  // No shipped Simulator VPP declares a license-store backend today, so
  // the licensing UX stays hidden. Follows the manifest, not the kind —
  // a Simulator VPP that shipped one would flip this to `true`.
  licenseStore: false,
  // No shipped Simulator VPP is a paid/licensed product.
  isLicensable: false,
}

export const RUNTIME_V3_CAPABILITIES: TargetCapabilities = {
  pinMapping: false,
  vppIo: false,
  modbusTcpRemote: false,
  ethercat: false,
  modbusTcpServer: false,
  opcuaServer: false,
  s7Server: false,
  debuggerTransports: ['modbus-tcp'],
  pythonFunctionBlocks: true,
  arduinoApiCompletions: false,
  hasRuntimeStats: false,
  isInProcessSimulator: false,
  directUsbUpload: false,
  // Runtime v3 has no VPP layer and thus no license-store backend.
  licenseStore: false,
  // Runtime v3 has no VPP layer and is not a licensed product.
  isLicensable: false,
}

export const RUNTIME_V4_CAPABILITIES: TargetCapabilities = {
  pinMapping: false,
  // "Plain" Runtime v4 has no VPP backplane. VPP boards (SLM-RP4 etc.)
  // override this to `true` in their manifests.
  vppIo: false,
  modbusTcpRemote: true,
  ethercat: true,
  modbusTcpServer: true,
  opcuaServer: true,
  s7Server: true,
  debuggerTransports: ['websocket'],
  pythonFunctionBlocks: true,
  arduinoApiCompletions: false,
  hasRuntimeStats: true,
  isInProcessSimulator: false,
  directUsbUpload: false,
  // "Plain" Runtime v4 has no VPP backplane and no license-store
  // backend. A VPP board (SLM-RP4 etc.) whose manifest declares
  // `hal.licenseStore` overrides this to `true` via the merged
  // capability block — same path as `vppIo`.
  licenseStore: false,
  // "Plain" Runtime v4 is not a licensed product; a paid VPP board flips
  // this to `true` via its merged manifest capability block, like `vppIo`.
  isLicensable: false,
}

export const ARDUINO_CLI_CAPABILITIES: TargetCapabilities = {
  pinMapping: true,
  vppIo: false,
  modbusTcpRemote: false,
  ethercat: false,
  modbusTcpServer: false,
  opcuaServer: false,
  s7Server: false,
  // Arduino targets speak RTU over USB always; some also speak TCP
  // via an ethernet shield. Both flagged available — the actual
  // user-facing protocol selector picks between them at debug time.
  debuggerTransports: ['modbus-serial', 'modbus-tcp'],
  pythonFunctionBlocks: false,
  arduinoApiCompletions: true,
  hasRuntimeStats: false,
  isInProcessSimulator: false,
  directUsbUpload: true,
  // Arduino-CLI VPP boards (Opta, P1AM) that ship a `hal.licenseStore`
  // backend flip this on via their merged capability block; the plain
  // preset stays `false`.
  licenseStore: false,
  // Plain Arduino targets are not licensed products; a paid Arduino-CLI VPP
  // board flips this to `true` via its merged manifest capability block.
  isLicensable: false,
}
