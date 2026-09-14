/**
 * The shape a spec author writes, as opposed to the shape the project stores.
 *
 * It mirrors the stored types rather than inventing a parallel language, so
 * `describe` can emit what `apply` accepts and a round trip is a comparison
 * instead of a translation. Two deliberate differences:
 *
 *  - One `enabled` per server. Stored, it lives in a different place for each
 *    protocol (`modbusSlaveConfig.enabled`, `s7commSlaveConfig.server.enabled`,
 *    `opcuaServerConfig.server.enabled`), which is three chances to set the
 *    wrong one.
 *  - Everything below the name is optional. The normalizer merges onto the
 *    same defaults `createServer` seeds, so a two-line server is legal.
 *
 * Derived fields are absent by construction: `ioPoints` and their IEC
 * locations are allocated by the store, so an author never writes them.
 */

import type { EtherCATSlaveConfig } from '../../../middleware/shared/ports/esi-types'
import type {
  EtherCATMasterConfig,
  ModbusErrorHandling,
  ModbusFunctionCode,
  ModbusParity,
  ModbusSlaveBufferMapping,
  ModbusTransportType,
  OpcUaNodeConfig,
  OpcUaSecurityConfig,
  OpcUaSecurityProfile,
  OpcUaServerSettings,
  OpcUaUser,
  S7CommDataBlock,
  S7CommLogging,
  S7CommPlcIdentity,
  S7CommServerSettings,
  S7CommSystemAreas,
} from '../types/PLC/open-plc'

/** Objects merge field by field; arrays are replaced whole. */
export type DeepPartial<T> = T extends readonly (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

/** Protocols an author may declare. `ethernet-ip` has no generator. */
export type SpecServerProtocol = 'modbus-tcp' | 's7comm' | 'opcua'

/** Protocols an author may declare. `ethernet-ip` and `profinet` have none. */
export type SpecRemoteDeviceProtocol = 'modbus-tcp' | 'ethercat'

export interface SpecModbusSlave {
  networkInterface?: string
  port?: number
  bufferMapping?: ModbusSlaveBufferMapping
}

export interface SpecS7Comm {
  server?: DeepPartial<Omit<S7CommServerSettings, 'enabled'>>
  plcIdentity?: DeepPartial<S7CommPlcIdentity>
  dataBlocks?: S7CommDataBlock[]
  systemAreas?: DeepPartial<S7CommSystemAreas>
  logging?: DeepPartial<S7CommLogging>
}

/** A profile's `id` defaults to its name, so a round trip is stable. */
export type SpecOpcUaSecurityProfile = Omit<OpcUaSecurityProfile, 'id'> & { id?: string }

/** A user's `id` defaults to its username. `passwordHash` is redacted by
 *  `describe`, so it is optional: omitting it on apply keeps the stored value. */
export type SpecOpcUaUser = Omit<OpcUaUser, 'id' | 'passwordHash'> & { id?: string; passwordHash?: string | null }

/** A node's `id` defaults to `<pouName>.<variablePath>`. */
export type SpecOpcUaNode = Omit<OpcUaNodeConfig, 'id'> & { id?: string }

export interface SpecOpcUa {
  server?: DeepPartial<Omit<OpcUaServerSettings, 'enabled'>>
  securityProfiles?: SpecOpcUaSecurityProfile[]
  security?: DeepPartial<OpcUaSecurityConfig>
  users?: SpecOpcUaUser[]
  cycleTimeMs?: number
  addressSpace?: { namespaceUri?: string; nodes?: SpecOpcUaNode[] }
}

export interface SpecServer {
  name: string
  protocol: SpecServerProtocol
  /** Off unless said otherwise, matching `createServer`. */
  enabled?: boolean
  modbus?: SpecModbusSlave
  s7comm?: SpecS7Comm
  opcua?: SpecOpcUa
}

/** `id` is derived from the name; `ioPoints` are allocated by the store. */
export interface SpecIOGroup {
  name: string
  functionCode: ModbusFunctionCode
  cycleTime: number
  offset: string
  length: number
  errorHandling?: ModbusErrorHandling
  /**
   * Alias per point, in order, for the points you want to name. A variable
   * reaches a polled value by putting the alias in its `location`; without one
   * the point has an allocated address and no name, so nothing can read it.
   */
  aliases?: string[]
}

export interface SpecModbusMaster {
  transport?: ModbusTransportType
  host?: string
  port?: number
  serialPort?: string
  baudRate?: number
  parity?: ModbusParity
  stopBits?: number
  dataBits?: number
  timeout?: number
  slaveId?: number
  ioGroups?: SpecIOGroup[]
}

/**
 * A slave is declared by its ESI reference plus overrides. Everything else —
 * channels, PDOs, SDOs, the CiA 402 block, the IEC addresses — is read out of
 * the ESI file and allocated, exactly as the device screen does it.
 */
export interface SpecEtherCATSlave {
  esiDeviceRef: { repositoryItemId: string; deviceIndex?: number }
  /** Defaults to the ESI's own short name, made unique across the bus. */
  name?: string
  position?: number
  config?: DeepPartial<EtherCATSlaveConfig>
  cia402?: { enabled?: boolean; scaleNum?: number; scaleDenom?: number; scaleFactor?: number }
  /** Per-channel alias overrides, keyed by channel id. */
  aliases?: Record<string, string>
}

export interface SpecEtherCAT {
  master?: DeepPartial<EtherCATMasterConfig>
  slaves?: SpecEtherCATSlave[]
}

export interface SpecRemoteDevice {
  name: string
  protocol: SpecRemoteDeviceProtocol
  modbus?: SpecModbusMaster
  ethercat?: SpecEtherCAT
}

export type NormalizeResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }
