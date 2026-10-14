import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  ESIModulePdoGroup,
  PersistedChannelInfo,
  PersistedPdo,
  PersistedPdoEntry,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'
import { sdoTransitions } from '@root/middleware/shared/utils/ethercat/init-cmd-sdo'

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
  /** The device's mapping of this PDO is fixed; EtherDOG compares it with the entries. */
  fixed?: boolean
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
  /** Send the SDO with CoE Complete Access. */
  complete_access?: boolean
  /** Byte-string payload, `0x` hex. When present EtherDOG sends these bytes instead of `value`. */
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

interface RuntimeSlotRule {
  min_instances: number
  max_instances: number
  module_classes: string[]
  module_idents: string[]
}

interface RuntimeModular {
  slot_index_increment: number
  slots: RuntimeSlotRule[]
  modules: Array<{ slot: number; ident: string; class: string }>
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
  /** PDO indices the device requires to be assigned. */
  mandatory_pdos?: string[]
  /** Slot rules and modules of a modular coupler. */
  modular?: RuntimeModular
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

/** Runtime shape of one persisted PDO. Entries with index "0x0000" are padding. */
function convertPdo(pdo: PersistedPdo): RuntimePdo {
  return {
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
    ...(pdo.fixed === true ? { fixed: true } : {}),
  }
}

/**
 * Builds runtime channels by joining channelInfo with channelMappings, leaving out the channels
 * of PDOs recorded as unassigned. `index` is renumbered per slave by the caller.
 */
function buildChannels(
  channelInfo: PersistedChannelInfo[],
  channelMappings: { channelId: string; iecLocation: string }[],
  unassignedPdos: ReadonlySet<string>,
): RuntimeChannel[] {
  const mappingMap = new Map(channelMappings.map((m) => [m.channelId, m.iecLocation]))

  return channelInfo
    .filter((ch) => !unassignedPdos.has(ch.pdoIndex.toLowerCase()))
    .map((ch) => ({
      index: 0,
      name: ch.name,
      type: deriveChannelType(ch.direction, ch.bitLen),
      bit_length: ch.bitLen,
      iec_location: mappingMap.get(ch.channelId) ?? '',
      pdo_index: ch.pdoIndex,
      pdo_entry_index: ch.entryIndex,
      pdo_entry_subindex: hexToInt(ch.entrySubIndex),
    }))
}

function hasBytePayload(entry: SDOConfigurationEntry): boolean {
  return entry.valueBytes !== undefined && entry.valueBytes.length > 0
}

/**
 * Entries without a value are dropped so the slave keeps its own default instead of receiving 0.
 * Byte-string entries (`valueBytes`) are kept even when `value` is empty.
 */
function hasSdoValue(entry: SDOConfigurationEntry): boolean {
  if (hasBytePayload(entry)) return true
  return entry.value !== undefined && entry.value !== null && entry.value.trim() !== ''
}

function toRuntimeSdo(entry: SDOConfigurationEntry, name: string, comment: string): RuntimeSdoConfig {
  const bytes = hasBytePayload(entry)
  return {
    index: entry.index,
    subindex: entry.subIndex,
    value: bytes ? 0 : parseNumericValue(entry.value),
    data_type: entry.dataType,
    bit_length: entry.bitLength,
    name,
    comment,
    ...(bytes && { value_bytes: entry.valueBytes }),
    ...(entry.completeAccess === true && { complete_access: true }),
  }
}

/** The user's startup SDOs. */
function buildSdoConfigurations(entries: SDOConfigurationEntry[] | undefined): RuntimeSdoConfig[] {
  return (entries ?? [])
    .filter(hasSdoValue)
    .map((entry) => toRuntimeSdo(entry, entry.name, `Startup SDO: ${entry.objectName}`))
}

type Phase = 'init' | 'preop'

/** InitCmds listing the IP transition go out before everything written for PS. */
function inPhase(entry: SDOConfigurationEntry, phase: Phase): boolean {
  return sdoTransitions(entry).includes('IP') === (phase === 'init')
}

/** Slave-scope ESI `<InitCmds>`, extracted at enrich time. */
function buildEsiInitCmdSdos(device: ConfiguredEtherCATDevice, phase: Phase): RuntimeSdoConfig[] {
  return (device.esiInitCmdSdos ?? [])
    .filter((entry) => hasSdoValue(entry) && inPhase(entry, phase))
    .map((entry) => toRuntimeSdo(entry, entry.name, `ESI InitCmd: ${entry.objectName}`))
}

/** Each module's startup SDOs in slot order, indices already slot-adjusted. */
function buildModuleStartupSdos(device: ConfiguredEtherCATDevice, phase: Phase): RuntimeSdoConfig[] {
  const out: RuntimeSdoConfig[] = []
  for (const module of modulesBySlot(device)) {
    for (const entry of (module.sdoConfigurations ?? []).filter((e) => hasSdoValue(e) && inPhase(e, phase))) {
      out.push(
        toRuntimeSdo(
          entry,
          `Module slot ${module.slot}: ${entry.name}`,
          `Module slot ${module.slot} startup SDO: ${entry.objectName}`,
        ),
      )
    }
  }
  return out
}

function modulesBySlot(device: ConfiguredEtherCATDevice): ConfiguredEtherCATModule[] {
  return [...(device.modules ?? [])].sort((a, b) => a.slot - b.slot)
}

/**
 * Payload of a CoE Complete Access write starting at sub-index 0: the count as one byte padded
 * to 16 bits (ETG.1000.6), then each item little-endian. Returned as `0x` hex for `value_bytes`.
 */
export function completeAccessPayload(items: readonly number[], itemBytes: 2 | 4): string {
  const bytes: number[] = [items.length & 0xff, 0]
  for (const item of items) {
    for (let b = 0; b < itemBytes; b++) bytes.push((item >>> (8 * b)) & 0xff)
  }
  return `0x${bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('')}`
}

/**
 * Pack one PDO mapping entry into the 32-bit CoE format:
 *   bits 0..7   = bit length,
 *   bits 8..15  = sub-index,
 *   bits 16..31 = entry index.
 */
function packPdoMappingEntry(entry: PersistedPdoEntry): number {
  const idx = parseNumericValue(entry.index) & 0xffff
  const sub = parseNumericValue(entry.subIndex) & 0xff
  const len = entry.bitLen & 0xff
  return ((idx << 16) | (sub << 8) | len) >>> 0
}

type CoeFlags = NonNullable<ConfiguredEtherCATDevice['config']['coeFlags']>

function usint(index: string, subindex: number, value: number, name: string, comment: string): RuntimeSdoConfig {
  return { index, subindex, value, data_type: 'USINT', bit_length: 8, name, comment }
}

/** Mapping rewrite of one PDO: one Complete Access write, or clear, each entry, count. */
function pdoMappingRewrite(pdo: PersistedPdo, label: 'Rx' | 'Tx', completeAccess: boolean): RuntimeSdoConfig[] {
  const packed = pdo.entries.map(packPdoMappingEntry)
  if (completeAccess) {
    return [
      {
        index: pdo.index,
        subindex: 0,
        value: 0,
        data_type: 'OCTET_STRING',
        bit_length: (2 + packed.length * 4) * 8,
        name: `${label}PDO mapping (CA): ${pdo.name}`,
        comment: `PDO mapping ${pdo.index} via CoE Complete Access, ${packed.length} entry(ies)`,
        complete_access: true,
        value_bytes: completeAccessPayload(packed, 4),
      },
    ]
  }
  const out = [usint(pdo.index, 0, 0, `${label}PDO mapping: clear ${pdo.name}`, `PDO mapping (${pdo.index}:0 = 0)`)]
  pdo.entries.forEach((entry, i) => {
    out.push({
      index: pdo.index,
      subindex: i + 1,
      value: packed[i] ?? 0,
      data_type: 'UDINT',
      bit_length: 32,
      name: `${label}PDO mapping: ${pdo.name} entry ${i + 1}`,
      comment: `PDO mapping (${pdo.index}:${i + 1}): ${entry.name}`,
    })
  })
  out.push(
    usint(
      pdo.index,
      0,
      pdo.entries.length,
      `${label}PDO mapping: count ${pdo.name}`,
      `PDO mapping (${pdo.index}:0 = ${pdo.entries.length})`,
    ),
  )
  return out
}

/**
 * Process-data block of one sync manager, in the order: `0x1C1n:0 = 0`; per assigned PDO in
 * assignment order, the mapping rewrite (not Fixed, `PdoConfig`) then `0x1C1n:k = index`
 * (`PdoAssign`); finally `0x1C1n:0 = count`, or the whole list in one Complete Access write.
 * Without `PdoAssign` no `0x1C1n` object is written.
 */
function syncManagerBlock(
  sm: 2 | 3,
  pdos: PersistedPdo[] | undefined,
  label: 'Rx' | 'Tx',
  flags: CoeFlags,
): RuntimeSdoConfig[] {
  if (pdos === undefined || pdos.length === 0) return []
  const assigned = pdos.filter((p) => p.assigned !== false)
  const base = `0x1C1${sm}`
  const out: RuntimeSdoConfig[] = []
  if (flags.pdoAssign) {
    out.push(usint(base, 0, 0, `${label}PDO assignment: clear`, `${label}PDO assignment (${base}:0 = 0)`))
  }
  assigned.forEach((pdo, i) => {
    if (flags.pdoConfig && pdo.fixed !== true && pdo.entries.length > 0) {
      out.push(...pdoMappingRewrite(pdo, label, flags.completeAccess))
    }
    if (flags.pdoAssign && !flags.completeAccess) {
      out.push({
        index: base,
        subindex: i + 1,
        value: parseNumericValue(pdo.index),
        data_type: 'UINT',
        bit_length: 16,
        name: `${label}PDO assignment: entry ${i + 1}`,
        comment: `${label}PDO assignment (${base}:${i + 1} = ${pdo.index}): ${pdo.name}`,
      })
    }
  })
  if (flags.pdoAssign) {
    if (flags.completeAccess) {
      const indices = assigned.map((p) => parseNumericValue(p.index))
      out.push({
        index: base,
        subindex: 0,
        value: 0,
        data_type: 'OCTET_STRING',
        bit_length: (2 + indices.length * 2) * 8,
        name: `${label}PDO assignment (CA)`,
        comment: `${label}PDO assignment ${base} via CoE Complete Access, ${indices.length} PDO(s)`,
        complete_access: true,
        value_bytes: completeAccessPayload(indices, 2),
      })
    } else {
      out.push(
        usint(
          base,
          0,
          assigned.length,
          `${label}PDO assignment: count`,
          `${label}PDO assignment (${base}:0 = ${assigned.length})`,
        ),
      )
    }
  }
  return out
}

/** The slave's process-data block: SM2 (RxPDOs) then SM3 (TxPDOs). Nothing without `PdoAssign` or `PdoConfig`. */
function buildProcessDataSdos(device: ConfiguredEtherCATDevice): RuntimeSdoConfig[] {
  const flags = device.config?.coeFlags
  if (flags === undefined || (!flags.pdoAssign && !flags.pdoConfig)) return []
  return [...syncManagerBlock(2, device.rxPdos, 'Rx', flags), ...syncManagerBlock(3, device.txPdos, 'Tx', flags)]
}

function moduleListTransition(device: ConfiguredEtherCATDevice): string {
  return (device.slotsSpec?.downloadModuleListTransition ?? 'PS').toUpperCase()
}

/**
 * The `0xF030` module ident list, written when the coupler's `<Slots>` declares
 * `DownloadModuleIdentList`. Empty slots carry ident 0. Complete Access when the coupler
 * supports it, otherwise clear, one UDINT per slot, count.
 */
function buildModuleIdentListWrites(device: ConfiguredEtherCATDevice): RuntimeSdoConfig[] {
  if (device.slotsSpec?.downloadModuleIdentList !== true) return []
  const modules = modulesBySlot(device)
  const maxSlot = modules[modules.length - 1]?.slot ?? 0
  if (maxSlot === 0) return []
  const idents: number[] = []
  for (let s = 1; s <= maxSlot; s++) {
    const module = modules.find((m) => m.slot === s)
    idents.push(module ? parseNumericValue(module.ident) >>> 0 : 0)
  }

  if (device.config?.coeFlags?.completeAccess === true) {
    return [
      {
        index: '0xF030',
        subindex: 0,
        value: 0,
        data_type: 'OCTET_STRING',
        bit_length: (2 + idents.length * 4) * 8,
        name: 'Module ident list (CA)',
        comment: `Module ident list (0xF030) via CoE Complete Access, ${idents.length} slot(s)`,
        complete_access: true,
        value_bytes: completeAccessPayload(idents, 4),
      },
    ]
  }

  const out = [usint('0xF030', 0, 0, 'Module ident list: clear', 'Module ident list (0xF030:0 = 0)')]
  idents.forEach((ident, i) => {
    out.push({
      index: '0xF030',
      subindex: i + 1,
      value: ident,
      data_type: 'UDINT',
      bit_length: 32,
      name: `Module ident list: slot ${i + 1}`,
      comment: `Module ident list (0xF030:${i + 1}): slot ${i + 1}`,
    })
  })
  out.push(
    usint('0xF030', 0, idents.length, 'Module ident list: count', `Module ident list (0xF030:0 = ${idents.length})`),
  )
  return out
}

/**
 * Startup SDO order. Writes for the IP transition first: `0xF030`, ESI InitCmds, module
 * InitCmds. Then ESI InitCmds; user startup SDOs; module InitCmds in slot order; `0xF030`;
 * the process-data block per sync manager. EtherDOG sends the whole list in PRE-OP.
 */
function buildStartupSdos(device: ConfiguredEtherCATDevice): RuntimeSdoConfig[] {
  const identList = buildModuleIdentListWrites(device)
  const identAtInit = moduleListTransition(device) === 'IP'
  return [
    ...(identAtInit ? identList : []),
    ...buildEsiInitCmdSdos(device, 'init'),
    ...buildModuleStartupSdos(device, 'init'),
    ...buildEsiInitCmdSdos(device, 'preop'),
    ...buildSdoConfigurations(device.sdoConfigurations),
    ...buildModuleStartupSdos(device, 'preop'),
    ...(identAtInit ? [] : identList),
    ...buildProcessDataSdos(device),
  ]
}

function sameIndex(a: string | undefined, b: string): boolean {
  if (a === undefined) return false
  const x = parseNumericValue(a)
  return x !== 0 && x === parseNumericValue(b)
}

/**
 * Assigned PDOs of one direction as the bus configuration lists them: the coupler's own PDOs in
 * assignment order, merged with module PDOs, ordered by `ModulePdoGroup` and then by slot. A
 * coupler PDO that a group names sorts first in that group; one no group names sorts before all
 * groups. A PDO of a group with `Alignment` n starts on an n-byte boundary, padded at the end of
 * the previous PDO.
 */
function buildBusPdos(device: ConfiguredEtherCATDevice, direction: 'rx' | 'tx'): RuntimePdo[] {
  const groups = device.modulePdoGroups ?? []
  const groupIndex = (g: ESIModulePdoGroup): string | undefined => (direction === 'rx' ? g.rxPdoIndex : g.txPdoIndex)
  const items: Array<{ group: number; slot: number; alignment: number; pdo: PersistedPdo }> = []
  for (const pdo of (direction === 'rx' ? device.rxPdos : device.txPdos) ?? []) {
    const group = groups.find((g) => sameIndex(groupIndex(g), pdo.index))
    items.push({ group: group?.group ?? -1, slot: 0, alignment: group?.alignment ?? 0, pdo })
  }
  for (const module of device.modules ?? []) {
    const group = groups.find((g) => g.group === module.modulePdoGroup)
    for (const pdo of (direction === 'rx' ? module.rxPdos : module.txPdos) ?? []) {
      items.push({
        group: module.modulePdoGroup ?? Number.MAX_SAFE_INTEGER,
        slot: module.slot,
        alignment: group?.alignment ?? 0,
        pdo,
      })
    }
  }
  const ordered = items
    .map((item, order) => ({ ...item, order }))
    .filter((item) => item.pdo.assigned !== false)
    .sort((a, b) => a.group - b.group || a.slot - b.slot || a.order - b.order)

  const out: RuntimePdo[] = []
  let bits = 0
  for (const item of ordered) {
    const boundary = item.alignment * 8
    const previous = out[out.length - 1]
    const pad = boundary > 0 ? (boundary - (bits % boundary)) % boundary : 0
    if (pad > 0 && previous !== undefined) {
      previous.entries.push({ index: '0x0000', subindex: 0, bit_length: pad, name: 'Alignment', data_type: 'PAD' })
      bits += pad
    }
    const pdo = convertPdo(item.pdo)
    bits += pdo.entries.reduce((sum, e) => sum + e.bit_length, 0)
    out.push(pdo)
  }
  return out
}

/**
 * Walk a module's rxPdos / txPdos and emit the channels those PDOs expose. Modules saved
 * without `channelInfo` get it derived from their PDO entries.
 */
function buildModuleChannels(device: ConfiguredEtherCATDevice, unassignedPdos: ReadonlySet<string>): RuntimeChannel[] {
  const out: RuntimeChannel[] = []
  for (const module of modulesBySlot(device)) {
    const info = module.channelInfo ?? deriveModuleChannelInfo(module)
    if (info.length === 0) continue
    out.push(...buildChannels(info, module.channelMappings, unassignedPdos))
  }
  return out
}

/** One channel per non-padding entry of a module's assigned PDOs. */
function deriveModuleChannelInfo(module: ConfiguredEtherCATModule): PersistedChannelInfo[] {
  const out: PersistedChannelInfo[] = []
  const walk = (pdos: PersistedPdo[] | undefined, direction: 'input' | 'output') => {
    if (pdos === undefined) return
    for (const pdo of pdos) {
      if (pdo.assigned === false) continue
      for (const entry of pdo.entries) {
        if (entry.index === '0x0000') continue
        out.push({
          channelId: `${pdo.index}-${entry.index}-${entry.subIndex}`,
          name: entry.name,
          direction,
          pdoIndex: pdo.index,
          entryIndex: entry.index,
          entrySubIndex: entry.subIndex,
          dataType: entry.dataType,
          bitLen: entry.bitLen,
          iecType: entry.dataType,
        })
      }
    }
  }
  walk(module.txPdos, 'input')
  walk(module.rxPdos, 'output')
  return out
}

/** Indices of every PDO the ESI marks Mandatory, on the slave and its modules. */
function mandatoryPdos(allPdos: readonly PersistedPdo[]): string[] {
  return [...new Set(allPdos.filter((pdo) => pdo.mandatory === true).map((pdo) => pdo.index))]
}

/** The coupler's `<Slots>` rules and its modules, for EtherDOG's station check and diagnostics. */
function buildModular(device: ConfiguredEtherCATDevice): RuntimeModular | undefined {
  const spec = device.slotsSpec
  if (device.isModularCoupler !== true || spec === undefined) return undefined
  return {
    slot_index_increment: spec.slotIndexIncrement,
    slots: spec.slots.map((slot) => ({
      min_instances: slot.minInstances,
      max_instances: slot.maxInstances,
      module_classes: slot.moduleClasses ?? [],
      module_idents: slot.moduleIdents ?? [],
    })),
    modules: modulesBySlot(device).map((m) => ({ slot: m.slot, ident: m.ident, class: m.moduleClass ?? '' })),
  }
}

/**
 * Builds a runtime slave from a configured device.
 */
function buildSlave(device: ConfiguredEtherCATDevice, index: number): RuntimeSlave {
  const position = device.position ?? index + 1
  const allPdos = [
    ...(device.rxPdos ?? []),
    ...(device.txPdos ?? []),
    ...(device.modules ?? []).flatMap((m) => [...(m.rxPdos ?? []), ...(m.txPdos ?? [])]),
  ]
  const unassignedPdos = new Set(allPdos.filter((pdo) => pdo.assigned === false).map((pdo) => pdo.index.toLowerCase()))
  const slaveChannels = device.channelInfo
    ? buildChannels(device.channelInfo, device.channelMappings, unassignedPdos)
    : []
  const channels = [...slaveChannels, ...buildModuleChannels(device, unassignedPdos)].map((ch, i) => ({
    ...ch,
    index: i,
  }))

  const cfg = device.config
  const mandatory = mandatoryPdos(allPdos)
  const modular = buildModular(device)

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
    sdo_configurations: buildStartupSdos(device),
    rx_pdos: buildBusPdos(device, 'rx'),
    tx_pdos: buildBusPdos(device, 'tx'),
    ...(mandatory.length > 0 ? { mandatory_pdos: mandatory } : {}),
    ...(modular !== undefined ? { modular } : {}),
  }
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
