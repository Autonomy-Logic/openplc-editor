/**
 * EtherCAT Device Data Enrichment
 *
 * Pure functions that extract persistable data from a full ESIDevice.
 * Used when adding devices to persist channel/PDO metadata for runtime config generation.
 */

import type {
  ESIDevice,
  ESIPdo,
  EtherCATChannelMapping,
  PersistedChannelInfo,
  PersistedPdo,
  PersistedPdoEntry,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'

import { esiTypeToIecType, generateDefaultChannelMappings, pdoToChannels } from './esi-parser'
import { extractDefaultSdoConfigurations } from './sdo-config-defaults'

/**
 * Convert ESIPdo[] to PersistedPdo[] format.
 * Preserves all entries including padding for complete PDO layout.
 */
export function persistPdos(pdos: ESIPdo[]): PersistedPdo[] {
  return pdos.map((pdo) => ({
    index: pdo.index,
    name: pdo.name,
    entries: pdo.entries.map(
      (entry): PersistedPdoEntry => ({
        index: entry.index,
        subIndex: entry.subIndex,
        bitLen: entry.bitLen,
        name: entry.name,
        dataType: entry.dataType,
      }),
    ),
  }))
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
} {
  return {
    channelInfo: buildChannelInfo(device),
    rxPdos: persistPdos(device.rxPdo),
    txPdos: persistPdos(device.txPdo),
    slaveType: deriveSlaveType(device),
    sdoConfigurations: device.coeObjects?.length ? extractDefaultSdoConfigurations(device.coeObjects) : undefined,
    channelMappings: generateDefaultChannelMappings(pdoToChannels(device), usedAddresses),
  }
}
