/**
 * GSDML XML parser.
 *
 * Takes the raw XML content of a GSDML device description file and
 * produces a typed, normalised in-memory catalog of DeviceAccessPointItems,
 * ModuleItems and SubmoduleItems ready for the configurator UI.
 *
 * Design notes:
 *
 * - Pure function. No I/O, no disk, no side effects. The caller loads the
 *   file; the parser only sees a string. This keeps the parser trivially
 *   testable and lets the editor backend decide the storage layer.
 *
 * - Forward-compatible per GSDML spec Annex A.3.3: unknown elements and
 *   attributes are silently ignored. We only pull the fields we explicitly
 *   understand; anything else drops through.
 *
 * - Structural validation only in this task. Full XSD validation is a
 *   follow-on; it needs the GSDML XSD files bundled with the parser.
 *   Structural checks catch the common failure modes (wrong root, missing
 *   DeviceIdentity, no DAPs) and keep the parser from building a bogus
 *   catalog from a non-GSDML document.
 *
 * - All strings resolved through ExternalText when the file carries a
 *   TextId. English text (xml:lang="en") is preferred, with fall-through
 *   to the first language present, matching how the ESI parser handles
 *   localisation.
 */

import type {
  GsdmlBitDataItem,
  GsdmlCatalog,
  GsdmlCatalogLookups,
  GsdmlDataItem,
  GsdmlDeviceAccessPoint,
  GsdmlDeviceIdentity,
  GsdmlIoData,
  GsdmlModule,
  GsdmlParameterEnumOption,
  GsdmlParameterField,
  GsdmlParameterFieldKind,
  GsdmlParameterRecord,
  GsdmlParseResult,
  GsdmlSlotEntry,
  GsdmlSubmodule,
} from '@root/middleware/shared/ports/gsdml-types'
import { XMLParser } from 'fast-xml-parser'

// ===================== LOW-LEVEL HELPERS =====================

type XmlNode = Record<string, unknown>

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function asNode(value: unknown): XmlNode | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as XmlNode) : undefined
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function asInt(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return fallback
    const n = trimmed.toLowerCase().startsWith('0x') ? parseInt(trimmed, 16) : parseInt(trimmed, 10)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    return v === 'true' || v === '1'
  }
  if (typeof value === 'number') return value !== 0
  return false
}

/**
 * Normalise a hex value from GSDML. Accepts "0x1234", "1234", "#x1234",
 * decimal strings and plain numbers. Returns a lowercase "0x..." string.
 * Empty input returns "0x0".
 */
function normaliseHex(value: unknown): string {
  if (value === undefined || value === null) return '0x0'
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `0x${Math.trunc(value).toString(16).toLowerCase()}`
  }
  if (typeof value !== 'string' && typeof value !== 'boolean') return '0x0'
  const raw = (typeof value === 'string' ? value : String(value)).trim()
  if (raw === '') return '0x0'
  const cleaned = raw.replace(/^#x/i, '0x')
  const withPrefix = cleaned.toLowerCase().startsWith('0x') ? cleaned : `0x${cleaned}`
  const digits = withPrefix.slice(2).toLowerCase()
  const normalised = digits.replace(/^0+(?=.)/, '')
  return `0x${normalised}`
}

// ===================== EXTERNAL TEXT RESOLUTION =====================

type ExternalTextMap = Map<string, string>

/**
 * Build the text id -> localised string map from ExternalTextList.
 *
 * Prefers English (xml:lang="en"), falls back to the first language block
 * when English is absent. Later entries for the same TextId within a
 * language overwrite earlier ones.
 */
function buildExternalTextMap(externalTextList: XmlNode | undefined): ExternalTextMap {
  const map: ExternalTextMap = new Map()
  if (externalTextList === undefined) return map

  const primaryEntries: Map<string, string> = new Map()
  const fallbackEntries: Map<string, string> = new Map()

  const languages = ensureArray<XmlNode>(externalTextList['PrimaryLanguage'] as XmlNode | XmlNode[] | undefined)
  for (const lang of languages) {
    const items = ensureArray<XmlNode>(lang['Text'] as XmlNode | XmlNode[] | undefined)
    for (const item of items) {
      const id = asString(item['@_TextId'])
      const value = asString(item['@_Value'])
      if (id === '') continue
      primaryEntries.set(id, value)
    }
  }

  const extraLanguages = ensureArray<XmlNode>(externalTextList['Language'] as XmlNode | XmlNode[] | undefined)
  for (const lang of extraLanguages) {
    const xmlLang = asString(lang['@_xml:lang']) || asString(lang['@_lang'])
    const items = ensureArray<XmlNode>(lang['Text'] as XmlNode | XmlNode[] | undefined)
    for (const item of items) {
      const id = asString(item['@_TextId'])
      const value = asString(item['@_Value'])
      if (id === '') continue
      if (xmlLang.toLowerCase().startsWith('en')) {
        primaryEntries.set(id, value)
      } else {
        if (!fallbackEntries.has(id)) fallbackEntries.set(id, value)
      }
    }
  }

  for (const [k, v] of fallbackEntries) {
    if (!primaryEntries.has(k)) map.set(k, v)
  }
  for (const [k, v] of primaryEntries) {
    map.set(k, v)
  }

  return map
}

function resolveText(textMap: ExternalTextMap, textId: string | undefined): string {
  if (textId === undefined || textId === '') return ''
  return textMap.get(textId) ?? ''
}

/**
 * Resolve the text referenced by an element's TextId attribute (common
 * pattern across ModuleInfo.Name, InfoText, DataItem.Text, etc).
 */
function resolveNamedText(textMap: ExternalTextMap, node: XmlNode | undefined): string {
  if (node === undefined) return ''
  const textId = asString(node['@_TextId'])
  return resolveText(textMap, textId)
}

// ===================== VALUE LIST (enum options) =====================

interface ValueListEntry {
  options: GsdmlParameterEnumOption[]
}

function buildValueListMap(parent: XmlNode | undefined, textMap: ExternalTextMap): Map<string, ValueListEntry> {
  const map = new Map<string, ValueListEntry>()
  if (parent === undefined) return map
  const valueList = asNode(parent['ValueList'])
  if (valueList === undefined) return map

  const items = ensureArray<XmlNode>(valueList['ValueItem'] as XmlNode | XmlNode[] | undefined)
  for (const item of items) {
    const id = asString(item['@_ID'])
    if (id === '') continue
    const assignments = asNode(item['Assignments'])
    const assigns = ensureArray<XmlNode>(assignments?.['Assign'] as XmlNode | XmlNode[] | undefined)
    const options: GsdmlParameterEnumOption[] = assigns.map((assign) => ({
      value: asString(assign['@_Content']),
      text: resolveText(textMap, asString(assign['@_TextId'])),
    }))
    map.set(id, { options })
  }

  return map
}

// ===================== DATA ITEMS =====================

function parseDataItems(
  parent: XmlNode | undefined,
  direction: 'input' | 'output',
  textMap: ExternalTextMap,
): GsdmlDataItem[] {
  if (parent === undefined) return []
  const items = ensureArray<XmlNode>(parent['DataItem'] as XmlNode | XmlNode[] | undefined)
  const result: GsdmlDataItem[] = []
  for (const item of items) {
    const dataType = asString(item['@_DataType'])
    const bitLength = asInt(item['@_Length'])
    const text = resolveText(textMap, asString(item['@_TextId']))
    const useAsBits = asBool(item['@_UseAsBits'])
    const bits: GsdmlBitDataItem[] = []
    if (useAsBits) {
      const bitItems = ensureArray<XmlNode>(item['BitDataItem'] as XmlNode | XmlNode[] | undefined)
      for (const bit of bitItems) {
        bits.push({
          bitOffset: asInt(bit['@_BitOffset']),
          text: resolveText(textMap, asString(bit['@_TextId'])),
        })
      }
    }
    result.push({ direction, dataType, bitLength, text, useAsBits, bits })
  }
  return result
}

function parseIoData(parent: XmlNode | undefined, textMap: ExternalTextMap): GsdmlIoData {
  const io: GsdmlIoData = { input: [], output: [] }
  if (parent === undefined) return io
  const ioData = asNode(parent['IOData'])
  if (ioData === undefined) return io
  io.input = parseDataItems(asNode(ioData['Input']), 'input', textMap)
  io.output = parseDataItems(asNode(ioData['Output']), 'output', textMap)
  return io
}

// ===================== PARAMETER RECORDS =====================

function classifyField(dataType: string, enumOptions: GsdmlParameterEnumOption[]): GsdmlParameterFieldKind {
  if (enumOptions.length > 0) return 'enum'
  const t = dataType.toLowerCase()
  if (t === 'bit') return 'bitfield'
  if (t.includes('bool')) return 'boolean'
  if (t.startsWith('float') || t.startsWith('double')) return 'float'
  if (t.includes('string') || t.includes('octet')) return 'text'
  if (t.startsWith('unsigned') || t.startsWith('integer') || t.startsWith('int')) return 'integer'
  return 'text'
}

function parseParameterField(
  refNode: XmlNode,
  valueMap: Map<string, ValueListEntry>,
  textMap: ExternalTextMap,
): GsdmlParameterField {
  const valueItemTarget = asString(refNode['@_ValueItemTarget'])
  const enumOptions = valueItemTarget !== '' ? (valueMap.get(valueItemTarget)?.options ?? []) : []
  const dataType = asString(refNode['@_DataType'])
  return {
    name: asString(refNode['@_Name']),
    text: resolveText(textMap, asString(refNode['@_TextId'])),
    byteOffset: asInt(refNode['@_ByteOffset']),
    bitOffset: asInt(refNode['@_BitOffset']),
    dataType,
    kind: classifyField(dataType, enumOptions),
    defaultValue: asString(refNode['@_DefaultValue']) || undefined,
    allowedValues: asString(refNode['@_AllowedValues']) || undefined,
    enumOptions,
  }
}

function parseParameterRecords(
  submoduleNode: XmlNode,
  valueMap: Map<string, ValueListEntry>,
  textMap: ExternalTextMap,
): GsdmlParameterRecord[] {
  const recordDataList = asNode(submoduleNode['RecordDataList'])
  if (recordDataList === undefined) return []
  const records: GsdmlParameterRecord[] = []
  const items = ensureArray<XmlNode>(recordDataList['ParameterRecordDataItem'] as XmlNode | XmlNode[] | undefined)
  for (const item of items) {
    const name = resolveNamedText(textMap, asNode(item['Name']))
    const refs = ensureArray<XmlNode>(item['Ref'] as XmlNode | XmlNode[] | undefined)
    records.push({
      index: normaliseHex(item['@_Index']),
      length: asInt(item['@_Length']),
      transferSequence: asString(item['@_TransferSequence']),
      text: name,
      fields: refs.map((ref) => parseParameterField(ref, valueMap, textMap)),
    })
  }
  return records
}

// ===================== MODULE INFO =====================

interface ModuleInfoResolved {
  name: string
  infoText: string
  orderNumber: string
  hardwareRelease: string
  softwareRelease: string
}

function parseModuleInfo(parent: XmlNode | undefined, textMap: ExternalTextMap): ModuleInfoResolved {
  const info = asNode(parent?.['ModuleInfo'])
  return {
    name: resolveNamedText(textMap, asNode(info?.['Name'])),
    infoText: resolveNamedText(textMap, asNode(info?.['InfoText'])),
    orderNumber: asString(asNode(info?.['OrderNumber'])?.['@_Value']),
    hardwareRelease: asString(asNode(info?.['HardwareRelease'])?.['@_Value']),
    softwareRelease: asString(asNode(info?.['SoftwareRelease'])?.['@_Value']),
  }
}

// ===================== SUBMODULES =====================

function parseVirtualSubmodules(
  parent: XmlNode | undefined,
  valueMap: Map<string, ValueListEntry>,
  textMap: ExternalTextMap,
): GsdmlSubmodule[] {
  const list = asNode(parent?.['VirtualSubmoduleList'])
  if (list === undefined) return []
  const items = ensureArray<XmlNode>(list['VirtualSubmoduleItem'] as XmlNode | XmlNode[] | undefined)
  const result: GsdmlSubmodule[] = []
  for (const item of items) {
    const info = parseModuleInfo(item, textMap)
    result.push({
      id: asString(item['@_ID']),
      identNumber: normaliseHex(item['@_SubmoduleIdentNumber']),
      name: info.name,
      infoText: info.infoText,
      io: parseIoData(item, textMap),
      parameterRecords: parseParameterRecords(item, valueMap, textMap),
      virtual: true,
    })
  }
  return result
}

function parseStandaloneSubmodules(
  application: XmlNode,
  valueMap: Map<string, ValueListEntry>,
  textMap: ExternalTextMap,
): GsdmlSubmodule[] {
  const list = asNode(application['SubmoduleList'])
  if (list === undefined) return []
  const items = ensureArray<XmlNode>(list['SubmoduleItem'] as XmlNode | XmlNode[] | undefined)
  const result: GsdmlSubmodule[] = []
  for (const item of items) {
    const info = parseModuleInfo(item, textMap)
    result.push({
      id: asString(item['@_ID']),
      identNumber: normaliseHex(item['@_SubmoduleIdentNumber']),
      name: info.name,
      infoText: info.infoText,
      io: parseIoData(item, textMap),
      parameterRecords: parseParameterRecords(item, valueMap, textMap),
      virtual: false,
    })
  }
  return result
}

// ===================== MODULES =====================

function parseModuleRefs(parent: XmlNode | undefined): string[] {
  const useable = asNode(parent?.['UseableModules'])
  if (useable === undefined) return []
  const refs = ensureArray<XmlNode>(useable['ModuleItemRef'] as XmlNode | XmlNode[] | undefined)
  const ids: string[] = []
  for (const ref of refs) {
    const target = asString(ref['@_ModuleItemTarget'])
    if (target !== '') ids.push(target)
  }
  return ids
}

function parseSubmoduleRefs(parent: XmlNode | undefined): string[] {
  const list = asNode(parent?.['SubmoduleList'])
  if (list === undefined) return []
  const refs = ensureArray<XmlNode>(list['SubmoduleItemRef'] as XmlNode | XmlNode[] | undefined)
  const ids: string[] = []
  for (const ref of refs) {
    const target = asString(ref['@_SubmoduleItemTarget'])
    if (target !== '') ids.push(target)
  }
  return ids
}

function parseModules(
  application: XmlNode,
  valueMap: Map<string, ValueListEntry>,
  textMap: ExternalTextMap,
): GsdmlModule[] {
  const list = asNode(application['ModuleList'])
  if (list === undefined) return []
  const items = ensureArray<XmlNode>(list['ModuleItem'] as XmlNode | XmlNode[] | undefined)
  const result: GsdmlModule[] = []
  for (const item of items) {
    const info = parseModuleInfo(item, textMap)
    result.push({
      id: asString(item['@_ID']),
      identNumber: normaliseHex(item['@_ModuleIdentNumber']),
      name: info.name,
      infoText: info.infoText,
      orderNumber: info.orderNumber,
      hardwareRelease: info.hardwareRelease,
      softwareRelease: info.softwareRelease,
      virtualSubmodules: parseVirtualSubmodules(item, valueMap, textMap),
      submoduleRefs: parseSubmoduleRefs(item),
    })
  }
  return result
}

// ===================== DAPS =====================

function parseSlotLayout(dapNode: XmlNode): GsdmlSlotEntry[] {
  const slots: GsdmlSlotEntry[] = []
  const layout = asNode(dapNode['SlotLayout'])
  if (layout !== undefined) {
    const items = ensureArray<XmlNode>(layout['Slot'] as XmlNode | XmlNode[] | undefined)
    for (const slot of items) {
      const slotNumber = asInt(slot['@_SlotNumber'])
      const fixedIdent = asString(slot['@_FixedInSubslotModuleIdentNumber']) || asString(slot['@_ModuleIdentNumber'])
      slots.push({
        slotNumber,
        fixedModule: fixedIdent !== '',
        moduleIdentNumber: fixedIdent !== '' ? normaliseHex(fixedIdent) : undefined,
      })
    }
  }
  return slots
}

function parseDaps(
  application: XmlNode,
  valueMap: Map<string, ValueListEntry>,
  textMap: ExternalTextMap,
): GsdmlDeviceAccessPoint[] {
  const list = asNode(application['DeviceAccessPointList'])
  if (list === undefined) return []
  const items = ensureArray<XmlNode>(list['DeviceAccessPointItem'] as XmlNode | XmlNode[] | undefined)
  const result: GsdmlDeviceAccessPoint[] = []
  for (const item of items) {
    const info = parseModuleInfo(item, textMap)
    result.push({
      id: asString(item['@_ID']),
      identNumber: normaliseHex(item['@_ModuleIdentNumber']),
      name: info.name,
      infoText: info.infoText,
      orderNumber: info.orderNumber,
      slots: parseSlotLayout(item),
      useableModuleIds: parseModuleRefs(item),
      virtualSubmodules: parseVirtualSubmodules(item, valueMap, textMap),
    })
  }
  return result
}

// ===================== DEVICE IDENTITY =====================

function parseDeviceIdentity(deviceIdentity: XmlNode, textMap: ExternalTextMap): GsdmlDeviceIdentity {
  const vendorName = asString(deviceIdentity['@_VendorName'])
  const infoTextNode = asNode(deviceIdentity['InfoText'])
  return {
    vendorId: normaliseHex(deviceIdentity['@_VendorID']),
    deviceId: normaliseHex(deviceIdentity['@_DeviceID']),
    vendorName: vendorName,
    infoText: resolveText(textMap, asString(infoTextNode?.['@_TextId'])),
  }
}

// ===================== SCHEMA VERSION =====================

/**
 * Pick the schema version string out of the SchemaRevisionNumber attribute
 * or the schemaLocation hint. Returns an empty string when neither is
 * present.
 */
function detectSchemaVersion(root: XmlNode): string {
  const schemaRev = asString(root['@_SchemaRevisionNumber'])
  if (schemaRev !== '') return schemaRev
  const location = asString(root['@_xsi:schemaLocation'])
  const match = location.match(/GSDML-DeviceProfile-(v[0-9.]+)\.xsd/i)
  return match !== null ? match[1] : ''
}

// ===================== PUBLIC API =====================

const PROFILE_NAMESPACE_HINT = 'profibus.com/GSDML'

function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: true,
    allowBooleanAttributes: true,
    isArray: (tagName: string) => {
      const arrayTags = [
        'DeviceAccessPointItem',
        'ModuleItem',
        'ModuleItemRef',
        'SubmoduleItem',
        'SubmoduleItemRef',
        'VirtualSubmoduleItem',
        'Slot',
        'DataItem',
        'BitDataItem',
        'ParameterRecordDataItem',
        'Ref',
        'ValueItem',
        'Assign',
        'PrimaryLanguage',
        'Language',
        'Text',
      ]
      return arrayTags.includes(tagName)
    },
  })
}

/**
 * Parse a GSDML XML document into a typed catalog.
 *
 * Returns a discriminated-union result: either the catalog or a human
 * readable error describing why the document could not be parsed.
 */
export function parseGsdml(xmlString: string): GsdmlParseResult {
  if (xmlString === '' || typeof xmlString !== 'string') {
    return { success: false, error: 'GSDML input is empty.' }
  }

  let parsed: XmlNode
  try {
    const parser = createParser()
    parsed = parser.parse(xmlString) as XmlNode
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: `GSDML XML is malformed: ${message}` }
  }

  const root = asNode(parsed['ISO15745Profile'])
  if (root === undefined) {
    return { success: false, error: 'GSDML root element ISO15745Profile is missing.' }
  }

  const schemaLocation = asString(root['@_xsi:schemaLocation']) + asString(root['@_xmlns'])
  if (!schemaLocation.includes(PROFILE_NAMESPACE_HINT) && !schemaLocation.includes('GSDML')) {
    return { success: false, error: 'Document does not look like a GSDML profile (namespace hint missing).' }
  }

  const body = asNode(root['ProfileBody'])
  if (body === undefined) {
    return { success: false, error: 'GSDML ProfileBody is missing.' }
  }

  const deviceIdentity = asNode(body['DeviceIdentity'])
  if (deviceIdentity === undefined) {
    return { success: false, error: 'GSDML DeviceIdentity is missing.' }
  }

  const applicationProcess = asNode(body['ApplicationProcess'])
  if (applicationProcess === undefined) {
    return { success: false, error: 'GSDML ApplicationProcess is missing.' }
  }

  const externalTextList = asNode(applicationProcess['ExternalTextList'])
  const textMap = buildExternalTextMap(externalTextList)
  const identity = parseDeviceIdentity(deviceIdentity, textMap)
  const valueMap = buildValueListMap(applicationProcess, textMap)

  const deviceAccessPoints = parseDaps(applicationProcess, valueMap, textMap)
  const modules = parseModules(applicationProcess, valueMap, textMap)
  const submodules = parseStandaloneSubmodules(applicationProcess, valueMap, textMap)

  const warnings: string[] = []
  if (deviceAccessPoints.length === 0) {
    warnings.push('GSDML has no DeviceAccessPointItem; the catalog cannot be used to configure a device.')
  }

  const catalog: GsdmlCatalog = {
    identity,
    deviceAccessPoints,
    modules,
    submodules,
    warnings,
    schemaVersion: detectSchemaVersion(root),
  }

  return { success: true, catalog }
}

/**
 * Build fast-access lookups over a parsed catalog. Not persisted; cheap to
 * rebuild on each catalog load.
 */
export function buildGsdmlCatalogLookups(catalog: GsdmlCatalog): GsdmlCatalogLookups {
  const dapById = new Map<string, GsdmlDeviceAccessPoint>()
  const moduleById = new Map<string, GsdmlModule>()
  const moduleByIdent = new Map<string, GsdmlModule>()
  const submoduleById = new Map<string, GsdmlSubmodule>()
  const submoduleByIdent = new Map<string, GsdmlSubmodule>()

  for (const dap of catalog.deviceAccessPoints) {
    if (dap.id !== '') dapById.set(dap.id, dap)
  }
  for (const mod of catalog.modules) {
    if (mod.id !== '') moduleById.set(mod.id, mod)
    if (mod.identNumber !== '0x0') moduleByIdent.set(mod.identNumber.toLowerCase(), mod)
  }
  for (const sub of catalog.submodules) {
    if (sub.id !== '') submoduleById.set(sub.id, sub)
    if (sub.identNumber !== '0x0') submoduleByIdent.set(sub.identNumber.toLowerCase(), sub)
  }

  return { dapById, moduleById, moduleByIdent, submoduleById, submoduleByIdent }
}
