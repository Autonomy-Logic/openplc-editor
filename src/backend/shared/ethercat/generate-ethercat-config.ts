import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type {
  ConfiguredEtherCATDevice,
  PersistedChannelInfo,
  PersistedPdo,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'

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

interface RuntimeSdoConfig {
  index: string
  subindex: number
  value: number
  data_type: string
  bit_length: number
  name: string
  comment: string
}

interface RuntimeSlaveConfig {
  startup_checks: {
    check_vendor_id: boolean
    check_product_code: boolean
  }
  addressing: {
    ethercat_address: number
  }
  timeouts: {
    sdo_timeout_ms: number
    init_to_preop_timeout_ms: number
    safeop_to_op_timeout_ms: number
  }
  watchdog: {
    sm_watchdog_enabled: boolean
    sm_watchdog_ms: number
    pdi_watchdog_enabled: boolean
    pdi_watchdog_ms: number
  }
  distributed_clocks: {
    enabled: boolean
    sync_unit_cycle_us: number
    sync0_enabled: boolean
    sync0_cycle_us: number
    sync0_shift_us: number
    sync1_enabled: boolean
    sync1_cycle_us: number
    sync1_shift_us: number
  }
}

interface RuntimeSlave {
  position: number
  name: string
  type: string
  vendor_id: string
  product_code: string
  revision: string
  config: RuntimeSlaveConfig
  channels: RuntimeChannel[]
  sdo_configurations: RuntimeSdoConfig[]
  rx_pdos: RuntimePdo[]
  tx_pdos: RuntimePdo[]
}

interface RuntimeMaster {
  interface: string
  cycle_time_us: number
  watchdog_timeout_cycles: number
  /** SCHED_FIFO priority (1-99) the bus thread runs at. The runtime
   *  defaults to 90 if absent so existing configs keep working. */
  task_priority?: number
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
 * Parses a user-entered value string into a numeric value.
 * Handles:
 *   - Decimal ("100"), hex ("0xFF", "#xFF"), float ("3.14"), negative ("-50")
 *   - BOOL strings ("TRUE"/"FALSE", case-insensitive) -> 1/0.  Without this
 *     branch the decoder's BOOL output collapses to 0 because Number("TRUE")
 *     is NaN.
 * Returns 0 for empty or unparseable strings.
 */
function parseNumericValue(str: string): number {
  if (!str || str.trim() === '') return 0

  const trimmed = str.trim()

  // BOOL literals (decoder output for BOOL defaults uses these)
  const lower = trimmed.toLowerCase()
  if (lower === 'true') return 1
  if (lower === 'false') return 0

  // Handle hex prefixes: "0x" / "0X" / "#x" / "#X"
  if (/^(0x|#x)/i.test(trimmed)) {
    const hexStr = trimmed.replace(/^#x/i, '0x')
    const parsed = Number(hexStr)
    return isNaN(parsed) ? 0 : parsed
  }

  const parsed = Number(trimmed)
  return isNaN(parsed) ? 0 : parsed
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
 * Converts SDOConfigurationEntry[] to RuntimeSdoConfig[] for the runtime plugin.
 *
 * Entries the operator left blank (empty value) are dropped: the ESI may
 * declare an RW SDO without a vendor default expecting the operator to
 * supply one.  If they did not, we must not silently send 0 -- the slave's
 * own internal default applies instead.
 */
function buildSdoConfigurations(entries: SDOConfigurationEntry[] | undefined): RuntimeSdoConfig[] {
  if (!entries || entries.length === 0) return []

  return entries
    .filter((entry) => entry.value !== undefined && entry.value !== null && entry.value.trim() !== '')
    .map(
      (entry): RuntimeSdoConfig => ({
        index: entry.index,
        subindex: entry.subIndex,
        value: parseNumericValue(entry.value),
        data_type: entry.dataType,
        bit_length: entry.bitLength,
        name: entry.name,
        comment: `Startup SDO: ${entry.objectName}`,
      }),
    )
}

/**
 * Builds a runtime slave from a configured device.
 */
function buildSlave(device: ConfiguredEtherCATDevice, index: number): RuntimeSlave {
  const position = device.position ?? index + 1
  const channels = device.channelInfo ? buildChannels(device.channelInfo, device.channelMappings) : []
  const rxPdos = device.rxPdos ? convertPdos(device.rxPdos) : []
  const txPdos = device.txPdos ? convertPdos(device.txPdos) : []

  const cfg = device.config

  return {
    position,
    name: device.name,
    type: device.slaveType ?? 'coupler',
    vendor_id: device.vendorId,
    product_code: device.productCode,
    revision: device.revisionNo,
    config: {
      startup_checks: {
        check_vendor_id: cfg.startupChecks.checkVendorId,
        check_product_code: cfg.startupChecks.checkProductCode,
      },
      addressing: {
        ethercat_address: cfg.addressing.ethercatAddress,
      },
      timeouts: {
        sdo_timeout_ms: cfg.timeouts.sdoTimeoutMs,
        init_to_preop_timeout_ms: cfg.timeouts.initToPreOpTimeoutMs,
        safeop_to_op_timeout_ms: cfg.timeouts.safeOpToOpTimeoutMs,
      },
      watchdog: {
        sm_watchdog_enabled: cfg.watchdog.smWatchdogEnabled,
        sm_watchdog_ms: cfg.watchdog.smWatchdogMs,
        pdi_watchdog_enabled: cfg.watchdog.pdiWatchdogEnabled,
        pdi_watchdog_ms: cfg.watchdog.pdiWatchdogMs,
      },
      distributed_clocks: {
        enabled: cfg.distributedClocks.dcEnabled,
        sync_unit_cycle_us: cfg.distributedClocks.dcSyncUnitCycleUs,
        sync0_enabled: cfg.distributedClocks.dcSync0Enabled,
        sync0_cycle_us: cfg.distributedClocks.dcSync0CycleUs,
        sync0_shift_us: cfg.distributedClocks.dcSync0ShiftUs,
        sync1_enabled: cfg.distributedClocks.dcSync1Enabled,
        sync1_cycle_us: cfg.distributedClocks.dcSync1CycleUs,
        sync1_shift_us: cfg.distributedClocks.dcSync1ShiftUs,
      },
    },
    channels,
    sdo_configurations: buildSdoConfigurations(device.sdoConfigurations),
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
    (device) =>
      device.protocol === 'ethercat' && device.ethercatConfig && (device.ethercatConfig.masterConfig?.enabled ?? true),
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

    const cycleTimeUs = remoteDevice.ethercatConfig?.masterConfig?.cycleTimeUs ?? 1000
    const taskPriority = remoteDevice.ethercatConfig?.masterConfig?.taskPriority ?? 90

    const master: RuntimeMaster = {
      interface: remoteDevice.ethercatConfig?.masterConfig?.networkInterface || 'eth0',
      cycle_time_us: cycleTimeUs,
      watchdog_timeout_cycles: remoteDevice.ethercatConfig?.masterConfig?.watchdogTimeoutCycles ?? 3,
      task_priority: taskPriority,
    }

    rootEntries.push({
      name: remoteDevice.name || 'ethercat_master',
      protocol: 'ETHERCAT',
      config: {
        master,
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
