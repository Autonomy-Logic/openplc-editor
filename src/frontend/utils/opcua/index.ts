/**
 * OPC-UA Configuration Utilities
 *
 * This module provides utilities for generating OPC-UA server configuration
 * for the OpenPLC Runtime.
 */

export type {
  RuntimeClientConfig,
  RuntimeClientMapping,
  RuntimeClientPluginConfig,
  RuntimeClientSecurity,
  RuntimeClientServer,
} from './generate-opcua-client-config'
export {
  generateOpcUaClientConfig,
  OPCUA_CLIENT_CONFIG_FORMAT_VERSION,
  validateOpcUaClientConfig,
} from './generate-opcua-client-config'
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
export { generateOpcUaConfig, validateOpcUaConfig } from './generate-opcua-config'
export {
  type LeafAddress,
  OpcUaConfigError,
  resolveArrayAddress,
  resolveStructureAddresses,
  resolveVariableAddress,
} from './resolve-indices'
export type { PLCInstanceInfo, ResolvedField } from './types'
