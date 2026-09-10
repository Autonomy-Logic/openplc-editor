/**
 * OPC-UA Configuration Utilities
 *
 * This module provides utilities for generating OPC-UA server configuration
 * for the OpenPLC Runtime.
 */

export type {
  ResolvedOpcUaConfig,
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
export { buildOpcUaRuntimeConfig, generateOpcUaConfig, validateOpcUaConfig } from './generate-opcua-config'
export { collectOpcUaNodes, generateOpcUaHeaderContent, type GenerateOpcUaHeaderInput } from './generate-opcua-header'
export {
  type LeafAddress,
  OpcUaConfigError,
  resolveArrayAddress,
  resolveArrayElementFields,
  resolveStructureAddresses,
  resolveVariableAddress,
} from './resolve-indices'
export type { PLCInstanceInfo, ResolvedField } from './types'
