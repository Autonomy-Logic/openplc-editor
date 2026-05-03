import type {
  OpcUaNodeConfig,
  OpcUaPermissions,
  OpcUaSecurityProfile,
  OpcUaServerConfig,
  OpcUaTrustedCertificate,
  OpcUaUser,
  PLCServer,
} from '@root/middleware/shared/ports/open-plc-types'

import { getErrorMessage } from '../get-error-message'
import {
  OpcUaConfigError,
  resolveArrayAddress,
  resolveStructureAddresses,
  resolveVariableAddress,
} from './resolve-indices'
import type { DebugVariable, PLCInstanceInfo } from './types'

/**
 * Runtime configuration interfaces
 * These define the JSON structure expected by the OpenPLC Runtime OPC-UA plugin.
 * The runtime uses snake_case naming convention.
 */

interface RuntimeSecurityProfile {
  name: string
  enabled: boolean
  security_policy: string
  security_mode: string
  auth_methods: string[]
}

interface RuntimeServerConfig {
  name: string
  application_uri: string
  product_uri: string
  endpoint_url: string
  security_profiles: RuntimeSecurityProfile[]
}

interface RuntimeTrustedCertificate {
  id: string
  pem: string
}

interface RuntimeSecurityConfig {
  server_certificate_strategy: string
  server_certificate_custom: string | null
  server_private_key_custom: string | null
  trusted_client_certificates: RuntimeTrustedCertificate[]
}

interface RuntimeUser {
  type: string
  username: string | null
  password_hash: string | null
  certificate_id: string | null
  role: string
}

interface RuntimeVariablePermissions {
  viewer: string
  operator: string
  engineer: string
}

interface RuntimeVariable {
  node_id: string
  browse_name: string
  display_name: string
  datatype: string
  description: string
  arr: number
  elem: number
  permissions: RuntimeVariablePermissions
}

interface RuntimeStructureField {
  name: string
  datatype: string
  // null for complex types that have nested fields
  arr: number | null
  elem: number | null
  permissions: RuntimeVariablePermissions
  fields?: RuntimeStructureField[]
}

interface RuntimeStructure {
  node_id: string
  browse_name: string
  display_name: string
  description: string
  fields: RuntimeStructureField[]
}

interface RuntimeArray {
  node_id: string
  browse_name: string
  display_name: string
  datatype: string
  length: number
  arr: number
  elem: number
  permissions: RuntimeVariablePermissions
}

interface RuntimeAddressSpace {
  namespace_uri: string
  variables: RuntimeVariable[]
  structures: RuntimeStructure[]
  arrays: RuntimeArray[]
}

interface RuntimePluginConfig {
  server: RuntimeServerConfig
  security: RuntimeSecurityConfig
  users: RuntimeUser[]
  cycle_time_ms: number
  address_space: RuntimeAddressSpace
}

interface RuntimeConfig {
  name: string
  protocol: 'OPC-UA'
  config: RuntimePluginConfig
}

/**
 * Build the runtime server configuration from editor config
 */
const buildServerConfig = (config: OpcUaServerConfig): RuntimeServerConfig => {
  const { server, securityProfiles } = config

  // Build endpoint URL from components
  const endpointUrl = `opc.tcp://${server.bindAddress}:${server.port}${server.endpointPath}`

  return {
    name: server.name,
    application_uri: server.applicationUri,
    product_uri: server.productUri,
    endpoint_url: endpointUrl,
    security_profiles: securityProfiles
      .filter((sp: OpcUaSecurityProfile) => sp.enabled)
      .map((sp: OpcUaSecurityProfile) => ({
        name: sp.name,
        enabled: sp.enabled,
        security_policy: sp.securityPolicy,
        security_mode: sp.securityMode,
        auth_methods: sp.authMethods,
      })),
  }
}

/**
 * Build the runtime security configuration from editor config
 */
const buildSecurityConfig = (config: OpcUaServerConfig): RuntimeSecurityConfig => {
  const { security } = config

  return {
    server_certificate_strategy: security.serverCertificateStrategy,
    server_certificate_custom: security.serverCertificateCustom,
    server_private_key_custom: security.serverPrivateKeyCustom,
    trusted_client_certificates: security.trustedClientCertificates.map((cert: OpcUaTrustedCertificate) => ({
      id: cert.id,
      pem: cert.pem,
    })),
  }
}

/**
 * Build the runtime users configuration from editor config
 */
const buildUsersConfig = (config: OpcUaServerConfig): RuntimeUser[] => {
  return config.users.map((user: OpcUaUser) => ({
    type: user.type,
    username: user.username,
    password_hash: user.passwordHash,
    certificate_id: user.certificateId,
    role: user.role,
  }))
}

/**
 * Convert editor permissions to runtime format
 */
const convertPermissions = (permissions: OpcUaPermissions): RuntimeVariablePermissions => ({
  viewer: permissions.viewer,
  operator: permissions.operator,
  engineer: permissions.engineer,
})

/**
 * Resolve a simple variable and build runtime format
 */
const resolveVariable = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): RuntimeVariable => {
  const addr = resolveVariableAddress(node, debugVariables, instances)

  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    datatype: node.variableType,
    description: node.description,
    arr: addr.arr,
    elem: addr.elem,
    permissions: convertPermissions(node.permissions),
  }
}

/**
 * Convert a resolved field (with possible nested fields) to runtime format recursively.
 */
const convertResolvedFieldToRuntime = (field: {
  name: string
  datatype: string
  arr: number | null
  elem: number | null
  permissions: { viewer: 'r' | 'w' | 'rw'; operator: 'r' | 'w' | 'rw'; engineer: 'r' | 'w' | 'rw' }
  fields?: (typeof field)[]
}): RuntimeStructureField => {
  const runtimeField: RuntimeStructureField = {
    name: field.name,
    datatype: field.datatype,
    arr: field.arr,
    elem: field.elem,
    permissions: convertPermissions(field.permissions),
  }

  // Add nested fields if present (for complex types like FB instances)
  if (field.fields && field.fields.length > 0) {
    runtimeField.fields = field.fields.map(convertResolvedFieldToRuntime)
  }

  return runtimeField
}

/**
 * Resolve a structure and build runtime format with field addresses.
 * Supports nested fields for complex types (FBs within FBs, structs within structs).
 */
const resolveStructure = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): RuntimeStructure => {
  const resolvedFields = resolveStructureAddresses(node, debugVariables, instances)

  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    description: node.description,
    fields: resolvedFields.map(convertResolvedFieldToRuntime),
  }
}

/**
 * Extract the element type from an array type string like "ARRAY[1..10] OF INT"
 * Returns the element type (e.g., "INT") or the original string if parsing fails.
 */
const extractArrayElementType = (arrayTypeStr: string): string => {
  const match = arrayTypeStr.match(/\bOF\s+([A-Za-z0-9_:.]+)\s*$/i)
  return match ? match[1].toUpperCase() : arrayTypeStr
}

/**
 * Resolve an array and build runtime format
 */
const resolveArray = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): RuntimeArray => {
  const addr = resolveArrayAddress(node, debugVariables, instances)

  // Get the element type - prefer explicit elementType, otherwise extract from variableType
  let datatype = node.elementType
  if (!datatype && node.variableType) {
    datatype = extractArrayElementType(node.variableType)
  }
  datatype = datatype || 'UNKNOWN'

  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    datatype,
    length: node.arrayLength || 1,
    arr: addr.arr,
    elem: addr.elem,
    permissions: convertPermissions(node.permissions),
  }
}

/**
 * Build the complete address space configuration
 */
const buildAddressSpace = (
  config: OpcUaServerConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): RuntimeAddressSpace => {
  const variables: RuntimeVariable[] = []
  const structures: RuntimeStructure[] = []
  const arrays: RuntimeArray[] = []
  const errors: OpcUaConfigError[] = []

  for (const node of config.addressSpace.nodes) {
    try {
      switch (node.nodeType) {
        case 'variable':
          variables.push(resolveVariable(node, debugVariables, instances))
          break
        case 'structure':
          // Structures and FBs are handled the same way - resolve all leaf fields
          structures.push(resolveStructure(node, debugVariables, instances))
          break
        case 'array':
          // Arrays with fields (complex element types) are treated like structures
          // because each leaf variable needs individual index resolution
          if (node.fields && node.fields.length > 0) {
            structures.push(resolveStructure(node, debugVariables, instances))
          } else {
            // Simple arrays of base types
            arrays.push(resolveArray(node, debugVariables, instances))
          }
          break
      }
    } catch (error) {
      if (error instanceof OpcUaConfigError) {
        errors.push(error)
      } else {
        throw error
      }
    }
  }

  // If there are resolution errors, throw them all together
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => e.message).join('\n\n')
    throw new OpcUaConfigError(
      'multiple',
      'multiple',
      `Failed to resolve ${errors.length} OPC-UA variable(s):\n\n${errorMessages}`,
    )
  }

  return {
    namespace_uri: config.addressSpace.namespaceUri,
    variables,
    structures,
    arrays,
  }
}

/**
 * Shape of debug-map.json as produced by STruC++
 * (src/backend/debug-table-gen.ts → DebugMapV2). Re-declared here so
 * the editor doesn't take a build dependency on strucpp's TS types.
 */
interface DebugMapV2 {
  version: 2
  md5: string
  typeTags: Record<string, number>
  arrays: Array<{ index: number; count: number }>
  leaves: Array<{
    arrayIdx: number
    elemIdx: number
    path: string
    type: string
    size: number
  }>
}

/**
 * Parse debug-map.json content into the leaves array consumed by the
 * resolver. Replaces the old MatIEC `parseDebugFile` which regex-
 * scanned debug.c.
 */
export const parseDebugMap = (content: string): DebugVariable[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    console.warn('debug-map.json is not valid JSON')
    return []
  }
  // Minimal structural validation. A wrong shape almost always means
  // the file is from a different strucpp version — fail loud.
  if (!parsed || typeof parsed !== 'object') return []
  const map = parsed as Partial<DebugMapV2>
  if (map.version !== 2 || !Array.isArray(map.leaves)) {
    console.warn(
      `debug-map.json: unexpected version (${String(map.version)}). ` +
        `OPC-UA expects DebugMapV2 — re-run strucpp.`,
    )
    return []
  }

  return map.leaves.map((leaf) => ({
    path: leaf.path,
    type: leaf.type,
    arr: leaf.arrayIdx,
    elem: leaf.elemIdx,
    size: leaf.size,
  }))
}

/**
 * Generates the OPC-UA configuration JSON for the runtime plugin.
 * Converts camelCase properties to snake_case expected by the plugin.
 * Resolves variable addresses from STruC++'s debug-map.json.
 *
 * @param servers - Array of configured PLC servers
 * @param debugMapContent - Content of the generated debug-map.json file
 * @param instances - Array of PLC instances from Resources configuration
 * @returns JSON string for opcua.json or null if no enabled OPC-UA server
 */
export const generateOpcUaConfig = (
  servers: PLCServer[] | undefined,
  debugMapContent: string,
  instances: PLCInstanceInfo[],
): string | null => {
  // 1. Find OPC-UA server configuration
  if (!servers || servers.length === 0) {
    return null
  }

  const opcuaServer = servers.find((s) => s.protocol === 'opcua' && s.opcuaServerConfig?.server.enabled)

  if (!opcuaServer?.opcuaServerConfig) {
    return null
  }

  const config = opcuaServer.opcuaServerConfig

  // 2. Parse debug-map.json to get variable addresses
  const debugVariables = parseDebugMap(debugMapContent)

  if (debugVariables.length === 0 && config.addressSpace.nodes.length > 0) {
    throw new OpcUaConfigError(
      'debug-map.json',
      'leaves[]',
      'Cannot resolve OPC-UA variable addresses: debug-map.json is empty or invalid.\n' +
        'This may happen if the PLC program compilation failed.',
    )
  }

  // 3. Build runtime configuration
  const runtimeConfig: RuntimeConfig = {
    name: 'opcua_server',
    protocol: 'OPC-UA',
    config: {
      server: buildServerConfig(config),
      security: buildSecurityConfig(config),
      users: buildUsersConfig(config),
      cycle_time_ms: config.cycleTimeMs,
      address_space: buildAddressSpace(config, debugVariables, instances),
    },
  }

  // 4. Return as JSON string (wrapped in array as expected by runtime)
  return JSON.stringify([runtimeConfig], null, 2)
}

/**
 * Validates the OPC-UA configuration before generation.
 * Returns validation errors without throwing.
 */
export const validateOpcUaConfig = (
  config: OpcUaServerConfig,
  debugMapContent: string,
  instances: PLCInstanceInfo[],
): { valid: boolean; errors: string[] } => {
  const errors: string[] = []

  // Check for enabled security profiles
  const enabledProfiles = config.securityProfiles.filter((sp) => sp.enabled)
  if (enabledProfiles.length === 0) {
    errors.push('At least one security profile must be enabled')
  }

  // Check for username auth without users
  const hasUsernameAuth = enabledProfiles.some((sp) => sp.authMethods.includes('Username'))
  if (hasUsernameAuth && config.users.length === 0) {
    errors.push('Username authentication is enabled but no users are configured')
  }

  // Try to resolve all variables
  const debugVariables = parseDebugMap(debugMapContent)

  for (const node of config.addressSpace.nodes) {
    try {
      switch (node.nodeType) {
        case 'variable':
          resolveVariableAddress(node, debugVariables, instances)
          break
        case 'structure':
          resolveStructureAddresses(node, debugVariables, instances)
          break
        case 'array':
          if (node.fields && node.fields.length > 0) {
            resolveStructureAddresses(node, debugVariables, instances)
          } else {
            resolveArrayAddress(node, debugVariables, instances)
          }
          break
      }
    } catch (error) {
      if (error instanceof OpcUaConfigError) {
        errors.push(error.message)
      } else {
        errors.push(getErrorMessage(error))
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

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
}
