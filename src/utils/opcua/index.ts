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
export { generateOpcUaConfig, parseDebugFile, validateOpcUaConfig } from './generate-opcua-config'
export { OpcUaConfigError, resolveArrayIndex, resolveStructureIndices, resolveVariableIndex } from './resolve-indices'
export type { DebugVariable, ResolvedField } from './types'
