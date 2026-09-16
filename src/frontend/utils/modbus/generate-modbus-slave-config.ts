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

/**
 * The Modbus slave plugin's configuration, from the project's servers, or `null`
 * when nothing is to be served.
 *
 * A DISABLED server produces nothing. The runtime has no switch of its own: the
 * plugin comes up if and only if `conf/modbus_slave.json` is in the bundle
 * (`composeRuntimeV4Bundle` skips the file for a `null` here), so "not in the
 * configuration" is the only way to express "off". Until now this read the first
 * server carrying a `modbusSlaveConfig` and ignored `enabled` entirely, which
 * made the screen's master switch do nothing at all on Runtime v4 while it
 * worked on baremetal -- and, with several servers in a project, could hand the
 * runtime a disabled one while an enabled one sat behind it in the list.
 *
 * The file the plugin reads describes ONE slave, so one is what this emits. A
 * project may legitimately carry several; the first enabled one wins. Serving
 * several at once would be a change to the plugin's file format, not to this
 * function.
 *
 * @param servers - Array of PLCServer from the project data
 * @returns The Modbus Slave configuration as a JSON string, or null
 */
export const generateModbusSlaveConfig = (servers: PLCServer[] | undefined): string | null => {
  if (!servers || servers.length === 0) {
    return null
  }

  const modbusServer = servers.find(
    (server) => server.protocol === 'modbus-tcp' && server.modbusSlaveConfig && server.modbusSlaveConfig.enabled,
  )

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
  ModbusSlaveDiscreteInputs,
  ModbusSlaveHoldingRegisters,
  ModbusSlaveInputRegisters,
  ModbusSlaveNetworkConfig,
}
