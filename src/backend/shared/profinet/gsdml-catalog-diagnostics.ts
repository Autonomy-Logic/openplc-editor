import type {
  GsdmlChannelDiagnostic,
  GsdmlLogBookEntry,
  GsdmlLogBookErrorCode2Description,
  GsdmlUnitDiagnosticType,
} from '@root/middleware/shared/ports/gsdml-types'

import type { GsdmlCatalogContext } from './gsdml-catalog-context'
import { readDataField } from './gsdml-catalog-records'
import { requireUnsigned } from './gsdml-structure'
import { childElement, childElements, type GsdmlXmlElement, listItems } from './gsdml-xml'

/**
 * Reads ChannelDiagList/ChannelDiagItem with their Name and Help texts.
 *
 * @throws {GsdmlStructureError} When a ChannelDiagItem lacks ErrorType.
 */
export function readChannelDiagnostics(
  applicationProcess: GsdmlXmlElement,
  context: GsdmlCatalogContext,
): GsdmlChannelDiagnostic[] {
  return listItems(applicationProcess, 'ChannelDiagList', 'ChannelDiagItem').map((item) => ({
    errorType: requireUnsigned(item, 'ChannelDiagItem', 'ErrorType'),
    name: context.texts.resolveChild(item, 'Name'),
    help: context.texts.resolveChild(item, 'Help'),
  }))
}

/**
 * Reads UnitDiagTypeList/UnitDiagTypeItem with their Ref fields.
 *
 * @throws {GsdmlStructureError} When an item lacks UserStructureIdentifier or a Ref lacks ByteOffset or DataType.
 */
export function readUnitDiagnosticTypes(
  applicationProcess: GsdmlXmlElement,
  context: GsdmlCatalogContext,
): GsdmlUnitDiagnosticType[] {
  return listItems(applicationProcess, 'UnitDiagTypeList', 'UnitDiagTypeItem').map((item) => ({
    userStructureIdentifier: requireUnsigned(item, 'UnitDiagTypeItem', 'UserStructureIdentifier'),
    name: context.texts.resolveChild(item, 'Name'),
    fields: childElements(item, 'Ref').map((ref) => readDataField(ref, context)),
  }))
}

/** Reads the ErrorCode2Value or ErrorCode2List of a LogBookEntryItem; an empty list when it has neither. */
function readErrorCode2(item: GsdmlXmlElement, context: GsdmlCatalogContext): GsdmlLogBookErrorCode2Description {
  const value = childElement(item, 'ErrorCode2Value')
  if (value !== undefined) {
    return {
      kind: 'value',
      name: context.texts.resolveChild(value, 'Name'),
      help: context.texts.resolveChild(value, 'Help'),
    }
  }
  return {
    kind: 'list',
    items: listItems(item, 'ErrorCode2List', 'ErrorCode2Item').map((code) => ({
      errorCode2: requireUnsigned(code, 'ErrorCode2Item', 'ErrorCode2'),
      name: context.texts.resolveChild(code, 'Name'),
      help: context.texts.resolveChild(code, 'Help'),
    })),
  }
}

/**
 * Reads LogBookEntryList/LogBookEntryItem.
 *
 * @throws {GsdmlStructureError} When an item lacks Status or an ErrorCode2Item lacks ErrorCode2.
 */
export function readLogBookEntries(
  applicationProcess: GsdmlXmlElement,
  context: GsdmlCatalogContext,
): GsdmlLogBookEntry[] {
  return listItems(applicationProcess, 'LogBookEntryList', 'LogBookEntryItem').map((item) => ({
    status: requireUnsigned(item, 'LogBookEntryItem', 'Status'),
    errorCode2: readErrorCode2(item, context),
  }))
}
