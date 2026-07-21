import type {
  OpcUaNodeConfig,
  OpcUaPermissions,
  OpcUaSecurityProfile,
  OpcUaServerConfig,
  OpcUaTrustedCertificate,
  OpcUaUser,
  PLCServer,
} from '@root/middleware/shared/ports/open-plc-types'

import { buildLeafInfoMap, type DebugLeafInfo, parseDebugMap as parseDebugMapJson } from '../debug-parser'
import { getErrorMessage } from '../get-error-message'
import {
  OpcUaConfigError,
  resolveArrayAddress,
  resolveStructureAddresses,
  resolveVariableAddress,
} from './resolve-indices'
import type { PLCInstanceInfo } from './types'

/**
 * opcua.json contract version. Bump when the per-variable schema changes
 * in a way the runtime must detect. v2 introduced compiler-canonical
 * `datatype` + `size` per leaf (sourced from debug-map.json) so the
 * runtime never re-derives byte widths from a drift-prone project-model
 * datatype. A runtime that requires >= 2 gracefully refuses an older
 * (unversioned) config instead of writing the wrong number of bytes.
 */
export const OPCUA_CONFIG_FORMAT_VERSION = 2

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
  /** Canonical byte width from the compiler's debug map. */
  size: number
  description: string
  arr: number
  elem: number
  permissions: RuntimeVariablePermissions
}

interface RuntimeStructureField {
  name: string
  datatype: string
  // Canonical byte width from the compiler; null for complex parents
  // (containers with nested fields) which have no leaf of their own.
  size: number | null
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
  /** Canonical byte width of one element from the compiler's debug map. */
  size: number
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
  /** opcua.json contract version — see OPCUA_CONFIG_FORMAT_VERSION. */
  format_version: number
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
  pathToAddr: Map<string, DebugLeafInfo>,
  instances: PLCInstanceInfo[],
): RuntimeVariable => {
  const addr = resolveVariableAddress(node, pathToAddr, instances)

  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    // datatype/size from the compiler's debug map, NOT node.variableType
    // (the stored project-model type can drift from the compiled layout).
    datatype: addr.type,
    size: addr.size,
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
  size: number | null
  arr: number | null
  elem: number | null
  permissions: { viewer: 'r' | 'w' | 'rw'; operator: 'r' | 'w' | 'rw'; engineer: 'r' | 'w' | 'rw' }
  fields?: (typeof field)[]
}): RuntimeStructureField => {
  const runtimeField: RuntimeStructureField = {
    name: field.name,
    datatype: field.datatype,
    size: field.size,
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
  pathToAddr: Map<string, DebugLeafInfo>,
  instances: PLCInstanceInfo[],
  droppedPaths: string[],
): RuntimeStructure | null => {
  const resolvedFields = resolveStructureAddresses(node, pathToAddr, instances, droppedPaths)
  if (resolvedFields.length === 0) {
    return null
  }
  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    description: node.description,
    fields: resolvedFields.map(convertResolvedFieldToRuntime),
  }
}

/**
 * Resolve an array and build runtime format
 */
const resolveArray = (
  node: OpcUaNodeConfig,
  pathToAddr: Map<string, DebugLeafInfo>,
  instances: PLCInstanceInfo[],
): RuntimeArray => {
  const addr = resolveArrayAddress(node, pathToAddr, instances)

  // Element datatype/size from the compiler's debug map (the resolved
  // leaf is the array's first element — all elements share the type),
  // NOT the stored element type which can drift from the compiled layout.
  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    datatype: addr.type,
    size: addr.size,
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
  pathToAddr: Map<string, DebugLeafInfo>,
  instances: PLCInstanceInfo[],
  droppedPaths: string[],
): RuntimeAddressSpace => {
  const variables: RuntimeVariable[] = []
  const structures: RuntimeStructure[] = []
  const arrays: RuntimeArray[] = []
  const errors: OpcUaConfigError[] = []

  for (const node of config.addressSpace.nodes) {
    try {
      switch (node.nodeType) {
        case 'variable':
          // Top-level variables that don't resolve are still hard
          // errors — that means the variable was renamed/deleted in
          // the program. The user has to fix the OPC-UA config.
          // (Field-level mismatches are handled gracefully by
          // resolveStructureAddresses via droppedPaths.)
          variables.push(resolveVariable(node, pathToAddr, instances))
          break
        case 'structure': {
          // Structures and FBs are handled the same way - resolve all leaf fields
          const struct = resolveStructure(node, pathToAddr, instances, droppedPaths)
          if (struct) structures.push(struct)
          break
        }
        case 'array': {
          // Arrays with fields (complex element types) are treated like structures
          // because each leaf variable needs individual address resolution
          if (node.fields && node.fields.length > 0) {
            const struct = resolveStructure(node, pathToAddr, instances, droppedPaths)
            if (struct) structures.push(struct)
          } else {
            // Simple arrays of base types
            arrays.push(resolveArray(node, pathToAddr, instances))
          }
          break
        }
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
 * Parse debug-map.json content into the uppercase-path → packed-addr
 * Map the resolver consumes. The same path→address lookup table the
 * debugger derives its index map from — single source of truth.
 *
 * Returns an empty Map on malformed/missing input; caller checks
 * `addressSpace.nodes.length > 0 && map.size === 0` to distinguish
 * "no program loaded yet" from "config has no nodes".
 */
const parseDebugMapToInfoMap = (content: string): Map<string, DebugLeafInfo> => {
  const map = parseDebugMapJson(content)
  if (!map) return new Map()
  return buildLeafInfoMap(map)
}

/**
 * Generates the OPC-UA configuration JSON for the runtime plugin.
 * Converts camelCase properties to snake_case expected by the plugin.
 * Resolves variable addresses from STruC++'s debug-map.json.
 *
 * Field paths that don't resolve (e.g. stale library-FB internals
 * left over from before the pou-helpers filter) are silently dropped
 * and reported via `onWarn` rather than aborting the build, so the
 * user sees a heads-up instead of a hard failure they have to fix
 * by hand-editing JSON.
 *
 * @param servers - Array of configured PLC servers
 * @param debugMapContent - Content of the generated debug-map.json file
 * @param instances - Array of PLC instances from Resources configuration
 * @param onWarn - Optional sink for "dropped X" warnings
 * @returns JSON string for opcua.json or null if no enabled OPC-UA server
 */
export const generateOpcUaConfig = (
  servers: PLCServer[] | undefined,
  debugMapContent: string,
  instances: PLCInstanceInfo[],
  onWarn?: (message: string) => void,
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

  // 2. Parse debug-map.json into the same uppercase-path → packed-addr
  //    Map the debugger uses. One source of truth for resolution.
  const pathToAddr = parseDebugMapToInfoMap(debugMapContent)

  if (pathToAddr.size === 0 && config.addressSpace.nodes.length > 0) {
    throw new OpcUaConfigError(
      'debug-map.json',
      'leaves[]',
      'Cannot resolve OPC-UA variable addresses: debug-map.json is empty or invalid.\n' +
        'This may happen if the PLC program compilation failed.',
    )
  }

  // 3. Build runtime configuration. Field-level resolution failures
  //    accumulate into droppedPaths instead of aborting; we surface
  //    each one via onWarn so the user can clean up the OPC-UA config
  //    later if they care.
  const droppedPaths: string[] = []
  const addressSpace = buildAddressSpace(config, pathToAddr, instances, droppedPaths)
  if (onWarn && droppedPaths.length > 0) {
    onWarn(
      `OPC-UA: dropped ${droppedPaths.length} unresolvable variable path(s) ` +
        `from the runtime config — likely library-FB internals (TON.STATE, ` +
        `R_TRIG.M, …) saved before the variable picker started filtering them, ` +
        `or variables removed from the program. Re-save the OPC-UA config ` +
        `through the editor to clean these up permanently.`,
    )
    for (const path of droppedPaths) {
      onWarn(`  dropped: ${path}`)
    }
  }

  const runtimeConfig: RuntimeConfig = {
    name: 'opcua_server',
    protocol: 'OPC-UA',
    config: {
      format_version: OPCUA_CONFIG_FORMAT_VERSION,
      server: buildServerConfig(config),
      security: buildSecurityConfig(config),
      users: buildUsersConfig(config),
      cycle_time_ms: config.cycleTimeMs,
      address_space: addressSpace,
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
  const pathToAddr = parseDebugMapToInfoMap(debugMapContent)

  for (const node of config.addressSpace.nodes) {
    try {
      switch (node.nodeType) {
        case 'variable':
          resolveVariableAddress(node, pathToAddr, instances)
          break
        case 'structure':
          resolveStructureAddresses(node, pathToAddr, instances)
          break
        case 'array':
          if (node.fields && node.fields.length > 0) {
            resolveStructureAddresses(node, pathToAddr, instances)
          } else {
            resolveArrayAddress(node, pathToAddr, instances)
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
