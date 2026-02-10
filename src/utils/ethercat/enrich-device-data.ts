/**
 * EtherCAT Device Data Enrichment
 *
 * Pure functions that extract persistable data from a full ESIDevice.
 * Used when adding devices to persist channel/PDO metadata for runtime config generation.
 */

import type {
  ESIDevice,
  ESIPdo,
  PersistedChannelInfo,
  PersistedPdo,
  PersistedPdoEntry,
} from '@root/types/ethercat/esi-types'

import { esiTypeToIecType, pdoToChannels } from './esi-parser'

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
 */
export function enrichDeviceData(device: ESIDevice): {
  channelInfo: PersistedChannelInfo[]
  rxPdos: PersistedPdo[]
  txPdos: PersistedPdo[]
  slaveType: string
} {
  return {
    channelInfo: buildChannelInfo(device),
    rxPdos: persistPdos(device.rxPdo),
    txPdos: persistPdos(device.txPdo),
    slaveType: deriveSlaveType(device),
  }
}
