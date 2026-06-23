import type {
  OpcUaClientConfig,
  OpcUaClientMapping,
  OpcUaNodeConfig,
  PLCRemoteDevice,
} from '@root/middleware/shared/ports/open-plc-types'

import { buildLeafInfoMap, type DebugLeafInfo, parseDebugMap as parseDebugMapJson } from '../debug-parser'
import { getErrorMessage } from '../get-error-message'
import { OpcUaConfigError, resolveVariableAddress } from './resolve-indices'
import type { PLCInstanceInfo } from './types'

/**
 * opcua_client.json contract version. Mirrors OPCUA_CLIENT_CONFIG_MIN_FORMAT_VERSION
 * in the runtime's shared.plugin_config_decode.opcua_client_config_model. v1
 * already carries the compiler-canonical per-leaf `datatype` + `size` (from
 * debug-map.json) so the runtime encodes the exact byte width instead of
 * re-deriving it. A runtime that requires >= 1 gracefully refuses an older
 * (unversioned) config instead of writing the wrong number of bytes.
 */
export const OPCUA_CLIENT_CONFIG_FORMAT_VERSION = 1

/**
 * Runtime configuration interfaces (snake_case) — the JSON the OpenPLC
 * OPC-UA Client plugin consumes. See the runtime's opcua_client_config_model.
 */

interface RuntimeClientSecurity {
  security_policy: string
  security_mode: string
  auth_mode: string
  username: string | null
  password: string | null
  client_cert_pem: string | null
  client_key_pem: string | null
  server_cert_pem: string | null
}

interface RuntimeClientMapping {
  remote_node_id: string
  // Local PLC leaf address — resolved from the compiler's debug map, NOT the
  // stored project-model datatype (which can drift from the compiled layout).
  arr: number
  elem: number
  datatype: string
  size: number
  direction: string
  cycle_time_ms: number
}

interface RuntimeClientServer {
  name: string
  endpoint_url: string
  security: RuntimeClientSecurity
  session_timeout_ms: number
  reconnect: boolean
  mappings: RuntimeClientMapping[]
}

interface RuntimeClientPluginConfig {
  /** opcua_client.json contract version — see OPCUA_CLIENT_CONFIG_FORMAT_VERSION. */
  format_version: number
  servers: RuntimeClientServer[]
}

interface RuntimeClientConfig {
  name: string
  protocol: 'OPC-UA-Client'
  config: RuntimeClientPluginConfig
}

/**
 * Parse debug-map.json into the uppercase-path → leaf-info Map the resolver
 * consumes (shared with the OPC-UA server generator). Empty Map on
 * malformed/missing input; the caller distinguishes "no program" from
 * "no mappings".
 */
const parseDebugMapToInfoMap = (content: string): Map<string, DebugLeafInfo> => {
  const map = parseDebugMapJson(content)
  if (!map) return new Map()
  return buildLeafInfoMap(map)
}

const buildSecurity = (config: OpcUaClientConfig): RuntimeClientSecurity => {
  const { security } = config
  return {
    security_policy: security.securityPolicy,
    security_mode: security.securityMode,
    auth_mode: security.authMode,
    username: security.username,
    password: security.password,
    client_cert_pem: security.clientCertPem,
    client_key_pem: security.clientKeyPem,
    server_cert_pem: security.serverCertPem,
  }
}

/**
 * Resolve one mapping's LOCAL PLC variable to its (arr, elem) address and
 * canonical datatype/size, then assemble the runtime mapping. Throws
 * OpcUaConfigError when the local variable can't be resolved (renamed/deleted
 * after configuring) — same hard-error semantics as the server's top-level
 * variables.
 */
const buildMapping = (
  mapping: OpcUaClientMapping,
  pathToAddr: Map<string, DebugLeafInfo>,
  instances: PLCInstanceInfo[],
): RuntimeClientMapping => {
  // resolveVariableAddress only reads pouName/variablePath off the node.
  const addr = resolveVariableAddress(
    { pouName: mapping.pouName, variablePath: mapping.variablePath } as OpcUaNodeConfig,
    pathToAddr,
    instances,
  )

  return {
    remote_node_id: mapping.remoteNodeId,
    arr: addr.arr,
    elem: addr.elem,
    datatype: addr.type,
    size: addr.size,
    direction: mapping.direction,
    cycle_time_ms: mapping.cycleTimeMs,
  }
}

const buildServer = (
  device: PLCRemoteDevice,
  config: OpcUaClientConfig,
  pathToAddr: Map<string, DebugLeafInfo>,
  instances: PLCInstanceInfo[],
): RuntimeClientServer => {
  const mappings: RuntimeClientMapping[] = []
  const errors: OpcUaConfigError[] = []

  for (const mapping of config.mappings) {
    try {
      mappings.push(buildMapping(mapping, pathToAddr, instances))
    } catch (error) {
      if (error instanceof OpcUaConfigError) {
        errors.push(error)
      } else {
        throw error
      }
    }
  }

  if (errors.length > 0) {
    const errorMessages = errors.map((e) => e.message).join('\n\n')
    throw new OpcUaConfigError(
      device.name,
      'multiple',
      `Failed to resolve ${errors.length} OPC-UA client mapping(s) for "${device.name}":\n\n${errorMessages}`,
    )
  }

  return {
    name: device.name,
    endpoint_url: config.endpointUrl,
    security: buildSecurity(config),
    session_timeout_ms: config.sessionTimeoutMs,
    reconnect: config.reconnect,
    mappings,
  }
}

/**
 * Generates the OPC-UA Client configuration JSON for the runtime plugin.
 *
 * Every enabled remote device with protocol 'opc-ua-client' becomes one entry
 * in the runtime's servers[] array. Local variable addresses (arr/elem/size/
 * datatype) are resolved from STruC++'s debug-map.json — the same resolution
 * the OPC-UA server uses — so a renamed/deleted local variable is a hard error.
 *
 * @param remoteDevices - Array of configured PLC remote devices
 * @param debugMapContent - Content of the generated debug-map.json file
 * @param instances - Array of PLC instances from Resources configuration
 * @returns JSON string for opcua_client.json, or null if no enabled client
 */
export const generateOpcUaClientConfig = (
  remoteDevices: PLCRemoteDevice[] | undefined,
  debugMapContent: string,
  instances: PLCInstanceInfo[],
): string | null => {
  if (!remoteDevices || remoteDevices.length === 0) {
    return null
  }

  const clients = remoteDevices.filter(
    (d) => d.protocol === 'opc-ua-client' && d.opcuaClientConfig?.enabled,
  )
  if (clients.length === 0) {
    return null
  }

  // Parse the debug map once for all clients.
  const pathToAddr = parseDebugMapToInfoMap(debugMapContent)

  const totalMappings = clients.reduce((n, d) => n + (d.opcuaClientConfig?.mappings.length ?? 0), 0)
  if (pathToAddr.size === 0 && totalMappings > 0) {
    throw new OpcUaConfigError(
      'debug-map.json',
      'leaves[]',
      'Cannot resolve OPC-UA client variable addresses: debug-map.json is empty or invalid.\n' +
        'This may happen if the PLC program compilation failed.',
    )
  }

  const servers: RuntimeClientServer[] = clients.map((device) =>
    buildServer(device, device.opcuaClientConfig as OpcUaClientConfig, pathToAddr, instances),
  )

  const runtimeConfig: RuntimeClientConfig = {
    name: 'opcua_client',
    protocol: 'OPC-UA-Client',
    config: {
      format_version: OPCUA_CLIENT_CONFIG_FORMAT_VERSION,
      servers,
    },
  }

  return JSON.stringify([runtimeConfig], null, 2)
}

/**
 * Validates the OPC-UA client configuration without throwing. Mirrors
 * validateOpcUaConfig: checks auth requirements and that every mapping's
 * local variable resolves.
 */
export const validateOpcUaClientConfig = (
  config: OpcUaClientConfig,
  debugMapContent: string,
  instances: PLCInstanceInfo[],
): { valid: boolean; errors: string[] } => {
  const errors: string[] = []

  if (!config.endpointUrl.trim()) {
    errors.push('Endpoint URL is required')
  }

  const { security } = config
  if (security.authMode === 'username' && !security.username) {
    errors.push('Username authentication is selected but no username is configured')
  }
  if (security.authMode === 'certificate' && !(security.clientCertPem && security.clientKeyPem)) {
    errors.push('Certificate authentication requires a client certificate and private key')
  }

  const pathToAddr = parseDebugMapToInfoMap(debugMapContent)
  for (const mapping of config.mappings) {
    try {
      resolveVariableAddress(
        { pouName: mapping.pouName, variablePath: mapping.variablePath } as OpcUaNodeConfig,
        pathToAddr,
        instances,
      )
    } catch (error) {
      if (error instanceof OpcUaConfigError) {
        errors.push(error.message)
      } else {
        errors.push(getErrorMessage(error))
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

export type {
  RuntimeClientConfig,
  RuntimeClientMapping,
  RuntimeClientPluginConfig,
  RuntimeClientSecurity,
  RuntimeClientServer,
}
