import type {
  OpcUaNodeConfig,
  OpcUaPermissions,
  OpcUaSecurityProfile,
  OpcUaServerConfig,
  OpcUaTrustedCertificate,
  OpcUaUser,
  PLCServer,
} from '@root/types/PLC/open-plc'

import { OpcUaConfigError, resolveArrayIndex, resolveStructureIndices, resolveVariableIndex } from './resolve-indices'
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
  initial_value: boolean | number | string
  description: string
  index: number
  permissions: RuntimeVariablePermissions
}

interface RuntimeStructureField {
  name: string
  datatype: string
  initial_value: boolean | number | string
  index: number
  permissions: RuntimeVariablePermissions
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
  initial_value: boolean | number | string
  index: number
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
  const index = resolveVariableIndex(node, debugVariables, instances)

  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    datatype: node.variableType,
    initial_value: node.initialValue,
    description: node.description,
    index,
    permissions: convertPermissions(node.permissions),
  }
}

/**
 * Resolve a structure and build runtime format with field indices
 */
const resolveStructure = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): RuntimeStructure => {
  const resolvedFields = resolveStructureIndices(node, debugVariables, instances)

  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    description: node.description,
    fields: resolvedFields.map((field) => ({
      name: field.name,
      datatype: field.datatype,
      initial_value: field.initialValue,
      index: field.index,
      permissions: convertPermissions(field.permissions),
    })),
  }
}

/**
 * Resolve an array and build runtime format
 */
const resolveArray = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): RuntimeArray => {
  const index = resolveArrayIndex(node, debugVariables, instances)

  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    datatype: node.elementType || node.variableType,
    length: node.arrayLength || 1,
    initial_value: node.initialValue,
    index,
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
 * Parse the debug.c file content to extract debug variables
 */
export const parseDebugFile = (content: string): DebugVariable[] => {
  const variables: DebugVariable[] = []

  // Find the debug_vars[] array
  const debugVarsMatch = content.match(/debug_vars\[\]\s*=\s*\{([\s\S]*?)\};/)

  if (!debugVarsMatch) {
    console.warn('Could not find debug_vars[] array in debug.c')
    return []
  }

  const arrayContent = debugVarsMatch[1]

  // Parse each entry: { &(VARIABLE_PATH), TYPE }
  const entryRegex = /\{\s*&\(([^)]+)\)\s*,\s*(\w+)\s*\}/g

  let match
  let index = 0

  while ((match = entryRegex.exec(arrayContent)) !== null) {
    const fullPath = match[1].trim()
    const type = match[2].trim()

    variables.push({
      name: fullPath,
      type,
      index,
    })

    index++
  }

  return variables
}

/**
 * Generates the OPC-UA configuration JSON for the runtime plugin.
 * Converts camelCase properties to snake_case expected by the C plugin.
 * Resolves variable indices from the debug.c file.
 *
 * @param servers - Array of configured PLC servers
 * @param debugFileContent - Content of the generated debug.c file
 * @param instances - Array of PLC instances from Resources configuration
 * @returns JSON string for opcua.json or null if no enabled OPC-UA server
 */
export const generateOpcUaConfig = (
  servers: PLCServer[] | undefined,
  debugFileContent: string,
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

  // 2. Parse debug.c to get variable indices
  const debugVariables = parseDebugFile(debugFileContent)

  if (debugVariables.length === 0 && config.addressSpace.nodes.length > 0) {
    throw new OpcUaConfigError(
      'debug.c',
      'debug_vars[]',
      'Cannot resolve OPC-UA variable indices: debug.c appears to be empty or invalid.\n' +
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
  debugFileContent: string,
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
  const debugVariables = parseDebugFile(debugFileContent)

  for (const node of config.addressSpace.nodes) {
    try {
      switch (node.nodeType) {
        case 'variable':
          resolveVariableIndex(node, debugVariables, instances)
          break
        case 'structure':
          resolveStructureIndices(node, debugVariables, instances)
          break
        case 'array':
          // Arrays with fields (complex element types) are validated like structures
          if (node.fields && node.fields.length > 0) {
            resolveStructureIndices(node, debugVariables, instances)
          } else {
            resolveArrayIndex(node, debugVariables, instances)
          }
          break
      }
    } catch (error) {
      if (error instanceof OpcUaConfigError) {
        errors.push(error.message)
      } else {
        errors.push(String(error))
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
