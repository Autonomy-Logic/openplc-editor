/**
 * EtherCAT ESI Channel Utilities
 *
 * Functions for working with parsed ESI device data:
 * - PDO-to-channel conversion for UI
 * - IEC 61131-3 address generation
 * - Default channel mapping generation
 * - Device summary calculation
 *
 * XML parsing is handled exclusively by the main-process parser
 * in src/main/services/esi-service/esi-parser-main.ts.
 */

import type { ESIChannel, ESIDataType, ESIDevice, ESIPdo, EtherCATChannelMapping } from '@root/types/ethercat/esi-types'

/**
 * Map ESI data type to IEC 61131-3 type
 */
export function esiTypeToIecType(esiType: ESIDataType, bitLen: number): string {
  const typeMap: Record<string, string> = {
    BOOL: 'BOOL',
    SINT: 'SINT',
    INT: 'INT',
    DINT: 'DINT',
    LINT: 'LINT',
    USINT: 'USINT',
    UINT: 'UINT',
    UDINT: 'UDINT',
    ULINT: 'ULINT',
    REAL: 'REAL',
    LREAL: 'LREAL',
    STRING: 'STRING',
    BYTE: 'BYTE',
    WORD: 'WORD',
    DWORD: 'DWORD',
  }

  if (typeMap[esiType]) {
    return typeMap[esiType]
  }

  // Handle BIT types
  if (esiType.startsWith('BIT') || bitLen === 1) {
    return 'BOOL'
  }

  // Infer from bit length
  switch (bitLen) {
    case 1:
      return 'BOOL'
    case 8:
      return 'BYTE'
    case 16:
      return 'WORD'
    case 32:
      return 'DWORD'
    case 64:
      return 'LWORD'
    default:
      return 'BYTE'
  }
}

/**
 * Convert PDO entries to channels for UI
 */
export function pdoToChannels(device: ESIDevice): ESIChannel[] {
  const channels: ESIChannel[] = []
  let inputBitOffset = 0
  let outputBitOffset = 0

  // Process TxPDOs (inputs - slave to master)
  for (const pdo of device.txPdo) {
    for (const entry of pdo.entries) {
      // Skip padding entries for channel list
      if (entry.name === 'Padding' && entry.index === '0x0000') {
        inputBitOffset += entry.bitLen
        continue
      }

      channels.push({
        id: `${pdo.index}-${entry.index}-${entry.subIndex}`,
        direction: 'input',
        pdoIndex: pdo.index,
        pdoName: pdo.name,
        entryIndex: entry.index,
        entrySubIndex: entry.subIndex,
        name: entry.name,
        dataType: entry.dataType,
        bitLen: entry.bitLen,
        bitOffset: inputBitOffset,
        byteOffset: Math.floor(inputBitOffset / 8),
        iecType: esiTypeToIecType(entry.dataType, entry.bitLen),
        selected: false,
      })

      inputBitOffset += entry.bitLen
    }
  }

  // Process RxPDOs (outputs - master to slave)
  for (const pdo of device.rxPdo) {
    for (const entry of pdo.entries) {
      // Skip padding entries for channel list
      if (entry.name === 'Padding' && entry.index === '0x0000') {
        outputBitOffset += entry.bitLen
        continue
      }

      channels.push({
        id: `${pdo.index}-${entry.index}-${entry.subIndex}`,
        direction: 'output',
        pdoIndex: pdo.index,
        pdoName: pdo.name,
        entryIndex: entry.index,
        entrySubIndex: entry.subIndex,
        name: entry.name,
        dataType: entry.dataType,
        bitLen: entry.bitLen,
        bitOffset: outputBitOffset,
        byteOffset: Math.floor(outputBitOffset / 8),
        iecType: esiTypeToIecType(entry.dataType, entry.bitLen),
        selected: false,
      })

      outputBitOffset += entry.bitLen
    }
  }

  return channels
}

/**
 * Generate an IEC 61131-3 located variable address for a channel.
 * Direction: input -> %I, output -> %Q
 * Size prefix based on iecType:
 *   BOOL -> X (bit addressing): %IX<byte>.<bit>
 *   BYTE/SINT/USINT -> B: %IB<byte>
 *   WORD/INT/UINT -> W: %IW<byte>
 *   DWORD/DINT/UDINT/REAL -> D: %ID<byte>
 *   LWORD/LINT/ULINT/LREAL -> L: %IL<byte>
 *
 * When `globalBitOffset` is provided, it overrides the channel's own byte/bit offsets
 * to allow generating globally unique addresses across multiple slaves.
 */
export function generateIecLocation(channel: ESIChannel, globalBitOffset?: number): string {
  const dirPrefix = channel.direction === 'input' ? '%I' : '%Q'

  const byteOffset = globalBitOffset !== undefined ? Math.floor(globalBitOffset / 8) : channel.byteOffset
  const bitOffset = globalBitOffset !== undefined ? globalBitOffset % 8 : channel.bitOffset % 8

  const iecUpper = channel.iecType.toUpperCase()
  switch (iecUpper) {
    case 'BOOL':
      return `${dirPrefix}X${byteOffset}.${bitOffset}`
    case 'BYTE':
    case 'SINT':
    case 'USINT':
      return `${dirPrefix}B${byteOffset}`
    case 'WORD':
    case 'INT':
    case 'UINT':
      return `${dirPrefix}W${byteOffset}`
    case 'DWORD':
    case 'DINT':
    case 'UDINT':
    case 'REAL':
      return `${dirPrefix}D${byteOffset}`
    case 'LWORD':
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
      return `${dirPrefix}L${byteOffset}`
    default:
      return `${dirPrefix}B${byteOffset}`
  }
}

/**
 * Get the size in bits for a channel based on its IEC type.
 */
function getChannelBitSize(channel: ESIChannel): number {
  const iecUpper = channel.iecType.toUpperCase()
  switch (iecUpper) {
    case 'BOOL':
      return 1
    case 'BYTE':
    case 'SINT':
    case 'USINT':
      return 8
    case 'WORD':
    case 'INT':
    case 'UINT':
      return 16
    case 'DWORD':
    case 'DINT':
    case 'UDINT':
    case 'REAL':
      return 32
    case 'LWORD':
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
      return 64
    default:
      return 8
  }
}

/**
 * Generate default channel mappings with auto-generated IEC addresses for all channels.
 * When `usedAddresses` is provided, addresses are generated to avoid conflicts with
 * already-used locations from other devices (Modbus or EtherCAT).
 */
export function generateDefaultChannelMappings(
  channels: ESIChannel[],
  usedAddresses?: Set<string>,
): EtherCATChannelMapping[] {
  const used = new Set(usedAddresses)
  const inputChannels = channels.filter((c) => c.direction === 'input')
  const outputChannels = channels.filter((c) => c.direction === 'output')

  const mappings: EtherCATChannelMapping[] = []

  for (const group of [inputChannels, outputChannels]) {
    let currentBitOffset = 0

    for (const channel of group) {
      const bitSize = getChannelBitSize(channel)

      // Align to byte boundary for non-bit types
      if (bitSize > 1 && currentBitOffset % 8 !== 0) {
        currentBitOffset = Math.ceil(currentBitOffset / 8) * 8
      }

      let candidate = generateIecLocation(channel, currentBitOffset)

      // Find a non-conflicting address
      while (used.has(candidate)) {
        currentBitOffset += bitSize
        // Re-align if needed
        if (bitSize > 1 && currentBitOffset % 8 !== 0) {
          currentBitOffset = Math.ceil(currentBitOffset / 8) * 8
        }
        candidate = generateIecLocation(channel, currentBitOffset)
      }

      used.add(candidate)
      mappings.push({
        channelId: channel.id,
        iecLocation: candidate,
        userEdited: false,
        alias: '',
      })

      currentBitOffset += bitSize
    }
  }

  return mappings
}

/**
 * Calculate total PDO size in bytes
 */
export function calculatePdoSize(pdos: ESIPdo[]): number {
  let totalBits = 0
  for (const pdo of pdos) {
    for (const entry of pdo.entries) {
      totalBits += entry.bitLen
    }
  }
  return Math.ceil(totalBits / 8)
}

/**
 * Get device summary information
 */
export function getDeviceSummary(device: ESIDevice): {
  totalInputBytes: number
  totalOutputBytes: number
  inputChannelCount: number
  outputChannelCount: number
  hasCoe: boolean
} {
  const inputBytes = calculatePdoSize(device.txPdo)
  const outputBytes = calculatePdoSize(device.rxPdo)

  let inputChannels = 0
  let outputChannels = 0

  for (const pdo of device.txPdo) {
    inputChannels += pdo.entries.filter((e) => e.name !== 'Padding').length
  }

  for (const pdo of device.rxPdo) {
    outputChannels += pdo.entries.filter((e) => e.name !== 'Padding').length
  }

  return {
    totalInputBytes: inputBytes,
    totalOutputBytes: outputBytes,
    inputChannelCount: inputChannels,
    outputChannelCount: outputChannels,
    hasCoe: device.coeObjects !== undefined && device.coeObjects.length > 0,
  }
}
