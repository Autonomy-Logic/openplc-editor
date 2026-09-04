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

import type { AddressProducerCapabilities, TargetCapabilities } from './types'

/**
 * Every address producer active. NOT a target preset — no board reports this,
 * and it must never reach a UI / feature gate.
 *
 * This is the allocation-time answer to a board id that did not resolve: a VPP
 * board whose package isn't installed, a project authored on another machine,
 * or the catalogue not having loaded yet. `resolveTargetCapabilities`
 * answers `EMPTY_CAPABILITIES` there, which is right for gating (never offer
 * an affordance the target can't back) and wrong for allocation, where it
 * reads as "this target supports no producers" and freezes every address in
 * place — the recompaction after a delete silently keeps the stale addresses.
 *
 * Permissive is the safe direction here: the worst case is that addresses get
 * compacted for a producer the eventual target turns out not to support, and
 * selecting that target recalculates anyway (`setDeviceBoard`).
 */
export const ALL_ADDRESS_PRODUCERS_ACTIVE: AddressProducerCapabilities = {
  pinMapping: true,
  vppIo: true,
  modbusTcpRemote: true,
  ethercat: true,
}

export const SIMULATOR_CAPABILITIES: TargetCapabilities = {
  pinMapping: false,
  vppIo: false,
  // Servers and remote IO are no-ops at the bytecode level but reported
  // available so projects authored for Runtime v4 don't get nagged
  // when the user simulates them.
  modbusTcpRemote: true,
  ethercat: true,
  modbusTcpServer: true,
  // The Simulator runs no Modbus slave at all — the flags are UX, so a
  // project authored for another target keeps its server config while the
  // user simulates it. It has no VPP Modbus screen, so it resolves to the
  // `plc-server` profile, where RTU is not on offer anyway.
  modbusRtuServer: false,
  opcuaServer: true,
  s7Server: true,
  // RTU over the emulated virtual serial port the in-process simulator
  // exposes — not Modbus TCP.
  debuggerTransports: ['modbus-serial'],
  pythonFunctionBlocks: true,
  arduinoApiCompletions: true,
  hasRuntimeStats: false,
  isInProcessSimulator: true,
  nativeRetainStore: false,
  plcStateControl: false,
  directUsbUpload: true,
  // Licensing is never a property of a TARGET FAMILY: a VPP is what is
  // sold, so only a VPP manifest can turn this on. Every preset leaves it
  // off, and a board that does not declare it gets an ordinary connect
  // with no licensing traffic at all.
  isLicensable: false,
}

export const RUNTIME_V3_CAPABILITIES: TargetCapabilities = {
  pinMapping: false,
  vppIo: false,
  modbusTcpRemote: false,
  ethercat: false,
  modbusTcpServer: false,
  modbusRtuServer: false,
  opcuaServer: false,
  s7Server: false,
  debuggerTransports: ['modbus-tcp'],
  pythonFunctionBlocks: true,
  arduinoApiCompletions: false,
  hasRuntimeStats: false,
  isInProcessSimulator: false,
  // v3 exposes the SAME run/stop REST API as v4 (`/api/start-plc`,
  // `/api/stop-plc`, JWT-authenticated) — only the debug channel differs
  // (v3: Modbus TCP, v4: WebSocket). The main process already routes the
  // command over REST for both, so the only thing that ever stopped v3
  // was this flag.
  nativeRetainStore: false,
  plcStateControl: true,
  directUsbUpload: false,
  // Licensing is never a property of a TARGET FAMILY: a VPP is what is
  // sold, so only a VPP manifest can turn this on. Every preset leaves it
  // off, and a board that does not declare it gets an ordinary connect
  // with no licensing traffic at all.
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
  // The Runtime v4 Modbus slave plugin is a TCP listener; there is no serial
  // path in it.
  modbusRtuServer: false,
  opcuaServer: true,
  s7Server: true,
  debuggerTransports: ['websocket'],
  pythonFunctionBlocks: true,
  arduinoApiCompletions: false,
  hasRuntimeStats: true,
  isInProcessSimulator: false,
  nativeRetainStore: true,
  plcStateControl: true,
  directUsbUpload: false,
  // Licensing is never a property of a TARGET FAMILY: a VPP is what is
  // sold, so only a VPP manifest can turn this on. Every preset leaves it
  // off, and a board that does not declare it gets an ordinary connect
  // with no licensing traffic at all.
  isLicensable: false,
}

export const ARDUINO_CLI_CAPABILITIES: TargetCapabilities = {
  pinMapping: true,
  vppIo: false,
  modbusTcpRemote: false,
  ethercat: false,
  // The baremetal firmware serves both, gated by the VPP Modbus screen's
  // per-transport toggles. These read `false` until DOPE-442 because the
  // config lived in a vendor screen the Servers UX could not see; now that
  // one screen renders both stores, hiding the target's real capability is
  // what would be wrong.
  //
  // A board still only gets the screen when its VPP declares a Modbus screen,
  // so a package that has not been migrated is unaffected.
  modbusTcpServer: true,
  modbusRtuServer: true,
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
  nativeRetainStore: false,
  plcStateControl: true,
  directUsbUpload: true,
  // Licensing is never a property of a TARGET FAMILY: a VPP is what is
  // sold, so only a VPP manifest can turn this on. Every preset leaves it
  // off, and a board that does not declare it gets an ordinary connect
  // with no licensing traffic at all.
  isLicensable: false,
}
