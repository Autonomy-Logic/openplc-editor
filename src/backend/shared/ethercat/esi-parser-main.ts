/**
 * ESI XML Parser for Main Process
 *
 * Uses fast-xml-parser for high-performance parsing in the Node.js main process.
 * Provides two parsing levels:
 * - parseESILight: Extracts lightweight device summaries (fast, for repository listing)
 * - parseESIDeviceFull: Extracts complete device data on-demand (for configuration)
 */

import type {
  ESICoEObject,
  ESICoESubItem,
  ESIDevice,
  ESIDeviceSummary,
  ESIDeviceType,
  ESIFMMU,
  ESIGroup,
  ESIPdo,
  ESIPdoEntry,
  ESISyncManager,
  ESIVendor,
} from '@root/types/ethercat/esi-types'
import { XMLParser } from 'fast-xml-parser'

// ===================== SHARED HELPERS =====================

/**
 * Parse hex string to normalized 0x format
 */
function parseHexValue(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '0x0'
  const str = String(value)
  const cleaned = str.replace(/#x/gi, '0x')
  return cleaned.startsWith('0x') ? cleaned : `0x${cleaned}`
}

/**
 * Ensure a value is always an array (fast-xml-parser returns single items as objects)
 */
function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Get text value from a parsed element that may be string, number, object with #text,
 * or array of localized objects (e.g. [{#text: "Name EN", @_LcId: "1033"}, {#text: "Name DE", @_LcId: "1031"}]).
 * For arrays, prefers LcId 1033 (English) then falls back to the first element.
 */
function getTextValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    // Prefer English (LcId 1033), fall back to first element
    const english = (value as Record<string, unknown>[]).find(
      (v) => typeof v === 'object' && v !== null && '@_LcId' in v && String(v['@_LcId'] as string) === '1033',
    )
    return getTextValue(english ?? value[0])
  }
  if (typeof value === 'object' && value !== null && '#text' in value) {
    return getTextValue((value as { '#text': unknown })['#text'])
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value as string)
}

/**
 * Create a configured XMLParser instance
 */
function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: true,
    isArray: (tagName: string) => {
      // Tags that can appear multiple times and should always be arrays
      const arrayTags = ['Device', 'Group', 'RxPdo', 'TxPdo', 'Entry', 'Fmmu', 'Sm', 'Object', 'SubItem', 'DataType']
      return arrayTags.includes(tagName)
    },
  })
}

// ===================== LIGHT PARSING =====================

interface ESILightResult {
  success: boolean
  vendor?: ESIVendor
  devices?: ESIDeviceSummary[]
  warnings?: string[]
  error?: string
}

/**
 * Parse ESI XML extracting only lightweight device summaries.
 * Counts PDO entries and sums bit lengths without building full entry objects.
 */
export function parseESILight(xmlString: string, filename?: string): ESILightResult {
  const warnings: string[] = []

  try {
    const parser = createParser()
    const parsed = parser.parse(xmlString) as Record<string, unknown>

    const root = parsed['EtherCATInfo'] as Record<string, unknown> | undefined
    if (!root) {
      return { success: false, error: 'Invalid ESI file: Missing EtherCATInfo root element' }
    }

    // Parse Vendor
    const vendorObj = root['Vendor'] as Record<string, unknown> | undefined
    if (!vendorObj) {
      return { success: false, error: 'Invalid ESI file: Missing Vendor information' }
    }

    const vendor: ESIVendor = {
      id: parseHexValue(vendorObj['Id'] as string | number | undefined),
      name: getTextValue(vendorObj['Name']) || 'Unknown Vendor',
    }

    // Parse Groups
    const descriptions = root['Descriptions'] as Record<string, unknown> | undefined
    const groupsMap = new Map<string, string>()

    if (descriptions) {
      const groupsObj = descriptions['Groups'] as Record<string, unknown> | undefined
      if (groupsObj) {
        const groups = ensureArray(groupsObj['Group'] as Record<string, unknown> | Record<string, unknown>[])
        for (const group of groups) {
          const groupType = getTextValue(group['Type'])
          const groupName = getTextValue(group['Name'])
          if (groupType) {
            groupsMap.set(groupType, groupName)
          }
        }
      }
    }

    // Parse Devices (lightweight)
    const devices: ESIDeviceSummary[] = []

    if (descriptions) {
      const devicesObj = descriptions['Devices'] as Record<string, unknown> | undefined
      if (devicesObj) {
        const deviceElements = ensureArray(devicesObj['Device'] as Record<string, unknown> | Record<string, unknown>[])

        for (const deviceEl of deviceElements) {
          const summary = parseDeviceSummary(deviceEl, groupsMap)
          devices.push(summary)
        }
      }
    }

    if (devices.length === 0) {
      warnings.push(`No devices found in ESI file${filename ? ` (${filename})` : ''}`)
    }

    return {
      success: true,
      vendor,
      devices,
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
 * Extract a lightweight device summary from a parsed device element
 */
function parseDeviceSummary(deviceEl: Record<string, unknown>, groupsMap: Map<string, string>): ESIDeviceSummary {
  // Parse Type
  const typeEl = deviceEl['Type'] as Record<string, unknown> | string | undefined
  let type: ESIDeviceType
  if (typeEl && typeof typeEl === 'object') {
    type = {
      productCode: parseHexValue(typeEl['@_ProductCode'] as string | undefined),
      revisionNo: parseHexValue(typeEl['@_RevisionNo'] as string | undefined),
      name: getTextValue(typeEl['#text'] ?? typeEl['@_Name']),
    }
  } else {
    type = { productCode: '0x0', revisionNo: '0x0', name: getTextValue(typeEl) || 'Unknown' }
  }

  // Group
  const groupType = getTextValue(deviceEl['GroupType'])
  const groupName = groupsMap.get(groupType) || undefined

  // Physics
  const physics = (deviceEl['@_Physics'] as string | undefined) || undefined

  // Count PDO entries and compute bytes
  const txPdos = ensureArray(deviceEl['TxPdo'] as Record<string, unknown> | Record<string, unknown>[])
  const rxPdos = ensureArray(deviceEl['RxPdo'] as Record<string, unknown> | Record<string, unknown>[])

  const { channelCount: inputChannelCount, totalBits: inputBits } = countPdoEntries(txPdos)
  const { channelCount: outputChannelCount, totalBits: outputBits } = countPdoEntries(rxPdos)

  return {
    type,
    name: getTextValue(deviceEl['Name']) || 'Unknown Device',
    groupName,
    physics,
    inputChannelCount,
    outputChannelCount,
    totalInputBytes: Math.ceil(inputBits / 8),
    totalOutputBytes: Math.ceil(outputBits / 8),
    description: getTextValue(deviceEl['Comment']) || undefined,
  }
}

/**
 * Count non-padding entries and total bits in PDO list (without building full entry objects)
 */
function countPdoEntries(pdos: Record<string, unknown>[]): {
  channelCount: number
  totalBits: number
} {
  let channelCount = 0
  let totalBits = 0

  for (const pdo of pdos) {
    const entries = ensureArray(pdo['Entry'] as Record<string, unknown> | Record<string, unknown>[])
    for (const entry of entries) {
      const bitLen = parseInt(getTextValue(entry['BitLen']) || '0', 10) || 0
      totalBits += bitLen

      // Count non-padding entries
      const index = entry['Index']
      if (index !== undefined && index !== null) {
        const indexStr = getTextValue(index)
        if (indexStr && indexStr !== '0' && indexStr !== '#x0000' && indexStr !== '0x0000') {
          channelCount++
        }
      }
    }
  }

  return { channelCount, totalBits }
}

// ===================== FULL DEVICE PARSING =====================

interface ESIDeviceFullResult {
  success: boolean
  device?: ESIDevice
  error?: string
}

/**
 * Parse a single device from ESI XML at the given index with full detail.
 * Used on-demand when complete PDO/SM/FMMU data is needed.
 */
export function parseESIDeviceFull(xmlString: string, deviceIndex: number): ESIDeviceFullResult {
  try {
    const parser = createParser()
    const parsed = parser.parse(xmlString) as Record<string, unknown>

    const root = parsed['EtherCATInfo'] as Record<string, unknown> | undefined
    if (!root) {
      return { success: false, error: 'Invalid ESI file: Missing EtherCATInfo root element' }
    }

    const descriptions = root['Descriptions'] as Record<string, unknown> | undefined
    if (!descriptions) {
      return { success: false, error: 'No Descriptions element found' }
    }

    // Parse groups for name lookup
    const groups: ESIGroup[] = []
    const groupsObj = descriptions['Groups'] as Record<string, unknown> | undefined
    if (groupsObj) {
      const groupElements = ensureArray(groupsObj['Group'] as Record<string, unknown> | Record<string, unknown>[])
      for (const g of groupElements) {
        groups.push({
          type: getTextValue(g['Type']),
          name: getTextValue(g['Name']),
          imageUrl: getTextValue(g['ImageData16x14']) || undefined,
          description: getTextValue(g['Comment']) || undefined,
        })
      }
    }

    const devicesObj = descriptions['Devices'] as Record<string, unknown> | undefined
    if (!devicesObj) {
      return { success: false, error: 'No Devices element found' }
    }

    const deviceElements = ensureArray(devicesObj['Device'] as Record<string, unknown> | Record<string, unknown>[])

    if (deviceIndex < 0 || deviceIndex >= deviceElements.length) {
      return { success: false, error: `Device index ${deviceIndex} out of range (0-${deviceElements.length - 1})` }
    }

    const deviceEl = deviceElements[deviceIndex]
    const device = parseFullDevice(deviceEl, groups)

    return { success: true, device }
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse device: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

// ===================== COE DICTIONARY PARSING =====================

/**
 * Parsed DataType info from the Dictionary's DataTypes section.
 */
interface ParsedDataTypeInfo {
  name: string
  bitSize: number
  subItems: {
    subIdx: number
    name: string
    type: string
    bitSize: number
    bitOffset: number
    access: 'RO' | 'RW' | 'WO'
    defaultValue?: string
    pdoMapping?: boolean
  }[]
}

/**
 * Parse access string from ESI XML to normalized access type.
 */
function parseAccessRights(accessStr: string | undefined): 'RO' | 'RW' | 'WO' {
  if (!accessStr) return 'RO'
  const lower = accessStr.toLowerCase().trim()
  if (lower === 'rw' || lower === 'readwrite' || lower === 'read/write') return 'RW'
  if (lower === 'wo' || lower === 'writeonly' || lower === 'write') return 'WO'
  return 'RO'
}

/**
 * Parse the CoE Object Dictionary from a device element.
 * Navigates Device > Profile > Dictionary and extracts DataTypes and Objects.
 */
function parseCoEDictionary(deviceEl: Record<string, unknown>): ESICoEObject[] | undefined {
  // Navigate to Profile > Dictionary
  const profile = deviceEl['Profile'] as Record<string, unknown> | undefined
  if (!profile) return undefined

  const dictionary = profile['Dictionary'] as Record<string, unknown> | undefined
  if (!dictionary) return undefined

  // Step 1: Build DataType map
  const dataTypeMap = new Map<string, ParsedDataTypeInfo>()
  const dataTypesEl = dictionary['DataTypes'] as Record<string, unknown> | undefined
  if (dataTypesEl) {
    const dtElements = ensureArray(dataTypesEl['DataType'] as Record<string, unknown> | Record<string, unknown>[])
    for (const dt of dtElements) {
      const dtName = getTextValue(dt['Name'])
      if (!dtName) continue

      const dtBitSize = parseInt(getTextValue(dt['BitSize']) || '0', 10) || 0
      const subItems: ParsedDataTypeInfo['subItems'] = []

      const subItemElements = ensureArray(dt['SubItem'] as Record<string, unknown> | Record<string, unknown>[])
      for (const si of subItemElements) {
        const siSubIdx = parseInt(getTextValue(si['SubIdx']) || '0', 10)
        const siName = getTextValue(si['Name'])
        const siType = getTextValue(si['Type'])
        const siBitSize = parseInt(getTextValue(si['BitSize']) || '0', 10) || 0
        const siBitOffset = parseInt(getTextValue(si['BitOffs']) || '0', 10) || 0

        // Parse flags
        let siAccess: 'RO' | 'RW' | 'WO' = 'RO'
        let siPdoMapping: boolean | undefined
        const siFlags = si['Flags'] as Record<string, unknown> | undefined
        if (siFlags) {
          siAccess = parseAccessRights(getTextValue(siFlags['Access']))
          const pdoMappingStr = getTextValue(siFlags['PdoMapping'])
          if (pdoMappingStr) siPdoMapping = pdoMappingStr.toLowerCase() !== 'false' && pdoMappingStr !== '0'
        }

        const siDefaultValue = getTextValue(si['DefaultValue']) || undefined

        subItems.push({
          subIdx: siSubIdx,
          name: siName,
          type: siType,
          bitSize: siBitSize,
          bitOffset: siBitOffset,
          access: siAccess,
          defaultValue: siDefaultValue,
          pdoMapping: siPdoMapping,
        })
      }

      dataTypeMap.set(dtName, { name: dtName, bitSize: dtBitSize, subItems })
    }
  }

  // Step 2: Parse Objects
  const objectsEl = dictionary['Objects'] as Record<string, unknown> | undefined
  if (!objectsEl) return undefined

  const objectElements = ensureArray(objectsEl['Object'] as Record<string, unknown> | Record<string, unknown>[])
  if (objectElements.length === 0) return undefined

  const coeObjects: ESICoEObject[] = []

  for (const objEl of objectElements) {
    const indexStr = getTextValue(objEl['Index'])
    if (!indexStr) continue

    const index = parseHexValue(indexStr)
    const name = getTextValue(objEl['Name']) || 'Unnamed'
    const typeName = getTextValue(objEl['Type'])
    const bitSize = parseInt(getTextValue(objEl['BitSize']) || '0', 10) || 0

    // Parse object-level flags
    let access: 'RO' | 'RW' | 'WO' = 'RO'
    let pdoMapping = false
    let category: 'M' | 'O' | 'C' | undefined
    let pdoMappingDirection: 'R' | 'T' | 'RT' | undefined

    const flags = objEl['Flags'] as Record<string, unknown> | undefined
    if (flags) {
      access = parseAccessRights(getTextValue(flags['Access']))
      const pdoMappingStr = getTextValue(flags['PdoMapping'])
      if (pdoMappingStr) {
        const lower = pdoMappingStr.toLowerCase()
        if (lower === 'r') {
          pdoMapping = true
          pdoMappingDirection = 'R'
        } else if (lower === 't') {
          pdoMapping = true
          pdoMappingDirection = 'T'
        } else if (lower === 'rt' || lower === 'tr') {
          pdoMapping = true
          pdoMappingDirection = 'RT'
        } else if (lower !== 'false' && lower !== '0' && lower !== '') {
          pdoMapping = true
        }
      }
      const categoryStr = getTextValue(flags['Category'])
      if (categoryStr === 'M' || categoryStr === 'O' || categoryStr === 'C') {
        category = categoryStr
      }
    }

    // Parse default value from object-level Info
    let defaultValue = getTextValue(objEl['DefaultValue']) || undefined

    // Resolve DataType to build sub-items for complex objects
    const dtInfo = typeName ? dataTypeMap.get(typeName) : undefined
    let subItems: ESICoESubItem[] | undefined

    if (dtInfo && dtInfo.subItems.length > 0) {
      // Build override map from object-level Info > SubItem
      const overrideMap = new Map<string, { defaultValue?: string }>()
      const infoEl = objEl['Info'] as Record<string, unknown> | undefined
      if (infoEl) {
        const infoSubItems = ensureArray(infoEl['SubItem'] as Record<string, unknown> | Record<string, unknown>[])
        for (const isi of infoSubItems) {
          const isiName = getTextValue(isi['Name'])
          const isiInfo = isi['Info'] as Record<string, unknown> | undefined
          const isiDefaultValue = isiInfo ? getTextValue(isiInfo['DefaultValue']) || undefined : undefined
          if (isiName) {
            overrideMap.set(isiName, { defaultValue: isiDefaultValue })
          }
        }
      }

      // Merge DataType sub-items with object-level overrides
      subItems = dtInfo.subItems.map((si): ESICoESubItem => {
        const override = overrideMap.get(si.name)
        return {
          subIndex: String(si.subIdx),
          name: si.name,
          type: si.type,
          bitSize: si.bitSize,
          access: si.access,
          pdoMapping: si.pdoMapping,
          defaultValue: override?.defaultValue ?? si.defaultValue,
        }
      })
    }

    // If no sub-items were built and there's an Info > DefaultValue at object level
    if (!subItems && !defaultValue) {
      const infoEl = objEl['Info'] as Record<string, unknown> | undefined
      if (infoEl) {
        defaultValue = getTextValue(infoEl['DefaultValue']) || undefined
      }
    }

    coeObjects.push({
      index,
      name,
      type: typeName,
      bitSize,
      access,
      pdoMapping,
      category,
      pdoMappingDirection,
      defaultValue,
      subItems,
    })
  }

  return coeObjects.length > 0 ? coeObjects : undefined
}

/**
 * Parse a complete ESIDevice from a parsed device element
 */
function parseFullDevice(deviceEl: Record<string, unknown>, groups: ESIGroup[]): ESIDevice {
  // Parse Type
  const typeEl = deviceEl['Type'] as Record<string, unknown> | string | undefined
  let type: ESIDeviceType
  if (typeEl && typeof typeEl === 'object') {
    type = {
      productCode: parseHexValue(typeEl['@_ProductCode'] as string | undefined),
      revisionNo: parseHexValue(typeEl['@_RevisionNo'] as string | undefined),
      name: getTextValue(typeEl['#text'] ?? typeEl['@_Name']),
    }
  } else {
    type = { productCode: '0x0', revisionNo: '0x0', name: getTextValue(typeEl) || 'Unknown' }
  }

  // Group
  const groupType = getTextValue(deviceEl['GroupType'])
  const group = groups.find((g) => g.type === groupType)

  // Physics
  const physics = (deviceEl['@_Physics'] as string | undefined) || undefined

  // Parse FMMUs
  const fmmu: ESIFMMU[] = []
  const fmmuElements = ensureArray(
    deviceEl['Fmmu'] as (Record<string, unknown> | string) | (Record<string, unknown> | string)[],
  )
  const validFmmuTypes: ESIFMMU['type'][] = ['Outputs', 'Inputs', 'MbxState']
  for (const f of fmmuElements) {
    const fmmuText = typeof f === 'string' ? f : getTextValue(f['#text'] ?? f)
    const fmmuType = validFmmuTypes.includes(fmmuText as ESIFMMU['type']) ? (fmmuText as ESIFMMU['type']) : 'Outputs'
    fmmu.push({ type: fmmuType })
  }

  // Parse Sync Managers
  const syncManagers: ESISyncManager[] = []
  const smElements = ensureArray(deviceEl['Sm'] as Record<string, unknown> | Record<string, unknown>[])
  for (let i = 0; i < smElements.length; i++) {
    const sm = smElements[i]
    const smTypeMap: Record<string, ESISyncManager['type']> = {
      MbxOut: 'MbxOut',
      MbxIn: 'MbxIn',
      Outputs: 'Outputs',
      Inputs: 'Inputs',
    }
    const smText = getTextValue(sm['#text'] ?? sm)
    syncManagers.push({
      index: i,
      startAddress: parseHexValue(sm['@_StartAddress'] as string | undefined),
      controlByte: parseHexValue(sm['@_ControlByte'] as string | undefined),
      defaultSize: parseInt(getTextValue(sm['@_DefaultSize']) || '0', 10) || 0,
      enable: getTextValue(sm['@_Enable']) !== '0',
      type: smTypeMap[smText] || 'Outputs',
    })
  }

  // Parse RxPDOs
  const rxPdo: ESIPdo[] = []
  const rxPdoElements = ensureArray(deviceEl['RxPdo'] as Record<string, unknown> | Record<string, unknown>[])
  for (const pdoEl of rxPdoElements) {
    rxPdo.push(parseFullPdo(pdoEl))
  }

  // Parse TxPDOs
  const txPdo: ESIPdo[] = []
  const txPdoElements = ensureArray(deviceEl['TxPdo'] as Record<string, unknown> | Record<string, unknown>[])
  for (const pdoEl of txPdoElements) {
    txPdo.push(parseFullPdo(pdoEl))
  }

  // Parse CoE Object Dictionary
  const coeObjects = parseCoEDictionary(deviceEl)

  return {
    type,
    name: getTextValue(deviceEl['Name']) || 'Unknown Device',
    groupName: group?.name,
    physics,
    fmmu,
    syncManagers,
    rxPdo,
    txPdo,
    coeObjects,
    description: getTextValue(deviceEl['Comment']) || undefined,
  }
}

/**
 * Parse a full PDO with all entries
 */
function parseFullPdo(pdoEl: Record<string, unknown>): ESIPdo {
  const entries: ESIPdoEntry[] = []
  const entryElements = ensureArray(pdoEl['Entry'] as Record<string, unknown> | Record<string, unknown>[])

  for (const entryEl of entryElements) {
    const entry = parseFullPdoEntry(entryEl)
    if (entry) {
      entries.push(entry)
    }
  }

  return {
    index: parseHexValue(pdoEl['Index'] as string | undefined),
    name: getTextValue(pdoEl['Name']) || 'Unnamed PDO',
    fixed: getTextValue(pdoEl['@_Fixed']).toLowerCase() === 'true',
    mandatory: getTextValue(pdoEl['@_Mandatory']).toLowerCase() === 'true',
    smIndex: pdoEl['@_Sm'] !== undefined ? parseInt(getTextValue(pdoEl['@_Sm']) || '0', 10) : undefined,
    entries,
  }
}

/**
 * Parse a single PDO entry
 */
function parseFullPdoEntry(entryEl: Record<string, unknown>): ESIPdoEntry | null {
  const indexValue = entryEl['Index']
  const bitLen = parseInt(getTextValue(entryEl['BitLen']) || '0', 10) || 0

  const indexStr = getTextValue(indexValue)

  // Padding entry (no index but has bit length)
  if (!indexStr && bitLen > 0) {
    return {
      index: '0x0000',
      subIndex: '0x00',
      bitLen,
      name: 'Padding',
      dataType: 'BIT',
    }
  }

  if (!indexStr) return null

  return {
    index: parseHexValue(indexStr),
    subIndex: parseHexValue(getTextValue(entryEl['SubIndex'])),
    bitLen,
    name: getTextValue(entryEl['Name']) || 'Unnamed',
    dataType: getTextValue(entryEl['DataType']) || 'BYTE',
    comment: getTextValue(entryEl['Comment']) || undefined,
  }
}
