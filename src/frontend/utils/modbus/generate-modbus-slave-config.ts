import type { ModbusBufferMapping, PLCServer } from '../../../middleware/shared/ports/types'

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
 * What a segment the user never configured should expose.
 *
 * NOT `DEFAULT_BUFFER_MAPPING` when the image sizes are known, and the
 * difference is the whole point (DOPE-615). Those defaults are 1024 registers
 * and 8192 bits — precisely the fixed image the runtime used to allocate — so
 * they were right only for as long as every image was that size. Now that the
 * image follows the project, falling back to them would ship a `modbus.json`
 * declaring 1024 holding registers beside an `image.conf` saying
 * `int_output=4`, and the slave plugin would be configured to publish
 * addresses the image does not contain.
 *
 * So an unconfigured segment exposes exactly what the image holds, which is
 * FR16 ("the servers must expose the range actually sized") applied at the
 * point the file is written rather than left for the plugin to discover. The
 * two files in the bundle then agree by construction rather than by
 * coincidence.
 *
 * `imageSizes` is absent only where the caller has no image to offer — the
 * unit tests, and any future caller outside the compile pipeline — and the old
 * defaults still stand there.
 *
 * THE BIT COUNTS ARE EXACT, NOT PADDED. The sizer reports a raw high-water
 * mark and only the bare-metal emitter rounds to a whole byte, so a project
 * with six coils advertises six over Modbus rather than eight. Before that
 * split the padding leaked into this file and the server published two coils
 * the program had no variable for — harmless to read, and a lie about what
 * exists.
 */
const segmentDefault = (
  imageSizes: Readonly<Record<string, number>> | undefined,
  prefix: string,
  fallback: number,
): number => (imageSizes ? (imageSizes[prefix] ?? 0) : fallback)

/**
 * Generates the Modbus Slave plugin configuration JSON from the project's servers.
 * Returns null if there are no enabled Modbus TCP servers configured.
 *
 * @param servers - Array of PLCServer from the project data
 * @param imageSizes - Slots per IEC prefix for this project, from `computeIoImage`.
 *   Supplies the counts for any segment the user did not configure, so this file
 *   and `image.conf` cannot disagree about what exists.
 * @returns The Modbus Slave configuration as a JSON string, or null if no servers are configured
 */
export const generateModbusSlaveConfig = (
  servers: PLCServer[] | undefined,
  imageSizes?: Readonly<Record<string, number>>,
): string | null => {
  if (!servers || servers.length === 0) {
    return null
  }

  const modbusServer = servers.find((server) => server.protocol === 'modbus-tcp' && server.modbusSlaveConfig)

  if (!modbusServer || !modbusServer.modbusSlaveConfig) {
    return null
  }

  const { modbusSlaveConfig } = modbusServer

  // An empty object rather than DEFAULT_BUFFER_MAPPING, so the per-field
  // fallbacks below are the ones that decide. Substituting the whole default
  // here would fill every count with 1024/8192 before `segmentDefault` ever
  // ran, which is precisely how modbus.json came to disagree with image.conf.
  // Callers with no image still land on the same defaults, one field at a time.
  const bufferMapping: ModbusBufferMapping = modbusSlaveConfig.bufferMapping ?? {}

  const config: ModbusSlaveConfig = {
    network_configuration: {
      host: modbusSlaveConfig.networkInterface || '0.0.0.0',
      port: modbusSlaveConfig.port || 502,
    },
    buffer_mapping: {
      holding_registers: {
        qw_count:
          bufferMapping.holdingRegisters?.qwCount ??
          segmentDefault(imageSizes, '%QW', DEFAULT_BUFFER_MAPPING.holdingRegisters.qwCount),
        mw_count:
          bufferMapping.holdingRegisters?.mwCount ??
          segmentDefault(imageSizes, '%MW', DEFAULT_BUFFER_MAPPING.holdingRegisters.mwCount),
        md_count:
          bufferMapping.holdingRegisters?.mdCount ??
          segmentDefault(imageSizes, '%MD', DEFAULT_BUFFER_MAPPING.holdingRegisters.mdCount),
        ml_count:
          bufferMapping.holdingRegisters?.mlCount ??
          segmentDefault(imageSizes, '%ML', DEFAULT_BUFFER_MAPPING.holdingRegisters.mlCount),
      },
      coils: {
        qx_bits: bufferMapping.coils?.qxBits ?? segmentDefault(imageSizes, '%QX', DEFAULT_BUFFER_MAPPING.coils.qxBits),
        mx_bits: bufferMapping.coils?.mxBits ?? segmentDefault(imageSizes, '%MX', DEFAULT_BUFFER_MAPPING.coils.mxBits),
      },
      discrete_inputs: {
        ix_bits:
          bufferMapping.discreteInputs?.ixBits ??
          segmentDefault(imageSizes, '%IX', DEFAULT_BUFFER_MAPPING.discreteInputs.ixBits),
      },
      input_registers: {
        iw_count:
          bufferMapping.inputRegisters?.iwCount ??
          segmentDefault(imageSizes, '%IW', DEFAULT_BUFFER_MAPPING.inputRegisters.iwCount),
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
