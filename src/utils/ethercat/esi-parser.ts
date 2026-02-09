/**
 * EtherCAT ESI (EtherCAT Slave Information) XML Parser
 *
 * Parses ESI XML files following ETG.2000 specification and extracts
 * device information, PDO mappings, and channel configurations.
 */

import type {
  ESIChannel,
  ESIDataType,
  ESIDevice,
  ESIDeviceType,
  ESIFile,
  ESIFMMU,
  ESIGroup,
  ESIParseResult,
  ESIPdo,
  ESIPdoEntry,
  ESISyncManager,
  ESIVendor,
  EtherCATChannelMapping,
} from '@root/types/ethercat/esi-types'

/**
 * Parse hex string to number
 * Handles formats: "#x1234", "0x1234", "1234"
 */
function parseHexValue(value: string | undefined | null): string {
  if (!value) return '0x0'
  const cleaned = value.replace(/#x/gi, '0x')
  return cleaned.startsWith('0x') ? cleaned : `0x${cleaned}`
}

/**
 * Get text content from an element by tag name
 */
function getElementText(parent: Element, tagName: string): string | undefined {
  const element = parent.getElementsByTagName(tagName)[0]
  return element?.textContent?.trim() || undefined
}

/**
 * Get attribute value from an element
 */
function getAttribute(element: Element, attrName: string): string | undefined {
  return element.getAttribute(attrName) || undefined
}

/**
 * Parse Vendor information
 */
function parseVendor(vendorElement: Element): ESIVendor {
  return {
    id: parseHexValue(getElementText(vendorElement, 'Id')),
    name: getElementText(vendorElement, 'Name') || 'Unknown Vendor',
  }
}

/**
 * Parse Group information
 */
function parseGroup(groupElement: Element): ESIGroup {
  return {
    type: getElementText(groupElement, 'Type') || '',
    name: getElementText(groupElement, 'Name') || '',
    imageUrl: getElementText(groupElement, 'ImageData16x14'),
    description: getElementText(groupElement, 'Comment'),
  }
}

/**
 * Parse FMMU configuration
 */
function parseFMMU(fmmuElement: Element): ESIFMMU {
  const text = fmmuElement.textContent?.trim() || 'Outputs'
  const validTypes: ESIFMMU['type'][] = ['Outputs', 'Inputs', 'MbxState']
  return {
    type: validTypes.includes(text as ESIFMMU['type']) ? (text as ESIFMMU['type']) : 'Outputs',
  }
}

/**
 * Parse Sync Manager configuration
 */
function parseSyncManager(smElement: Element, index: number): ESISyncManager {
  const typeMap: Record<string, ESISyncManager['type']> = {
    MbxOut: 'MbxOut',
    MbxIn: 'MbxIn',
    Outputs: 'Outputs',
    Inputs: 'Inputs',
  }

  return {
    index,
    startAddress: parseHexValue(getAttribute(smElement, 'StartAddress')),
    controlByte: parseHexValue(getAttribute(smElement, 'ControlByte')),
    defaultSize: parseInt(getAttribute(smElement, 'DefaultSize') || '0', 10),
    enable: getAttribute(smElement, 'Enable') !== '0',
    type: typeMap[smElement.textContent?.trim() || 'Outputs'] || 'Outputs',
  }
}

/**
 * Parse PDO Entry
 */
function parsePdoEntry(entryElement: Element): ESIPdoEntry | null {
  const index = getElementText(entryElement, 'Index')
  const bitLen = parseInt(getElementText(entryElement, 'BitLen') || '0', 10)

  // Skip padding entries (entries without index or with 0 bitlen used for alignment)
  if (!index && bitLen > 0) {
    // This is likely a padding entry, we'll include it but mark it
    return {
      index: '0x0000',
      subIndex: '0x00',
      bitLen,
      name: 'Padding',
      dataType: 'BIT',
    }
  }

  if (!index) return null

  return {
    index: parseHexValue(index),
    subIndex: parseHexValue(getElementText(entryElement, 'SubIndex')),
    bitLen,
    name: getElementText(entryElement, 'Name') || 'Unnamed',
    dataType: getElementText(entryElement, 'DataType') || 'BYTE',
    comment: getElementText(entryElement, 'Comment'),
  }
}

/**
 * Parse PDO (RxPdo or TxPdo)
 */
function parsePdo(pdoElement: Element): ESIPdo {
  const entries: ESIPdoEntry[] = []
  const entryElements = pdoElement.getElementsByTagName('Entry')

  for (let i = 0; i < entryElements.length; i++) {
    const entry = parsePdoEntry(entryElements[i])
    if (entry) {
      entries.push(entry)
    }
  }

  return {
    index: parseHexValue(getElementText(pdoElement, 'Index')),
    name: getElementText(pdoElement, 'Name') || 'Unnamed PDO',
    fixed: getAttribute(pdoElement, 'Fixed')?.toLowerCase() === 'true',
    mandatory: getAttribute(pdoElement, 'Mandatory')?.toLowerCase() === 'true',
    smIndex: getAttribute(pdoElement, 'Sm') ? parseInt(getAttribute(pdoElement, 'Sm')!, 10) : undefined,
    entries,
  }
}

/**
 * Parse Device Type information
 */
function parseDeviceType(typeElement: Element): ESIDeviceType {
  return {
    productCode: parseHexValue(getAttribute(typeElement, 'ProductCode')),
    revisionNo: parseHexValue(getAttribute(typeElement, 'RevisionNo')),
    name: typeElement.textContent?.trim() || 'Unknown Type',
  }
}

/**
 * Parse Device
 */
function parseDevice(deviceElement: Element, groups: ESIGroup[]): ESIDevice {
  // Parse Type
  const typeElement = deviceElement.getElementsByTagName('Type')[0]
  const type = typeElement ? parseDeviceType(typeElement) : { productCode: '0x0', revisionNo: '0x0', name: 'Unknown' }

  // Get group reference
  const groupType = getElementText(deviceElement, 'GroupType')
  const group = groups.find((g) => g.type === groupType)

  // Parse FMMUs
  const fmmu: ESIFMMU[] = []
  const fmmuElements = deviceElement.getElementsByTagName('Fmmu')
  for (let i = 0; i < fmmuElements.length; i++) {
    fmmu.push(parseFMMU(fmmuElements[i]))
  }

  // Parse Sync Managers
  const syncManagers: ESISyncManager[] = []
  const smElements = deviceElement.getElementsByTagName('Sm')
  for (let i = 0; i < smElements.length; i++) {
    syncManagers.push(parseSyncManager(smElements[i], i))
  }

  // Parse RxPDOs
  const rxPdo: ESIPdo[] = []
  const rxPdoElements = deviceElement.getElementsByTagName('RxPdo')
  for (let i = 0; i < rxPdoElements.length; i++) {
    rxPdo.push(parsePdo(rxPdoElements[i]))
  }

  // Parse TxPDOs
  const txPdo: ESIPdo[] = []
  const txPdoElements = deviceElement.getElementsByTagName('TxPdo')
  for (let i = 0; i < txPdoElements.length; i++) {
    txPdo.push(parsePdo(txPdoElements[i]))
  }

  return {
    type,
    name: getElementText(deviceElement, 'Name') || 'Unknown Device',
    groupName: group?.name,
    physics: getAttribute(deviceElement, 'Physics'),
    fmmu,
    syncManagers,
    rxPdo,
    txPdo,
    description: getElementText(deviceElement, 'Comment'),
  }
}

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
 */
export function generateIecLocation(channel: ESIChannel): string {
  const dirPrefix = channel.direction === 'input' ? '%I' : '%Q'

  const iecUpper = channel.iecType.toUpperCase()
  switch (iecUpper) {
    case 'BOOL':
      return `${dirPrefix}X${channel.byteOffset}.${channel.bitOffset % 8}`
    case 'BYTE':
    case 'SINT':
    case 'USINT':
      return `${dirPrefix}B${channel.byteOffset}`
    case 'WORD':
    case 'INT':
    case 'UINT':
      return `${dirPrefix}W${channel.byteOffset}`
    case 'DWORD':
    case 'DINT':
    case 'UDINT':
    case 'REAL':
      return `${dirPrefix}D${channel.byteOffset}`
    case 'LWORD':
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
      return `${dirPrefix}L${channel.byteOffset}`
    default:
      return `${dirPrefix}B${channel.byteOffset}`
  }
}

/**
 * Generate default channel mappings with auto-generated IEC addresses for all channels.
 */
export function generateDefaultChannelMappings(channels: ESIChannel[]): EtherCATChannelMapping[] {
  return channels.map((channel) => ({
    channelId: channel.id,
    iecLocation: generateIecLocation(channel),
    userEdited: false,
  }))
}

/**
 * Parse ESI XML string
 */
export function parseESI(xmlString: string, filename?: string): ESIParseResult {
  const warnings: string[] = []

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlString, 'text/xml')

    // Check for parse errors
    const parseError = doc.getElementsByTagName('parsererror')[0]
    if (parseError) {
      return {
        success: false,
        error: `XML parse error: ${parseError.textContent}`,
      }
    }

    // Get root element
    const root = doc.getElementsByTagName('EtherCATInfo')[0]
    if (!root) {
      return {
        success: false,
        error: 'Invalid ESI file: Missing EtherCATInfo root element',
      }
    }

    // Parse Vendor
    const vendorElement = root.getElementsByTagName('Vendor')[0]
    if (!vendorElement) {
      return {
        success: false,
        error: 'Invalid ESI file: Missing Vendor information',
      }
    }
    const vendor = parseVendor(vendorElement)

    // Parse Groups
    const groups: ESIGroup[] = []
    const descriptionsElement = root.getElementsByTagName('Descriptions')[0]
    if (descriptionsElement) {
      const groupsElement = descriptionsElement.getElementsByTagName('Groups')[0]
      if (groupsElement) {
        const groupElements = groupsElement.getElementsByTagName('Group')
        for (let i = 0; i < groupElements.length; i++) {
          groups.push(parseGroup(groupElements[i]))
        }
      }
    }

    // Parse Devices
    const devices: ESIDevice[] = []
    if (descriptionsElement) {
      const devicesElement = descriptionsElement.getElementsByTagName('Devices')[0]
      if (devicesElement) {
        const deviceElements = devicesElement.getElementsByTagName('Device')
        for (let i = 0; i < deviceElements.length; i++) {
          devices.push(parseDevice(deviceElements[i], groups))
        }
      }
    }

    if (devices.length === 0) {
      warnings.push('No devices found in ESI file')
    }

    // Parse InfoData (optional metadata)
    const infoDataElement = root.getElementsByTagName('InfoData')[0]
    const infoData = infoDataElement
      ? {
          version: getElementText(infoDataElement, 'Version'),
          creationDate: getElementText(infoDataElement, 'CreationDate'),
          modificationDate: getElementText(infoDataElement, 'ModificationDate'),
          vendorUrl: getElementText(infoDataElement, 'VendorUrl'),
        }
      : undefined

    const result: ESIFile = {
      vendor,
      groups,
      devices,
      filename,
      infoData,
    }

    return {
      success: true,
      data: result,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse ESI file: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
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
