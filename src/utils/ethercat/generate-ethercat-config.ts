import type { PLCRemoteDevice } from '@root/types/PLC/open-plc'

// Runtime JSON interfaces (snake_case for plugin consumption)

interface EthercatDcConfig {
  enabled: boolean
  sync0_cycle_us?: number
  sync0_shift_us?: number
}

interface EthercatPdoEntry {
  index: string
  address: string
}

interface EthercatPdoMapping {
  inputs?: EthercatPdoEntry[]
  outputs?: EthercatPdoEntry[]
}

interface EthercatSlaveJson {
  position: number
  name: string
  vendor_id: string
  product_code: string
  revision: string
  check_vendor: boolean
  check_product: boolean
  dc: EthercatDcConfig
  pdo_mapping?: EthercatPdoMapping
}

interface EthercatMasterJson {
  interface: string
  cycle_time_us: number
  dc_enabled: boolean
  dc_sync_offset_percent: number
}

interface EthercatConfigJson {
  master: EthercatMasterJson
  slaves: EthercatSlaveJson[]
}

/**
 * Generates the EtherCAT plugin configuration JSON from the project's remote devices.
 * Returns null if there are no EtherCAT devices configured.
 *
 * @param remoteDevices - Array of PLCRemoteDevice from the project data
 * @returns The EtherCAT configuration as a JSON string, or null if no devices are configured
 */
export const generateEthercatConfig = (remoteDevices: PLCRemoteDevice[] | undefined): string | null => {
  if (!remoteDevices || remoteDevices.length === 0) {
    return null
  }

  const ethercatRemoteDevices = remoteDevices.filter(
    (device) => device.protocol === 'ethercat' && device.ethercatConfig,
  )

  if (ethercatRemoteDevices.length === 0) {
    return null
  }

  // Collect all configured slaves across all EtherCAT remote devices
  const allSlaves: EthercatSlaveJson[] = []
  let anyDcEnabled = false

  for (const remoteDevice of ethercatRemoteDevices) {
    const devices = remoteDevice.ethercatConfig?.devices ?? []

    for (let i = 0; i < devices.length; i++) {
      const device = devices[i]
      const position = device.position ?? i
      const dc = device.config.distributedClocks

      if (dc.dcEnabled) {
        anyDcEnabled = true
      }

      // Build PDO mapping from channel mappings
      const pdoMapping = buildPdoMapping(device.channelMappings)

      const slave: EthercatSlaveJson = {
        position,
        name: device.name,
        vendor_id: device.vendorId,
        product_code: device.productCode,
        revision: device.revisionNo,
        check_vendor: device.config.startupChecks.checkVendorId,
        check_product: device.config.startupChecks.checkProductCode,
        dc: {
          enabled: dc.dcEnabled,
          ...(dc.dcEnabled && {
            sync0_cycle_us: dc.dcSync0CycleUs,
            sync0_shift_us: dc.dcSync0ShiftUs,
          }),
        },
        ...(pdoMapping && { pdo_mapping: pdoMapping }),
      }

      allSlaves.push(slave)
    }
  }

  if (allSlaves.length === 0) {
    return null
  }

  const config: EthercatConfigJson = {
    master: {
      interface: 'eth0',
      cycle_time_us: 4000,
      dc_enabled: anyDcEnabled,
      dc_sync_offset_percent: 20,
    },
    slaves: allSlaves,
  }

  return JSON.stringify(config, null, 2)
}

/**
 * Builds PDO mapping from channel mappings.
 * Groups channel mappings by direction (input/output) based on IEC location prefix.
 */
const buildPdoMapping = (
  channelMappings: { channelId: string; iecLocation: string; userEdited: boolean }[],
): EthercatPdoMapping | null => {
  if (!channelMappings || channelMappings.length === 0) {
    return null
  }

  const inputs: EthercatPdoEntry[] = []
  const outputs: EthercatPdoEntry[] = []

  for (const mapping of channelMappings) {
    const loc = mapping.iecLocation
    // Extract PDO index from channelId (format: "pdo_0x1A00_entry_0x6000_01" or similar)
    const pdoIndexMatch = mapping.channelId.match(/pdo_(0x[0-9A-Fa-f]+)/)
    const pdoIndex = pdoIndexMatch ? pdoIndexMatch[1] : '0x0000'

    const entry: EthercatPdoEntry = {
      index: pdoIndex,
      address: loc,
    }

    // IEC location prefix determines direction: %I = input, %Q = output
    if (loc.startsWith('%I')) {
      inputs.push(entry)
    } else if (loc.startsWith('%Q')) {
      outputs.push(entry)
    }
  }

  if (inputs.length === 0 && outputs.length === 0) {
    return null
  }

  const result: EthercatPdoMapping = {}
  if (inputs.length > 0) result.inputs = inputs
  if (outputs.length > 0) result.outputs = outputs

  return result
}
