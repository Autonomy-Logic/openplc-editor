import { errorMessage } from '@root/backend/shared/device-description/error-message'
import type { GsdmlRepositorySummary } from '@root/middleware/shared/ports/gsdml-repository-mechanisms'
import type { GsdmlCatalog, GsdmlDeviceIdentity, GsdmlParseResult } from '@root/middleware/shared/ports/gsdml-types'

import { type GsdmlCatalogContext, GsdmlValueList } from './gsdml-catalog-context'
import { readChannelDiagnostics, readLogBookEntries, readUnitDiagnosticTypes } from './gsdml-catalog-diagnostics'
import { moduleListIds, readDeviceAccessPoints, readModules } from './gsdml-catalog-modules'
import { readPluggableSubmodules, submoduleListIds } from './gsdml-catalog-submodules'
import { gsdmlNotice, GsdmlNoticeLog } from './gsdml-notices'
import { containsDoctype, GsdmlStructureError, requireIdent, UNSIGNED16_HEX_DIGITS } from './gsdml-structure'
import { GsdmlTextResolver, readExternalTexts } from './gsdml-text'
import { GSDML_SUPPORTED_SCHEMA_VERSION, isNewerSchemaVersion, schemaVersionFromLocation } from './gsdml-version'
import {
  attributeNames,
  attributeValue,
  childElement,
  childElementNames,
  childElements,
  type GsdmlXmlElement,
  readGsdmlXml,
} from './gsdml-xml'

const ROOT_ELEMENT = 'ISO15745Profile'
const GSDML_NAMESPACE_MARKER = 'profibus.com/gsdml'
const BYTE_ORDER_MARK = '\uFEFF'

/** The root element and the values of its namespace and schema location attributes. */
interface GsdmlRoot {
  readonly element: GsdmlXmlElement
  readonly hasGsdmlNamespace: boolean
  readonly schemaLocation: string
}

/**
 * Finds the single ISO15745Profile root and reads its namespace and schema location attributes.
 *
 * @throws {GsdmlStructureError} When the root is not one ISO15745Profile.
 */
function readRoot(document: GsdmlXmlElement): GsdmlRoot {
  const names = childElementNames(document)
  const roots = childElements(document, ROOT_ELEMENT)
  if (roots.length === 0) {
    const found = names.length === 0 ? 'no element' : names.join(', ')
    throw new GsdmlStructureError(`GSDML root element must be ${ROOT_ELEMENT}; the document has ${found}.`)
  }
  if (names.length > 1 || roots.length > 1) {
    throw new GsdmlStructureError('GSDML XML is malformed: the document has more than one root element.')
  }
  const element = roots[0]
  let hasGsdmlNamespace = false
  let schemaLocation = ''
  for (const name of attributeNames(element)) {
    const value = attributeValue(element, name) ?? ''
    if ((name === 'xmlns' || name.startsWith('xmlns:')) && value.toLowerCase().includes(GSDML_NAMESPACE_MARKER)) {
      hasGsdmlNamespace = true
    }
    if (name === 'schemaLocation' || name.endsWith(':schemaLocation')) schemaLocation = value
  }
  return { element, hasGsdmlNamespace, schemaLocation }
}

/**
 * Returns the named child of an element.
 *
 * @throws {GsdmlStructureError} When the element has no such child.
 */
function requireChild(parent: GsdmlXmlElement, parentName: string, childName: string): GsdmlXmlElement {
  const child = childElement(parent, childName)
  if (child === undefined) throw new GsdmlStructureError(`GSDML ${parentName} has no ${childName} element.`)
  return child
}

/** Reads DeviceIdentity: ident numbers, the VendorName child and the InfoText. */
function readIdentity(deviceIdentity: GsdmlXmlElement, texts: GsdmlTextResolver): GsdmlDeviceIdentity {
  const vendorId = requireIdent(deviceIdentity, 'DeviceIdentity', 'VendorID', UNSIGNED16_HEX_DIGITS)
  const deviceId = requireIdent(deviceIdentity, 'DeviceIdentity', 'DeviceID', UNSIGNED16_HEX_DIGITS)
  const vendorName = childElement(deviceIdentity, 'VendorName')
  return {
    vendorId,
    deviceId,
    vendorName: vendorName === undefined ? '' : (attributeValue(vendorName, 'Value') ?? ''),
    infoText: texts.resolveChild(deviceIdentity, 'InfoText'),
  }
}

/**
 * Builds the catalog of a parsed document.
 *
 * @throws {GsdmlStructureError} On any structural failure.
 */
function buildCatalog(document: GsdmlXmlElement): GsdmlCatalog {
  const root = readRoot(document)
  if (!root.hasGsdmlNamespace && !root.schemaLocation.toUpperCase().includes('GSDML')) {
    throw new GsdmlStructureError(
      `GSDML ${ROOT_ELEMENT} has neither the GSDML namespace (xmlns) nor a GSDML xsi:schemaLocation hint.`,
    )
  }
  const notices = new GsdmlNoticeLog()
  const schemaVersion = schemaVersionFromLocation(root.schemaLocation)
  if (schemaVersion !== '' && isNewerSchemaVersion(schemaVersion)) {
    notices.add(
      gsdmlNotice(
        'newer-schema-version',
        `The file uses schema version ${schemaVersion}, newer than the supported ${GSDML_SUPPORTED_SCHEMA_VERSION}; elements and attributes the parser does not know are ignored.`,
        undefined,
        schemaVersion,
      ),
    )
  }
  const profileBody = requireChild(root.element, ROOT_ELEMENT, 'ProfileBody')
  const deviceIdentity = requireChild(profileBody, 'ProfileBody', 'DeviceIdentity')
  const applicationProcess = requireChild(profileBody, 'ProfileBody', 'ApplicationProcess')

  const texts = new GsdmlTextResolver(readExternalTexts(applicationProcess), notices)
  const identity = readIdentity(deviceIdentity, texts)
  const context: GsdmlCatalogContext = {
    texts,
    notices,
    valueList: GsdmlValueList.read(applicationProcess),
    moduleIds: moduleListIds(applicationProcess),
    submoduleIds: submoduleListIds(applicationProcess),
  }
  const deviceAccessPoints = readDeviceAccessPoints(applicationProcess, context)
  const modules = readModules(applicationProcess, context)
  const submodules = readPluggableSubmodules(applicationProcess, context)
  const channelDiagnostics = readChannelDiagnostics(applicationProcess, context)
  const unitDiagnosticTypes = readUnitDiagnosticTypes(applicationProcess, context)
  const logBookEntries = readLogBookEntries(applicationProcess, context)
  if (deviceAccessPoints.length === 0) {
    notices.add(
      gsdmlNotice(
        'no-device-access-point',
        'The file has no DeviceAccessPointItem the supported schema version covers; no device can be configured from it.',
      ),
    )
  }
  return {
    schemaVersion,
    identity,
    deviceAccessPoints,
    modules,
    submodules,
    channelDiagnostics,
    unitDiagnosticTypes,
    logBookEntries,
    notices: notices.toArray(),
  }
}

/** Whether the input is a string with content. */
function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * Parses GSDML text into its catalog. Never throws: every failure is returned as an error.
 *
 * A DOCTYPE in any letter case rejects the text before the XML library runs. Only structural failures reject a file:
 * XML that is not well-formed, a wrong root, a missing GSDML namespace and schema location, a missing ProfileBody,
 * DeviceIdentity or ApplicationProcess, or a required attribute missing or not of its type. Unknown elements and
 * attributes are ignored, and objects newer than {@link GSDML_SUPPORTED_SCHEMA_VERSION} are left out with a notice.
 *
 * @param xml - The text of a GSDML file; a leading byte order mark is accepted.
 * @returns The catalog, or the reason the file was rejected.
 */
export function parseGsdml(xml: string): GsdmlParseResult {
  if (!isNonEmptyText(xml)) return { success: false, error: 'GSDML input is empty.' }
  const text = xml.startsWith(BYTE_ORDER_MARK) ? xml.slice(BYTE_ORDER_MARK.length) : xml
  if (text === '') return { success: false, error: 'GSDML input is empty.' }
  if (containsDoctype(text)) {
    return { success: false, error: 'GSDML must not contain a DOCTYPE declaration; the file was not parsed.' }
  }
  const read = readGsdmlXml(text)
  if (!read.ok) return { success: false, error: `GSDML XML is malformed: ${read.reason}` }
  try {
    return { success: true, catalog: buildCatalog(read.document) }
  } catch (error: unknown) {
    if (error instanceof GsdmlStructureError) return { success: false, error: error.message }
    return { success: false, error: `GSDML could not be read: ${errorMessage(error, 'unknown error')}` }
  }
}

/**
 * The repository summary of a parsed catalog.
 *
 * @param catalog - A catalog returned by {@link parseGsdml}.
 * @returns Its identity, schema version and the counts of its device access points, modules, submodules and notices.
 */
export function summarizeGsdmlCatalog(catalog: GsdmlCatalog): GsdmlRepositorySummary {
  return {
    vendorId: catalog.identity.vendorId,
    deviceId: catalog.identity.deviceId,
    vendorName: catalog.identity.vendorName,
    deviceInfoText: catalog.identity.infoText,
    schemaVersion: catalog.schemaVersion,
    deviceAccessPointCount: catalog.deviceAccessPoints.length,
    moduleCount: catalog.modules.length,
    submoduleCount: catalog.submodules.length,
    noticeCount: catalog.notices.length,
  }
}
