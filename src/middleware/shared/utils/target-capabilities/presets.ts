import { IMAGE_TABLES } from '../io-image/tables'
import type { AddressProducerCapabilities, OpcUaTargetProfile, S7TargetProfile, TargetCapabilities } from './types'

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
  modbusTcpMaster: true,
  modbusRtuMaster: true,
  ethercat: true,
}

/** Conservative baseline for a baremetal OPC-UA server. */
export const DEFAULT_OPCUA_PROFILE: OpcUaTargetProfile = {
  arenaBytes: 32 * 1024,
  maxSessions: 1,
  nodePoolSlots: 8,
  maxNodesPerRead: 20,
  maxNodesPerWrite: 20,
  maxNodesPerBrowse: 10,
  maxReferencesPerNode: 32,
  maxArrayLength: 256,
  security: 'none',
  certificates: false,
  subscriptions: false,
  kdfIterations: 600_000,
  passwordScheme: 'pbkdf2-sha256',
  hw: { sha256: false, aes: false, pk: false, trng: false, rtc: false },
}

/**
 * Mapping types a bare-metal S7 server can address.
 *
 * `openplc.h` declares an array for these seven and for no other, so a block
 * naming one of the rest has nowhere to land. `generate-s7comm-header` holds
 * the matching `S7COMM_BUF_*` codes and a test pins the two together.
 */
export const BAREMETAL_S7_BUFFERS: readonly string[] = [
  'bool_input',
  'bool_output',
  'int_input',
  'int_output',
  'int_memory',
  'dint_memory',
  'lint_memory',
]

/** Every mapping type the Runtime v4 plugin's parser accepts. */
export const RUNTIME_S7_BUFFERS: readonly string[] = IMAGE_TABLES.map((table) => table.key)

/** What a target gets when it declares `s7Server` and nothing else. */
export const DEFAULT_S7_PROFILE: S7TargetProfile = {
  maxClients: 2,
  pduSize: 240,
  maxDataBlocks: 8,
  szl: true,
  writeEnabled: true,
  buffers: BAREMETAL_S7_BUFFERS,
}

/**
 * Runtime v4's own numbers, which are the plugin's: 64 areas in the config record and every mapping type its parser
 * accepts.
 */
export const RUNTIME_V4_S7_PROFILE: S7TargetProfile = {
  maxClients: 32,
  pduSize: 240,
  maxDataBlocks: 64,
  szl: true,
  writeEnabled: true,
  buffers: RUNTIME_S7_BUFFERS,
}

export const SIMULATOR_CAPABILITIES: TargetCapabilities = {
  pinMapping: false,
  vppIo: false,
  modbusTcpMaster: true,
  modbusRtuMaster: true,
  ethercat: true,
  modbusTcpServer: true,
  modbusRtuServer: false,
  opcuaServer: true,
  s7Server: true,
  networkSockets: null,
  debuggerTransports: ['modbus-serial'],
  pythonFunctionBlocks: true,
  arduinoApiCompletions: true,
  hasRuntimeStats: false,
  isInProcessSimulator: true,
  nativeRetainStore: false,
  plcStateControl: false,
  directUsbUpload: true,
  isLicensable: false,
}

export const RUNTIME_V3_CAPABILITIES: TargetCapabilities = {
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
  debuggerTransports: ['modbus-tcp'],
  pythonFunctionBlocks: true,
  arduinoApiCompletions: false,
  hasRuntimeStats: false,
  isInProcessSimulator: false,
  nativeRetainStore: false,
  plcStateControl: true,
  directUsbUpload: false,
  isLicensable: false,
}

export const RUNTIME_V4_CAPABILITIES: TargetCapabilities = {
  pinMapping: false,
  vppIo: false,
  modbusTcpMaster: true,
  modbusRtuMaster: true,
  ethercat: true,
  modbusTcpServer: true,
  modbusRtuServer: false,
  opcuaServer: true,
  s7Server: true,
  s7: RUNTIME_V4_S7_PROFILE,
  networkSockets: null,
  debuggerTransports: ['websocket'],
  pythonFunctionBlocks: true,
  arduinoApiCompletions: false,
  hasRuntimeStats: true,
  isInProcessSimulator: false,
  nativeRetainStore: true,
  plcStateControl: true,
  directUsbUpload: false,
  isLicensable: false,
}

export const ARDUINO_CLI_CAPABILITIES: TargetCapabilities = {
  pinMapping: true,
  vppIo: false,
  modbusTcpMaster: false,
  modbusRtuMaster: true,
  ethercat: false,
  modbusTcpServer: true,
  modbusRtuServer: true,
  opcuaServer: false,
  s7Server: false,
  networkSockets: null,
  debuggerTransports: ['modbus-serial', 'modbus-tcp'],
  pythonFunctionBlocks: false,
  arduinoApiCompletions: true,
  hasRuntimeStats: false,
  isInProcessSimulator: false,
  nativeRetainStore: false,
  plcStateControl: true,
  directUsbUpload: true,
  isLicensable: false,
}
