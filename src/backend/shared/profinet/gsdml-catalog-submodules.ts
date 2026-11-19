import type {
  GsdmlPluggableSubmodule,
  GsdmlSubmoduleBase,
  GsdmlSystemDefinedSubmodule,
  GsdmlVirtualSubmodule,
} from '@root/middleware/shared/ports/gsdml-types'

import {
  type GsdmlCatalogContext,
  type GsdmlTargetIds,
  isSkippedForSchemaVersion,
  readModuleInfo,
  targetIdsOf,
} from './gsdml-catalog-context'
import { readIoData } from './gsdml-catalog-io'
import { readParameterRecords } from './gsdml-catalog-records'
import { gsdmlNotice } from './gsdml-notices'
import {
  optionalUnsigned,
  requireAttribute,
  requireIdent,
  requireUnsigned,
  UNSIGNED32_HEX_DIGITS,
} from './gsdml-structure'
import { GSDML_PROTOCOL_TOKENS, GSDML_RT_CLASS_TOKENS, GSDML_SUPPORTED_SCHEMA_VERSION } from './gsdml-version'
import {
  attributeValue,
  childElement,
  childElements,
  type GsdmlXmlElement,
  listItems,
  parseTokenList,
} from './gsdml-xml'

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

/**
 * Reads a TokenList attribute of an InterfaceSubmoduleItem. In compatibility mode only the tokens in `known` are kept,
 * in document order, and every other token gets an `unknown-token` notice.
 */
function readInterfaceTokens(
  item: GsdmlXmlElement,
  itemId: string,
  attributeName: string,
  known: readonly string[],
  context: GsdmlCatalogContext,
): string[] {
  const tokens = parseTokenList(attributeValue(item, attributeName))
  if (!context.compatibilityMode) return tokens
  return tokens.filter((token) => {
    if (known.includes(token)) return true
    context.notices.add(
      gsdmlNotice(
        'unknown-token',
        `${attributeName} token "${token}" of InterfaceSubmoduleItem "${itemId}" is not known to the supported schema version ${GSDML_SUPPORTED_SCHEMA_VERSION}; it was ignored.`,
        itemId,
        token,
      ),
    )
    return false
  })
}

/** Reads the interface and port submodules of the SystemDefinedSubmoduleList of a device access point. */
export function readSystemDefinedSubmodules(
  dap: GsdmlXmlElement,
  context: GsdmlCatalogContext,
): GsdmlSystemDefinedSubmodule[] {
  const list = childElement(dap, 'SystemDefinedSubmoduleList')
  const interfaces: GsdmlSystemDefinedSubmodule[] = supportedItems(list, 'InterfaceSubmoduleItem', context).map(
    (item) => {
      const base = readSubmoduleBase(item, 'InterfaceSubmoduleItem', context)
      return {
        kind: 'interface',
        ...base,
        subslotNumber: optionalUnsigned(item, 'SubslotNumber', null),
        supportedRtClasses: readInterfaceTokens(item, base.id, 'SupportedRT_Classes', GSDML_RT_CLASS_TOKENS, context),
        supportedProtocols: readInterfaceTokens(item, base.id, 'SupportedProtocols', GSDML_PROTOCOL_TOKENS, context),
      }
    },
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

/**
 * The IDs of the entries of ApplicationProcess/SubmoduleList, split by whether the catalog holds them or skips them for
 * their schema version.
 */
export function submoduleListIds(applicationProcess: GsdmlXmlElement): GsdmlTargetIds {
  return targetIdsOf([
    ...listItems(applicationProcess, 'SubmoduleList', 'SubmoduleItem'),
    ...listItems(applicationProcess, 'SubmoduleList', 'PortSubmoduleItem'),
  ])
}
