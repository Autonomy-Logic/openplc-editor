import type {
  GsdmlPluggableSubmodule,
  GsdmlSubmoduleBase,
  GsdmlSystemDefinedSubmodule,
  GsdmlVirtualSubmodule,
} from '@root/middleware/shared/ports/gsdml-types'

import { type GsdmlCatalogContext, isSkippedForSchemaVersion, readModuleInfo } from './gsdml-catalog-context'
import { readIoData } from './gsdml-catalog-io'
import { readParameterRecords } from './gsdml-catalog-records'
import { optionalUnsigned, requireAttribute, requireIdent, requireUnsigned } from './gsdml-structure'
import { attributeValue, childElement, childElements, type GsdmlXmlElement, parseTokenList } from './gsdml-xml'

const UNSIGNED32_HEX_DIGITS = 8

/**
 * Reads the fields every submodule kind shares.
 *
 * @throws {GsdmlStructureError} When the submodule or one of its children lacks a required attribute.
 */
function readSubmoduleBase(
  element: GsdmlXmlElement,
  elementName: string,
  context: GsdmlCatalogContext,
): GsdmlSubmoduleBase {
  const id = requireAttribute(element, elementName, 'ID')
  const identNumber = requireIdent(element, elementName, 'SubmoduleIdentNumber', UNSIGNED32_HEX_DIGITS)
  const info = readModuleInfo(element, context)
  return {
    id,
    identNumber,
    name: info.name,
    infoText: info.infoText,
    io: readIoData(element, context),
    parameterRecords: readParameterRecords(element, id, context),
    requiredSchemaVersion: attributeValue(element, 'RequiredSchemaVersion') ?? null,
  }
}

/** The elements of a list that the supported schema version covers; newer ones get an `object-skipped` notice. */
function supportedItems(
  list: GsdmlXmlElement | undefined,
  elementName: string,
  context: GsdmlCatalogContext,
): GsdmlXmlElement[] {
  if (list === undefined) return []
  return childElements(list, elementName).filter((item) => !isSkippedForSchemaVersion(item, elementName, context))
}

/** Reads VirtualSubmoduleList/VirtualSubmoduleItem of a device access point or module. */
export function readVirtualSubmodules(parent: GsdmlXmlElement, context: GsdmlCatalogContext): GsdmlVirtualSubmodule[] {
  return supportedItems(childElement(parent, 'VirtualSubmoduleList'), 'VirtualSubmoduleItem', context).map((item) => ({
    kind: 'virtual',
    ...readSubmoduleBase(item, 'VirtualSubmoduleItem', context),
  }))
}

/** Reads the interface and port submodules of the SystemDefinedSubmoduleList of a device access point. */
export function readSystemDefinedSubmodules(
  dap: GsdmlXmlElement,
  context: GsdmlCatalogContext,
): GsdmlSystemDefinedSubmodule[] {
  const list = childElement(dap, 'SystemDefinedSubmoduleList')
  const interfaces: GsdmlSystemDefinedSubmodule[] = supportedItems(list, 'InterfaceSubmoduleItem', context).map(
    (item) => ({
      kind: 'interface',
      ...readSubmoduleBase(item, 'InterfaceSubmoduleItem', context),
      subslotNumber: optionalUnsigned(item, 'SubslotNumber', null),
      supportedRtClasses: parseTokenList(attributeValue(item, 'SupportedRT_Classes')),
      supportedProtocols: parseTokenList(attributeValue(item, 'SupportedProtocols')),
    }),
  )
  const ports: GsdmlSystemDefinedSubmodule[] = supportedItems(list, 'PortSubmoduleItem', context).map((item) => ({
    kind: 'port',
    ...readSubmoduleBase(item, 'PortSubmoduleItem', context),
    subslotNumber: requireUnsigned(item, 'PortSubmoduleItem', 'SubslotNumber'),
  }))
  return [...interfaces, ...ports]
}

/** Reads ApplicationProcess/SubmoduleList: its SubmoduleItem entries, then its PortSubmoduleItem entries. */
export function readPluggableSubmodules(
  applicationProcess: GsdmlXmlElement,
  context: GsdmlCatalogContext,
): GsdmlPluggableSubmodule[] {
  const list = childElement(applicationProcess, 'SubmoduleList')
  const submodules: GsdmlPluggableSubmodule[] = supportedItems(list, 'SubmoduleItem', context).map((item) => ({
    kind: 'submodule',
    ...readSubmoduleBase(item, 'SubmoduleItem', context),
  }))
  const ports: GsdmlPluggableSubmodule[] = supportedItems(list, 'PortSubmoduleItem', context).map((item) => ({
    kind: 'port',
    ...readSubmoduleBase(item, 'PortSubmoduleItem', context),
    subslotNumber: optionalUnsigned(item, 'SubslotNumber', null),
  }))
  return [...submodules, ...ports]
}

/** The IDs of every entry of ApplicationProcess/SubmoduleList, whatever its schema version. */
export function submoduleListIds(applicationProcess: GsdmlXmlElement): Set<string> {
  const list = childElement(applicationProcess, 'SubmoduleList')
  const ids = new Set<string>()
  if (list === undefined) return ids
  for (const name of ['SubmoduleItem', 'PortSubmoduleItem']) {
    for (const item of childElements(list, name)) {
      const id = attributeValue(item, 'ID')
      if (id !== undefined) ids.add(id)
    }
  }
  return ids
}
