/**
 * EtherCAT Device Data Enrichment
 *
 * Pure functions that extract persistable data from a full ESIDevice.
 * Used when adding devices to persist channel/PDO metadata for runtime config generation.
 */

import type {
  ConfiguredEtherCATDevice,
  EnrichDeviceData,
  ESIDevice,
  ESIPdo,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
  PersistedChannelInfo,
  PersistedPdo,
  PersistedPdoEntry,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'
import {
  type Cia402AxisConfig,
  DEFAULT_CIA402_AXIS_CONFIG,
  isCia402Drive,
} from '@root/middleware/shared/utils/ethercat'

import { assignedPdos, esiTypeToIecType, generateDefaultChannelMappings, pdoToChannels } from './esi-parser'
import { extractDefaultSdoConfigurations } from './sdo-config-defaults'

/**
 * DOPE-704 E2: derive the default CoE flags for a slave config from the ESI. Called on
 * first device import by {@link enrichDeviceData} and on project open by
 * {@link migrateSlaveToE2Schema} when the saved slave lacks the field.
 */
export function deriveCoEFlags(device: ESIDevice): NonNullable<EtherCATSlaveConfig['coeFlags']> {
  return {
    pdoAssign: device.coeFlags?.pdoAssign ?? false,
    pdoConfig: device.coeFlags?.pdoConfig ?? false,
    completeAccess: device.coeFlags?.completeAccess ?? false,
  }
}

/**
 * Convert ESIPdo[] to PersistedPdo[] format.
 * Preserves all entries including padding for complete PDO layout.
 */
export function persistPdos(pdos: ESIPdo[]): PersistedPdo[] {
  const assigned = new Set(assignedPdos(pdos))
  return pdos.map(
    (pdo): PersistedPdo => ({
      index: pdo.index,
      name: pdo.name,
      assigned: assigned.has(pdo),
      // DOPE-704 E2: carry the ESI defaults forward so the UI can grey Fixed PDO entries
      // and reject assignment changes on Mandatory PDOs without opening the ESI again.
      fixed: pdo.fixed || undefined,
      mandatory: pdo.mandatory || undefined,
      sm: pdo.smIndex,
      exclude: pdo.exclude && pdo.exclude.length > 0 ? pdo.exclude : undefined,
      entries: pdo.entries.map(
        (entry): PersistedPdoEntry => ({
          index: entry.index,
          subIndex: entry.subIndex,
          bitLen: entry.bitLen,
          name: entry.name,
          dataType: entry.dataType,
        }),
      ),
    }),
  )
}

/**
 * Build persisted channel info from ESIDevice using pdoToChannels.
 * Extracts full metadata needed for runtime config generation.
 */
export function buildChannelInfo(device: ESIDevice): PersistedChannelInfo[] {
  const channels = pdoToChannels(device)
  return channels.map(
    (ch): PersistedChannelInfo => ({
      channelId: ch.id,
      name: ch.name,
      direction: ch.direction,
      pdoIndex: ch.pdoIndex,
      entryIndex: ch.entryIndex,
      entrySubIndex: ch.entrySubIndex,
      dataType: ch.dataType,
      bitLen: ch.bitLen,
      iecType: esiTypeToIecType(ch.dataType, ch.bitLen),
    }),
  )
}

/**
 * Derive slave device type from PDO structure.
 * Uses heuristics based on PDO direction and data sizes.
 */
export function deriveSlaveType(device: ESIDevice): string {
  const hasNonPaddingEntry = (pdos: ESIPdo[]): boolean =>
    pdos.some((pdo) => pdo.entries.some((e) => e.name !== 'Padding' && e.index !== '0x0000'))

  const allBitSized = (pdos: ESIPdo[]): boolean =>
    pdos.every((pdo) =>
      pdo.entries.filter((e) => e.name !== 'Padding' && e.index !== '0x0000').every((e) => e.bitLen === 1),
    )

  const hasTxData = hasNonPaddingEntry(device.txPdo)
  const hasRxData = hasNonPaddingEntry(device.rxPdo)

  if (!hasTxData && !hasRxData) return 'coupler'

  const txAllBit = hasTxData && allBitSized(device.txPdo)
  const rxAllBit = hasRxData && allBitSized(device.rxPdo)

  if (hasTxData && !hasRxData) {
    return txAllBit ? 'digital_input' : 'analog_input'
  }

  if (hasRxData && !hasTxData) {
    return rxAllBit ? 'digital_output' : 'analog_output'
  }

  // Both directions
  if (txAllBit && rxAllBit) return 'digital_io'
  return 'analog_io'
}

/**
 * Enrich device data by extracting all persistable info from a full ESIDevice.
 * Returns fields to spread into ConfiguredEtherCATDevice.
 *
 * `usedAddresses` is the set of IEC addresses already taken by other devices
 * in the project; the generated `channelMappings` will avoid them. Pass an
 * up-to-date set when adding a device so its outputs/inputs receive valid,
 * non-conflicting IEC locations from the start (otherwise the runtime can't
 * bind them and the slave appears inert until the editor page is opened).
 */
export function enrichDeviceData(
  device: ESIDevice,
  usedAddresses?: Set<string>,
): {
  channelInfo: PersistedChannelInfo[]
  rxPdos: PersistedPdo[]
  txPdos: PersistedPdo[]
  slaveType: string
  sdoConfigurations?: SDOConfigurationEntry[]
  channelMappings: EtherCATChannelMapping[]
  cia402?: Cia402AxisConfig
} {
  return {
    channelInfo: buildChannelInfo(device),
    rxPdos: persistPdos(device.rxPdo),
    txPdos: persistPdos(device.txPdo),
    slaveType: deriveSlaveType(device),
    sdoConfigurations: device.coeObjects?.length ? extractDefaultSdoConfigurations(device.coeObjects) : undefined,
    channelMappings: generateDefaultChannelMappings(pdoToChannels(device), usedAddresses),
    // A CiA 402 servo is auto-recognized as a SoftMotion axis; the user can
    // disable/tune it in the device's Axis configuration.
    cia402: isCia402Drive(device) ? { ...DEFAULT_CIA402_AXIS_CONFIG } : undefined,
  }
}

/** Saved before PDO assignment was recorded: no persisted PDO carries `assigned`. */
export function lacksPdoAssignment(device: ConfiguredEtherCATDevice): boolean {
  const pdos = [...(device.rxPdos ?? []), ...(device.txPdos ?? [])]
  return pdos.length > 0 && pdos.every((pdo) => pdo.assigned === undefined)
}

/**
 * Records the ESI's default PDO assignment on a device saved without it. Channels of unassigned
 * PDOs, and their mappings, are dropped; the addresses of the remaining channels are kept.
 */
export function recordPdoAssignment(device: ConfiguredEtherCATDevice, esiDevice: ESIDevice): EnrichDeviceData {
  const channelInfo = buildChannelInfo(esiDevice)
  const kept = new Set(channelInfo.map((ch) => ch.channelId))
  return {
    channelInfo,
    channelMappings: device.channelMappings.filter((m) => kept.has(m.channelId)),
    rxPdos: persistPdos(esiDevice.rxPdo),
    txPdos: persistPdos(esiDevice.txPdo),
  }
}

/**
 * DOPE-704 E2: has this slave been saved under the pre-E2 schema? True when the slave
 * config is missing `coeFlags` or any of its persisted PDOs is missing the `fixed` /
 * `mandatory` / `exclude` surface. Used by the project loader to decide whether to run
 * the one-time migration + notice.
 */
export function lacksE2Schema(device: ConfiguredEtherCATDevice): boolean {
  if (device.config?.coeFlags === undefined) return true
  const anyPdo = [...(device.rxPdos ?? []), ...(device.txPdos ?? [])][0]
  if (anyPdo === undefined) return false
  // A PDO saved under the E2 schema at least carries the shape; an older PDO has none of
  // the three fields.
  return (
    anyPdo.fixed === undefined &&
    anyPdo.mandatory === undefined &&
    anyPdo.exclude === undefined &&
    anyPdo.sm === undefined
  )
}

/**
 * DOPE-704 E2: brings a slave saved under the pre-E2 schema (or DOPE-657) to the current
 * schema in one pass. Preserves user data verbatim and only fills in fields the ESI knows:
 *
 * - `config.coeFlags` is defaulted from the ESI's `<Mailbox><CoE />`
 * - Each `rxPdos` / `txPdos` entry inherits `fixed` / `mandatory` / `sm` / `exclude` from
 *   the corresponding ESI PDO (matched by index), keeping the user's `assigned` flag
 * - PDO entries themselves are untouched (the generator uses them verbatim)
 *
 * Returns the migrated slave. Idempotent: calling on an already-migrated slave is a no-op.
 */
export function migrateSlaveToE2Schema(
  device: ConfiguredEtherCATDevice,
  esiDevice: ESIDevice,
): ConfiguredEtherCATDevice {
  const mergePdos = (persisted: PersistedPdo[] | undefined, esi: ESIPdo[]): PersistedPdo[] | undefined => {
    if (persisted === undefined || persisted.length === 0) return persisted
    const esiByIndex = new Map(esi.map((p) => [p.index.toLowerCase(), p]))
    return persisted.map((pdo) => {
      const match = esiByIndex.get(pdo.index.toLowerCase())
      if (match === undefined) return pdo
      return {
        ...pdo,
        fixed: pdo.fixed ?? (match.fixed || undefined),
        mandatory: pdo.mandatory ?? (match.mandatory || undefined),
        sm: pdo.sm ?? match.smIndex,
        exclude: pdo.exclude ?? (match.exclude && match.exclude.length > 0 ? match.exclude : undefined),
      }
    })
  }

  const nextRx = mergePdos(device.rxPdos, esiDevice.rxPdo)
  const nextTx = mergePdos(device.txPdos, esiDevice.txPdo)
  const nextCoeFlags = device.config?.coeFlags ?? deriveCoEFlags(esiDevice)

  return {
    ...device,
    config: {
      ...device.config,
      coeFlags: nextCoeFlags,
    },
    rxPdos: nextRx,
    txPdos: nextTx,
  }
}
