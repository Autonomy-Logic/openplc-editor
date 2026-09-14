import type { PLCServer } from '../../../middleware/shared/ports/types'

// Default values matching runtime BUFFER_SIZE
export const DEFAULT_BUFFER_MAPPING = {
  holdingRegisters: { qwCount: 1024, mwCount: 1024, mdCount: 1024, mlCount: 1024 },
  coils: { qxBits: 8192, mxBits: 0 },
  discreteInputs: { ixBits: 8192 },
  inputRegisters: { iwCount: 1024 },
}

interface ModbusSlaveNetworkConfig {
  host: string
  port: number
}

interface ModbusSlaveHoldingRegisters {
  qw_count: number
  mw_count: number
  md_count: number
  ml_count: number
}

interface ModbusSlaveCoils {
  qx_bits: number
  mx_bits: number
}

interface ModbusSlaveDiscreteInputs {
  ix_bits: number
}

interface ModbusSlaveInputRegisters {
  iw_count: number
}

interface ModbusSlaveBufferMapping {
  holding_registers: ModbusSlaveHoldingRegisters
  coils: ModbusSlaveCoils
  discrete_inputs: ModbusSlaveDiscreteInputs
  input_registers: ModbusSlaveInputRegisters
}

interface ModbusSlaveConfig {
  network_configuration: ModbusSlaveNetworkConfig
  buffer_mapping: ModbusSlaveBufferMapping
}

/** Sink for non-fatal diagnostics, wired to the build console. */
type ModbusSlaveConfigLog = (message: string) => void

/**
 * Generates the Modbus Slave plugin configuration JSON from the project's servers.
 * Returns null if there are no enabled Modbus TCP servers configured.
 *
 * The runtime enables the plugin by the presence of `conf/modbus_slave.json`,
 * so a disabled server must produce null — shipping the file opens the port.
 *
 * @param servers - Array of PLCServer from the project data
 * @param log - Optional sink for non-fatal diagnostics (e.g. a second Modbus server)
 * @returns The Modbus Slave configuration as a JSON string, or null if no servers are configured
 */
export const generateModbusSlaveConfig = (
  servers: PLCServer[] | undefined,
  log?: ModbusSlaveConfigLog,
): string | null => {
  if (!servers || servers.length === 0) {
    return null
  }

  const enabledServers = servers.filter(
    (server) => server.protocol === 'modbus-tcp' && server.modbusSlaveConfig?.enabled,
  )

  // The runtime takes one Modbus slave config. A second enabled server is
  // dropped rather than merged, so say which one won instead of picking
  // silently by array order.
  if (enabledServers.length > 1) {
    const dropped = enabledServers
      .slice(1)
      .map((server) => server.name)
      .join(', ')
    log?.(
      `Modbus slave: more than one enabled Modbus TCP server (${enabledServers.map((s) => s.name).join(', ')}). ` +
        `Using "${enabledServers[0].name}"; ignoring ${dropped}.`,
    )
  }

  const modbusServer = enabledServers[0]

  if (!modbusServer?.modbusSlaveConfig) {
    return null
  }

  const { modbusSlaveConfig } = modbusServer

  // Use stored buffer mapping or defaults
  const bufferMapping = modbusSlaveConfig.bufferMapping || DEFAULT_BUFFER_MAPPING

  const config: ModbusSlaveConfig = {
    network_configuration: {
      host: modbusSlaveConfig.networkInterface || '0.0.0.0',
      port: modbusSlaveConfig.port || 502,
    },
    buffer_mapping: {
      holding_registers: {
        qw_count: bufferMapping.holdingRegisters?.qwCount ?? DEFAULT_BUFFER_MAPPING.holdingRegisters.qwCount,
        mw_count: bufferMapping.holdingRegisters?.mwCount ?? DEFAULT_BUFFER_MAPPING.holdingRegisters.mwCount,
        md_count: bufferMapping.holdingRegisters?.mdCount ?? DEFAULT_BUFFER_MAPPING.holdingRegisters.mdCount,
        ml_count: bufferMapping.holdingRegisters?.mlCount ?? DEFAULT_BUFFER_MAPPING.holdingRegisters.mlCount,
      },
      coils: {
        qx_bits: bufferMapping.coils?.qxBits ?? DEFAULT_BUFFER_MAPPING.coils.qxBits,
        mx_bits: bufferMapping.coils?.mxBits ?? DEFAULT_BUFFER_MAPPING.coils.mxBits,
      },
      discrete_inputs: {
        ix_bits: bufferMapping.discreteInputs?.ixBits ?? DEFAULT_BUFFER_MAPPING.discreteInputs.ixBits,
      },
      input_registers: {
        iw_count: bufferMapping.inputRegisters?.iwCount ?? DEFAULT_BUFFER_MAPPING.inputRegisters.iwCount,
      },
    },
  }

  return JSON.stringify(config, null, 2)
}

export type {
  ModbusSlaveBufferMapping,
  ModbusSlaveCoils,
  ModbusSlaveConfig,
  ModbusSlaveConfigLog,
  ModbusSlaveDiscreteInputs,
  ModbusSlaveHoldingRegisters,
  ModbusSlaveInputRegisters,
  ModbusSlaveNetworkConfig,
}
