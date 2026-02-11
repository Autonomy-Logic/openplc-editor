import type { ConfiguredEtherCATDevice, PersistedChannelInfo, PersistedPdo } from '@root/types/ethercat/esi-types'
import type { PLCRemoteDevice } from '@root/types/PLC/open-plc'

// Runtime JSON interfaces (snake_case for plugin consumption)

interface RuntimePdoEntry {
  index: string
  subindex: number
  bit_length: number
  name: string
  data_type: string
}

interface RuntimePdo {
  index: string
  name: string
  entries: RuntimePdoEntry[]
}

interface RuntimeChannel {
  index: number
  name: string
  type: string
  bit_length: number
  iec_location: string
  pdo_index: string
  pdo_entry_index: string
  pdo_entry_subindex: number
}

interface RuntimeSlave {
  position: number
  name: string
  type: string
  vendor_id: string
  product_code: string
  revision: string
  channels: RuntimeChannel[]
  sdo_configurations: unknown[]
  rx_pdos: RuntimePdo[]
  tx_pdos: RuntimePdo[]
}

interface RuntimeMaster {
  interface: string
  cycle_time_us: number
}

interface RuntimeDiagnostics {
  log_connections: boolean
  log_data_access: boolean
  log_errors: boolean
  max_log_entries: number
  status_update_interval_ms: number
}

interface RuntimeConfig {
  master: RuntimeMaster
  slaves: RuntimeSlave[]
  diagnostics: RuntimeDiagnostics
}

interface RuntimeRootEntry {
  name: string
  protocol: string
  config: RuntimeConfig
}

/**
 * Converts a hex string (e.g., "0x01") to an integer.
 */
function hexToInt(hex: string): number {
  return parseInt(hex, 16)
}

/**
 * Derives the channel type string from direction and bit length.
 */
function deriveChannelType(direction: 'input' | 'output', bitLen: number): string {
  if (direction === 'input') {
    return bitLen === 1 ? 'digital_input' : 'analog_input'
  }
  return bitLen === 1 ? 'digital_output' : 'analog_output'
}

/**
 * Converts persisted PDOs to runtime PDO format.
 * Entries with index "0x0000" are treated as padding.
 */
function convertPdos(pdos: PersistedPdo[]): RuntimePdo[] {
  return pdos.map((pdo) => ({
    index: pdo.index,
    name: pdo.name,
    entries: pdo.entries.map(
      (entry): RuntimePdoEntry => ({
        index: entry.index,
        subindex: hexToInt(entry.subIndex),
        bit_length: entry.bitLen,
        name: entry.name,
        data_type: entry.index === '0x0000' ? 'PAD' : entry.dataType,
      }),
    ),
  }))
}

/**
 * Builds runtime channels by joining channelInfo with channelMappings.
 */
function buildChannels(
  channelInfo: PersistedChannelInfo[],
  channelMappings: { channelId: string; iecLocation: string }[],
): RuntimeChannel[] {
  const mappingMap = new Map(channelMappings.map((m) => [m.channelId, m.iecLocation]))

  return channelInfo.map((ch, index) => ({
    index,
    name: ch.name,
    type: deriveChannelType(ch.direction, ch.bitLen),
    bit_length: ch.bitLen,
    iec_location: mappingMap.get(ch.channelId) ?? '',
    pdo_index: ch.pdoIndex,
    pdo_entry_index: ch.entryIndex,
    pdo_entry_subindex: hexToInt(ch.entrySubIndex),
  }))
}

/**
 * Builds a runtime slave from a configured device.
 */
function buildSlave(device: ConfiguredEtherCATDevice, index: number): RuntimeSlave {
  const position = device.position ?? index
  const channels = device.channelInfo ? buildChannels(device.channelInfo, device.channelMappings) : []
  const rxPdos = device.rxPdos ? convertPdos(device.rxPdos) : []
  const txPdos = device.txPdos ? convertPdos(device.txPdos) : []

  return {
    position,
    name: device.name,
    type: device.slaveType ?? 'coupler',
    vendor_id: device.vendorId,
    product_code: device.productCode,
    revision: device.revisionNo,
    channels,
    sdo_configurations: [],
    rx_pdos: rxPdos,
    tx_pdos: txPdos,
  }
}

/**
 * Generates the EtherCAT plugin configuration JSON from the project's remote devices.
 * Produces the exact contract expected by the OpenPLC runtime EtherCAT plugin.
 *
 * Output format: array root `[{ name, protocol: "ETHERCAT", config: { master, slaves[], diagnostics } }]`
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

  // Build one root entry per EtherCAT remote device
  const rootEntries: RuntimeRootEntry[] = []

  for (const remoteDevice of ethercatRemoteDevices) {
    const devices = (remoteDevice.ethercatConfig?.devices ?? []) as ConfiguredEtherCATDevice[]
    const slaves = devices.map((device, i) => buildSlave(device, i))

    if (slaves.length === 0) continue

    rootEntries.push({
      name: remoteDevice.name || 'ethercat_master',
      protocol: 'ETHERCAT',
      config: {
        master: {
          interface: remoteDevice.ethercatConfig?.masterConfig?.networkInterface || 'eth0',
          cycle_time_us: remoteDevice.ethercatConfig?.masterConfig?.cycleTimeUs ?? 1000,
        },
        slaves,
        diagnostics: {
          log_connections: true,
          log_data_access: false,
          log_errors: true,
          max_log_entries: 10000,
          status_update_interval_ms: 500,
        },
      },
    })
  }

  if (rootEntries.length === 0) {
    return null
  }

  return JSON.stringify(rootEntries, null, 2)
}
