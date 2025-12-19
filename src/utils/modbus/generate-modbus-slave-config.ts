import type { PLCServer } from '@root/types/PLC/open-plc'

interface ModbusSlavePluginConfig {
  type: string
  path: string
  enabled: boolean
  description: string
}

interface ModbusSlaveNetworkConfig {
  host: string
  port: number
}

interface ModbusSlaveBufferMapping {
  max_coils: number
  max_discrete_inputs: number
  max_holding_registers: number
  max_input_registers: number
}

interface ModbusSlaveConfig {
  plugin_modbus_slave: ModbusSlavePluginConfig
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

  const config: ModbusSlaveConfig = {
    plugin_modbus_slave: {
      type: 'PLUGIN_TYPE_PYTHON',
      path: 'core/src/drivers/modbus_slave.py',
      enabled: modbusSlaveConfig.enabled,
      description: 'Modbus TCP Slave server that exposes OpenPLC buffers',
    },
    network_configuration: {
      host: modbusSlaveConfig.networkInterface || '0.0.0.0',
      port: modbusSlaveConfig.port || 502,
    },
    buffer_mapping: {
      max_coils: 8000,
      max_discrete_inputs: 8000,
      max_holding_registers: 1000,
      max_input_registers: 1000,
    },
  }

  return JSON.stringify(config, null, 2)
}

export type { ModbusSlaveBufferMapping, ModbusSlaveConfig, ModbusSlaveNetworkConfig, ModbusSlavePluginConfig }
