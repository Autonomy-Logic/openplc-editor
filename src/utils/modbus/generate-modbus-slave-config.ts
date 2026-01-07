import type { PLCServer } from '@root/types/PLC/open-plc'

// Default values matching runtime BUFFER_SIZE
const DEFAULT_BUFFER_MAPPING = {
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

/**
 * Generates the Modbus Slave plugin configuration JSON from the project's servers.
 * Returns null if there are no enabled Modbus TCP servers configured.
 *
 * @param servers - Array of PLCServer from the project data
 * @returns The Modbus Slave configuration as a JSON string, or null if no servers are configured
 */
export const generateModbusSlaveConfig = (servers: PLCServer[] | undefined): string | null => {
  if (!servers || servers.length === 0) {
    return null
  }

  const modbusServer = servers.find((server) => server.protocol === 'modbus-tcp' && server.modbusSlaveConfig)

  if (!modbusServer || !modbusServer.modbusSlaveConfig) {
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
        qw_count: bufferMapping.holdingRegisters.qwCount,
        mw_count: bufferMapping.holdingRegisters.mwCount,
        md_count: bufferMapping.holdingRegisters.mdCount,
        ml_count: bufferMapping.holdingRegisters.mlCount,
      },
      coils: {
        qx_bits: bufferMapping.coils.qxBits,
        mx_bits: bufferMapping.coils.mxBits,
      },
      discrete_inputs: {
        ix_bits: bufferMapping.discreteInputs.ixBits,
      },
      input_registers: {
        iw_count: bufferMapping.inputRegisters.iwCount,
      },
    },
  }

  return JSON.stringify(config, null, 2)
}

export { DEFAULT_BUFFER_MAPPING }
export type {
  ModbusSlaveBufferMapping,
  ModbusSlaveCoils,
  ModbusSlaveConfig,
  ModbusSlaveDiscreteInputs,
  ModbusSlaveHoldingRegisters,
  ModbusSlaveInputRegisters,
  ModbusSlaveNetworkConfig,
}
