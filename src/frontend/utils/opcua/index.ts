/**
 * OPC-UA Configuration Utilities
 *
 * This module provides utilities for generating OPC-UA server configuration
 * for the OpenPLC Runtime.
 */

export type {
  RuntimeAddressSpace,
  RuntimeArray,
  RuntimeConfig,
  RuntimePluginConfig,
  RuntimeSecurityConfig,
  RuntimeSecurityProfile,
  RuntimeServerConfig,
  RuntimeStructure,
  RuntimeStructureField,
  RuntimeTrustedCertificate,
  RuntimeUser,
  RuntimeVariable,
  RuntimeVariablePermissions,
} from './generate-opcua-config'
export { generateOpcUaConfig, parseDebugMap, validateOpcUaConfig } from './generate-opcua-config'
export {
  type LeafAddress,
  OpcUaConfigError,
  resolveArrayAddress,
  resolveStructureAddresses,
  resolveVariableAddress,
} from './resolve-indices'
export type { PLCInstanceInfo, ResolvedField } from './types'
// Re-export the debugger's variable-entry shape so OPC-UA consumers
// don't have to know about the cross-module structure.
export type { DebugVariableEntry } from '../debug-parser'
