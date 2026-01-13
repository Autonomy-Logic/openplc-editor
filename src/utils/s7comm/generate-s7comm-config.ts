import type { PLCServer } from '@root/types/PLC/open-plc'

/**
 * S7Comm Runtime Configuration Interfaces
 * These interfaces define the JSON structure expected by the OpenPLC Runtime S7Comm plugin.
 * The runtime uses snake_case naming convention, while the editor uses camelCase.
 */

interface S7CommRuntimeServerConfig {
  enabled: boolean
  bind_address: string
  port: number
  max_clients: number
  work_interval_ms: number
  send_timeout_ms: number
  recv_timeout_ms: number
  ping_timeout_ms: number
  pdu_size: number
}

interface S7CommRuntimePlcIdentity {
  name: string
  module_type: string
  serial_number: string
  copyright: string
  module_name: string
}

interface S7CommRuntimeBufferMapping {
  type: string
  start_buffer: number
  bit_addressing?: boolean
}

interface S7CommRuntimeDataBlock {
  db_number: number
  description: string
  size_bytes: number
  mapping: S7CommRuntimeBufferMapping
}

interface S7CommRuntimeSystemArea {
  enabled: boolean
  size_bytes: number
  mapping?: S7CommRuntimeBufferMapping
}

interface S7CommRuntimeSystemAreas {
  pe_area?: S7CommRuntimeSystemArea
  pa_area?: S7CommRuntimeSystemArea
  mk_area?: S7CommRuntimeSystemArea
}

interface S7CommRuntimeLogging {
  log_connections: boolean
  log_data_access: boolean
  log_errors: boolean
}

interface S7CommRuntimeConfig {
  server: S7CommRuntimeServerConfig
  plc_identity?: S7CommRuntimePlcIdentity
  data_blocks: S7CommRuntimeDataBlock[]
  system_areas?: S7CommRuntimeSystemAreas
  logging?: S7CommRuntimeLogging
}

/**
 * Generates the S7Comm configuration JSON for the runtime plugin.
 * Converts camelCase properties to snake_case expected by the C plugin.
 *
 * @param servers - Array of configured PLC servers
 * @returns JSON string for s7comm.json or null if no enabled S7Comm server
 */
export const generateS7CommConfig = (servers: PLCServer[] | undefined): string | null => {
  if (!servers || servers.length === 0) {
    return null
  }

  const s7commServer = servers.find((server) => server.protocol === 's7comm' && server.s7commSlaveConfig)

  if (!s7commServer || !s7commServer.s7commSlaveConfig) {
    return null
  }

  const config = s7commServer.s7commSlaveConfig

  // Build the runtime configuration object
  const runtimeConfig: S7CommRuntimeConfig = {
    server: {
      enabled: config.server.enabled,
      bind_address: config.server.bindAddress,
      port: config.server.port,
      max_clients: config.server.maxClients,
      work_interval_ms: config.server.workIntervalMs,
      send_timeout_ms: config.server.sendTimeoutMs,
      recv_timeout_ms: config.server.recvTimeoutMs,
      ping_timeout_ms: config.server.pingTimeoutMs,
      pdu_size: config.server.pduSize,
    },
    data_blocks: config.dataBlocks.map((db) => ({
      db_number: db.dbNumber,
      description: db.description,
      size_bytes: db.sizeBytes,
      mapping: {
        type: db.mapping.type,
        start_buffer: db.mapping.startBuffer,
        ...(db.mapping.bitAddressing && { bit_addressing: db.mapping.bitAddressing }),
      },
    })),
  }

  // Add PLC identity if present
  if (config.plcIdentity) {
    runtimeConfig.plc_identity = {
      name: config.plcIdentity.name,
      module_type: config.plcIdentity.moduleType,
      serial_number: config.plcIdentity.serialNumber,
      copyright: config.plcIdentity.copyright,
      module_name: config.plcIdentity.moduleName,
    }
  }

  // Add system areas if present
  if (config.systemAreas) {
    const systemAreas: S7CommRuntimeSystemAreas = {}

    if (config.systemAreas.peArea) {
      systemAreas.pe_area = {
        enabled: config.systemAreas.peArea.enabled,
        size_bytes: config.systemAreas.peArea.sizeBytes,
        ...(config.systemAreas.peArea.mapping && {
          mapping: {
            type: config.systemAreas.peArea.mapping.type,
            start_buffer: config.systemAreas.peArea.mapping.startBuffer,
          },
        }),
      }
    }

    if (config.systemAreas.paArea) {
      systemAreas.pa_area = {
        enabled: config.systemAreas.paArea.enabled,
        size_bytes: config.systemAreas.paArea.sizeBytes,
        ...(config.systemAreas.paArea.mapping && {
          mapping: {
            type: config.systemAreas.paArea.mapping.type,
            start_buffer: config.systemAreas.paArea.mapping.startBuffer,
          },
        }),
      }
    }

    if (config.systemAreas.mkArea) {
      systemAreas.mk_area = {
        enabled: config.systemAreas.mkArea.enabled,
        size_bytes: config.systemAreas.mkArea.sizeBytes,
        ...(config.systemAreas.mkArea.mapping && {
          mapping: {
            type: config.systemAreas.mkArea.mapping.type,
            start_buffer: config.systemAreas.mkArea.mapping.startBuffer,
          },
        }),
      }
    }

    if (Object.keys(systemAreas).length > 0) {
      runtimeConfig.system_areas = systemAreas
    }
  }

  // Add logging if present
  if (config.logging) {
    runtimeConfig.logging = {
      log_connections: config.logging.logConnections,
      log_data_access: config.logging.logDataAccess,
      log_errors: config.logging.logErrors,
    }
  }

  return JSON.stringify(runtimeConfig, null, 2)
}

export type {
  S7CommRuntimeBufferMapping,
  S7CommRuntimeConfig,
  S7CommRuntimeDataBlock,
  S7CommRuntimeLogging,
  S7CommRuntimePlcIdentity,
  S7CommRuntimeServerConfig,
  S7CommRuntimeSystemArea,
  S7CommRuntimeSystemAreas,
}
