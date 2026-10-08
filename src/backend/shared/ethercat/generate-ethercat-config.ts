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
  /** DOPE-704 E3 / RTOP-319 R2: send the SDO with CoE Complete Access. */
  complete_access?: boolean
  /**
   * DOPE-704 E3 / RTOP-319 R2: byte-string payload. When present, EtherDOG uses this
   * instead of `value` and ignores `data_type` for the wire bytes.
   */
  value_bytes?: string
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

// EtherDOG bus configuration: the legacy shape without `iec_location`

type BusChannel = Omit<RuntimeChannel, 'iec_location'>

type BusSlave = Omit<RuntimeSlave, 'channels'> & { channels: BusChannel[] }

type BusRootEntry = Omit<RuntimeRootEntry, 'config'> & {
  config: Omit<RuntimeConfig, 'slaves'> & { slaves: BusSlave[] }
}

// Runtime I/O mapping: located variables keyed by slave position and PDO entry

interface IoMappingEntry {
  slave: number
  index: string
  subindex: number
  iec_location: string
}

interface IoMappingMaster {
  name: string
  entries: IoMappingEntry[]
}

interface IoMappingDocument {
  version: 1
  masters: IoMappingMaster[]
}

export interface EtherdogConfigs {
  busconfig: string
  iomapping: string
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
  return pdos
    .filter((pdo) => pdo.assigned !== false)
    .map((pdo) => ({
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
 * Builds runtime channels by joining channelInfo with channelMappings, leaving out the channels
 * of PDOs recorded as unassigned.
 */
function buildChannels(
  channelInfo: PersistedChannelInfo[],
  channelMappings: { channelId: string; iecLocation: string }[],
  unassignedPdos: ReadonlySet<string>,
): RuntimeChannel[] {
  const mappingMap = new Map(channelMappings.map((m) => [m.channelId, m.iecLocation]))

  return channelInfo
    .filter((ch) => !unassignedPdos.has(ch.pdoIndex.toLowerCase()))
    .map((ch, index) => ({
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
 * DOPE-704 E3: emit the PDO-assignment startup SDOs the slave needs to boot in the
 * configured mapping. The sequence matches CODESYS 3.5.22.10 verbatim (verified from the
 * decompiled configurator sources on the Delta ASDA-A2-E case):
 *
 *   for each sync manager n where the slave advertises `PdoAssign` AND the user assigned
 *   at least one PDO:
 *     1. 0x1C1n:0 = 0            (clear the current count)
 *     2. for each assigned PDO in index-sort order:
 *        0x1C1n:k = <pdo index>  (slot k = 1..count)
 *     3. 0x1C1n:0 = count        (publish the new count)
 *
 * Sync manager 2 carries RxPDOs (`0x1C12`), sync manager 3 carries TxPDOs (`0x1C13`).
 * A slave whose ESI declares no `PdoAssign` gets no writes regardless of what the user
 * ticked in Expert view, matching BR06 in the Requirements Gathering.
 *
 * The emission order inside the full SDO list is: user startup SDOs first (what
 * {@link buildSdoConfigurations} returned), then the PDO-assignment block. The user's
 * writes may initialise mode-of-operation or similar state the drive uses to interpret
 * the subsequent assignment, so they must land first.
 */
function buildPdoAssignmentSdos(device: ConfiguredEtherCATDevice): RuntimeSdoConfig[] {
  const coeFlags = device.config?.coeFlags
  if (coeFlags === undefined || !coeFlags.pdoAssign) return []

  const emit = (sm: number, pdos: PersistedPdo[] | undefined, label: 'Rx' | 'Tx'): RuntimeSdoConfig[] => {
    if (pdos === undefined || pdos.length === 0) return []
    // Assigned = present in config, not explicitly unassigned. Projects saved under the
    // DOPE-657 schema (assigned === undefined) are treated as every PDO assigned.
    const assigned = pdos.filter((p) => p.assigned !== false)
    if (assigned.length === 0) return []
    const sortedByIndex = [...assigned].sort((a, b) => a.index.localeCompare(b.index))
    const base = `0x1C1${sm.toString(16).toUpperCase()}`
    const out: RuntimeSdoConfig[] = []
    // Step 1: clear
    out.push({
      index: base,
      subindex: 0,
      value: 0,
      data_type: 'USINT',
      bit_length: 8,
      name: `${label}PDO assignment: clear`,
      comment: `${label}PDO assignment (${base}:0 = 0) — clear the current count`,
    })
    // Step 2: list each assigned PDO
    for (let i = 0; i < sortedByIndex.length; i++) {
      const pdo = sortedByIndex[i]
      if (pdo === undefined) continue
      out.push({
        index: base,
        subindex: i + 1,
        value: parseNumericValue(pdo.index),
        data_type: 'UINT',
        bit_length: 16,
        name: `${label}PDO assignment: slot ${i + 1}`,
        comment: `${label}PDO assignment (${base}:${i + 1} = ${pdo.index}) — ${pdo.name}`,
      })
    }
    // Step 3: publish the count
    out.push({
      index: base,
      subindex: 0,
      value: sortedByIndex.length,
      data_type: 'USINT',
      bit_length: 8,
      name: `${label}PDO assignment: count`,
      comment: `${label}PDO assignment (${base}:0 = ${sortedByIndex.length}) — publish the count`,
    })
    return out
  }

  return [...emit(2, device.rxPdos, 'Rx'), ...emit(3, device.txPdos, 'Tx')]
}

/**
 * Builds a runtime slave from a configured device.
 */
function buildSlave(device: ConfiguredEtherCATDevice, index: number): RuntimeSlave {
  const position = device.position ?? index + 1
  const unassignedPdos = new Set(
    [...(device.rxPdos ?? []), ...(device.txPdos ?? [])]
      .filter((pdo) => pdo.assigned === false)
      .map((pdo) => pdo.index.toLowerCase()),
  )
  const channels = device.channelInfo ? buildChannels(device.channelInfo, device.channelMappings, unassignedPdos) : []
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
    sdo_configurations: [
      ...buildSdoConfigurations(device.sdoConfigurations),
      ...buildModuleStartupSdos(device),
      ...buildModuleIdentListWrites(device),
      ...buildPdoAssignmentSdos(device),
    ],
    rx_pdos: [...rxPdos, ...buildModulePdos(device, 'rx')],
    tx_pdos: [...txPdos, ...buildModulePdos(device, 'tx')],
  }
}

/**
 * DOPE-704 E5: a modular coupler's module PDOs. The module stores slot-adjusted PDO
 * indices directly (set when the user adds the module via the UI), so the generator
 * just copies them through, after the coupler's own PDOs. Ordering within a direction
 * is by slot. A module's rxPdos/txPdos are concatenated after the coupler's; the result
 * matches the ETG.5001 convention of "coupler group first, then module group".
 */
function buildModulePdos(device: ConfiguredEtherCATDevice, direction: 'rx' | 'tx'): RuntimePdo[] {
  if (!device.modules || device.modules.length === 0) return []
  const bySlot = [...device.modules].sort((a, b) => a.slot - b.slot)
  const out: RuntimePdo[] = []
  for (const module of bySlot) {
    const pdos = direction === 'rx' ? module.rxPdos : module.txPdos
    if (pdos === undefined) continue
    out.push(...convertPdos(pdos))
  }
  return out
}

/**
 * DOPE-704 E5: each module's startup SDOs. The module's SDOConfigurationEntry list
 * carries slot-adjusted indices (`0x80n0` for slot n) and may contain byte-string
 * payloads for `InitCmd` writes like the UR20 module name at `0x80n0:03`. The byte
 * payload is passed through to EtherDOG via `value_bytes` and `complete_access` when
 * present on the entry.
 *
 * Ordering: user startup SDOs come first (see buildSlave), then module SDOs in slot
 * order, then the module-ident-list write (`0xF030`), then the PDO-assignment block.
 * This matches CODESYS 3.5.22.10's generated-startup order for a UR20 project.
 */
function buildModuleStartupSdos(device: ConfiguredEtherCATDevice): RuntimeSdoConfig[] {
  if (!device.modules || device.modules.length === 0) return []
  const bySlot = [...device.modules].sort((a, b) => a.slot - b.slot)
  const out: RuntimeSdoConfig[] = []
  for (const module of bySlot) {
    if (!module.sdoConfigurations) continue
    for (const entry of module.sdoConfigurations) {
      if (entry.value === undefined || entry.value === null || entry.value.trim() === '') continue
      const sdo: RuntimeSdoConfig = {
        index: entry.index,
        subindex: entry.subIndex,
        value: parseNumericValue(entry.value),
        data_type: entry.dataType,
        bit_length: entry.bitLength,
        name: `Module slot ${module.slot}: ${entry.name}`,
        comment: `Module slot ${module.slot} startup SDO: ${entry.objectName}`,
      }
      out.push(sdo)
    }
  }
  return out
}

/**
 * DOPE-704 E5: the `0xF030` module-ident-list write that tells a modular coupler which
 * modules are plugged in and where. Only emitted when `coeFlags.pdoConfig` is true
 * (ETG.5001 couplers use PdoConfig to gate the module-list download — PdoAssign stays
 * false on couplers like UR20).
 *
 * Emission shape: clear-then-list-then-count on 0xF030 sub-indices. The ETG.5001 Complete
 * Access path (one PDU with the full ident array) is reserved for a follow-up when EtherDOG's
 * `value_bytes` encoder gains the UDINT-array helper (RTOP-319 R2 already carries the
 * byte-string plumbing; the UDINT-array encoder is the only missing piece).
 *
 * Empty slots in the station emit ident 0, matching ETG.5001 behaviour.
 */
function buildModuleIdentListWrites(device: ConfiguredEtherCATDevice): RuntimeSdoConfig[] {
  if (!device.modules || device.modules.length === 0) return []
  const coeFlags = device.config?.coeFlags
  if (coeFlags === undefined || !coeFlags.pdoConfig) return []

  const bySlot = [...device.modules].sort((a, b) => a.slot - b.slot)
  // Fill empty slot positions with ident 0 (ETG.5001 allows holes).
  const maxSlot = bySlot[bySlot.length - 1]?.slot ?? 0
  const idents: number[] = []
  for (let s = 1; s <= maxSlot; s++) {
    const module = bySlot.find((m) => m.slot === s)
    idents.push(module ? parseNumericValue(module.ident) : 0)
  }

  const out: RuntimeSdoConfig[] = []
  // Step 1: clear
  out.push({
    index: '0x0F30',
    subindex: 0,
    value: 0,
    data_type: 'USINT',
    bit_length: 8,
    name: 'Module ident list: clear',
    comment: 'Module ident list (0xF030:0 = 0) — clear the current count',
  })
  // Step 2: list idents in slot order
  for (let i = 0; i < idents.length; i++) {
    out.push({
      index: '0x0F30',
      subindex: i + 1,
      value: idents[i] ?? 0,
      data_type: 'UDINT',
      bit_length: 32,
      name: `Module ident list: slot ${i + 1}`,
      comment: `Module ident list (0xF030:${i + 1}) — slot ${i + 1} ident`,
    })
  }
  // Step 3: publish count
  out.push({
    index: '0x0F30',
    subindex: 0,
    value: idents.length,
    data_type: 'USINT',
    bit_length: 8,
    name: 'Module ident list: count',
    comment: `Module ident list (0xF030:0 = ${idents.length}) — publish the count`,
  })
  return out
}

/**
 * Builds one root entry per enabled EtherCAT master that has slaves.
 * Channels carry `iec_location`, as the legacy single file expects.
 */
function buildRootEntries(remoteDevices: PLCRemoteDevice[] | undefined): RuntimeRootEntry[] {
  if (!remoteDevices || remoteDevices.length === 0) {
    return []
  }

  const ethercatRemoteDevices = remoteDevices.filter(
    (device) =>
      device.protocol === 'ethercat' && device.ethercatConfig && (device.ethercatConfig.masterConfig?.enabled ?? true),
  )

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

  return rootEntries
}

/**
 * Generates the legacy single-file EtherCAT configuration (`conf/ethercat.json`) consumed by the
 * runtime's bundled SOEM plugin (runtimes older than `MIN_ETHERDOG_RUNTIME_VERSION`).
 *
 * Output format: array root `[{ name, protocol: "ETHERCAT", config: { master, slaves[], diagnostics } }]`
 *
 * @param remoteDevices - Array of PLCRemoteDevice from the project data
 * @returns The EtherCAT configuration as a JSON string, or null if no devices are configured
 */
export const generateEthercatConfig = (remoteDevices: PLCRemoteDevice[] | undefined): string | null => {
  const rootEntries = buildRootEntries(remoteDevices)
  if (rootEntries.length === 0) {
    return null
  }

  return JSON.stringify(rootEntries, null, 2)
}

/**
 * Generates the two EtherDOG-era EtherCAT documents:
 *  - `busconfig` (`conf/ethercat_busconfig.json`): the legacy array with no `iec_location` on
 *    any channel. Read only by EtherDOG, so it carries no PLC concepts.
 *  - `iomapping` (`conf/ethercat_iomapping.json`): one master per busconfig root entry, same
 *    order and name, one entry per channel with a located variable. Read only by the runtime.
 *
 * @returns Both JSON strings, or null if no devices are configured
 */
export const generateEtherdogConfigs = (remoteDevices: PLCRemoteDevice[] | undefined): EtherdogConfigs | null => {
  const rootEntries = buildRootEntries(remoteDevices)
  if (rootEntries.length === 0) {
    return null
  }

  const masters: IoMappingMaster[] = []
  const busEntries = rootEntries.map((entry): BusRootEntry => {
    const entries: IoMappingEntry[] = []
    const slaves = entry.config.slaves.map((slave): BusSlave => {
      const channels = slave.channels.map(({ iec_location, ...channel }): BusChannel => {
        if (iec_location) {
          entries.push({
            slave: slave.position,
            index: channel.pdo_entry_index,
            subindex: channel.pdo_entry_subindex,
            iec_location,
          })
        }
        return channel
      })
      return { ...slave, channels }
    })
    masters.push({ name: entry.name, entries })
    return { ...entry, config: { ...entry.config, slaves } }
  })

  const iomapping: IoMappingDocument = { version: 1, masters }

  return {
    busconfig: JSON.stringify(busEntries, null, 2),
    iomapping: JSON.stringify(iomapping, null, 2),
  }
}
