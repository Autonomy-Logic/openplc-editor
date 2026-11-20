import type { GsdmlDataItem, GsdmlIoData } from '@root/middleware/shared/ports/gsdml-types'

import type { GsdmlCatalogContext } from './gsdml-catalog-context'
import { gsdmlNotice } from './gsdml-notices'
import { optionalUnsigned, requireAttribute, requireUnsigned } from './gsdml-structure'
import { attributeValue, childElement, childElements, type GsdmlXmlElement, parseBooleanValue } from './gsdml-xml'

const FIXED_BIT_LENGTHS: ReadonlyMap<string, number> = new Map([
  ['Bit', 1],
  ['Integer8', 8],
  ['Unsigned8', 8],
  ['Integer16', 16],
  ['Unsigned16', 16],
  ['Integer32', 32],
  ['Unsigned32', 32],
  ['Float32', 32],
  ['Integer64', 64],
  ['Unsigned64', 64],
  ['Float64', 64],
  ['Unsigned8+Unsigned8', 16],
  ['Float32+Unsigned8', 40],
  ['F_MessageTrailer4Byte', 32],
  ['F_MessageTrailer5Byte', 40],
])

const OCTET_LENGTH_TYPES: ReadonlySet<string> = new Set(['VisibleString', 'OctetString'])

/**
 * The bit length of a typed element: fixed for sized types, `BitLength` for BitArea (default 1) and `Length` octets
 * for VisibleString and OctetString. Any other type gives null and an `unknown-data-type` notice.
 *
 * @param lengthRequired - Whether `Length` is required for the octet-length types, as it is on DataItem.
 * @throws {GsdmlStructureError} When a required `Length` is missing or not an unsigned integer.
 */
export function dataTypeBitLength(
  element: GsdmlXmlElement,
  elementName: string,
  dataType: string,
  lengthRequired: boolean,
  context: GsdmlCatalogContext,
): number | null {
  const fixed = FIXED_BIT_LENGTHS.get(dataType)
  if (fixed !== undefined) return fixed
  if (dataType === 'BitArea') return optionalUnsigned(element, 'BitLength', 1)
  if (OCTET_LENGTH_TYPES.has(dataType)) {
    const octets = lengthRequired
      ? requireUnsigned(element, elementName, 'Length')
      : optionalUnsigned(element, 'Length', null)
    return octets === null ? null : octets * 8
  }
  context.notices.add(
    gsdmlNotice('unknown-data-type', `Data type "${dataType}" has no known size.`, undefined, dataType),
  )
  return null
}

/** Reads one DataItem with its BitDataItem children. */
function readDataItem(item: GsdmlXmlElement, context: GsdmlCatalogContext): GsdmlDataItem {
  const dataType = requireAttribute(item, 'DataItem', 'DataType')
  const bitLength = dataTypeBitLength(item, 'DataItem', dataType, true, context)
  const textId = attributeValue(item, 'TextId') ?? ''
  return {
    id: attributeValue(item, 'ID') ?? null,
    dataType,
    bitLength,
    textId,
    text: context.texts.resolve(textId),
    useAsBits: parseBooleanValue(attributeValue(item, 'UseAsBits'), false),
    bits: childElements(item, 'BitDataItem').map((bit) => ({
      bitOffset: requireUnsigned(bit, 'BitDataItem', 'BitOffset'),
      text: context.texts.resolveTextIdOf(bit),
    })),
  }
}

/** The sum of the item lengths; null when one of them is unknown. */
function totalBitLength(items: readonly GsdmlDataItem[]): number | null {
  let total = 0
  for (const item of items) {
    if (item.bitLength === null) return null
    total += item.bitLength
  }
  return total
}

/** Reads the DataItems of one direction of IOData. */
function readDirection(
  ioData: GsdmlXmlElement | undefined,
  direction: string,
  context: GsdmlCatalogContext,
): GsdmlDataItem[] {
  const area = ioData === undefined ? undefined : childElement(ioData, direction)
  return area === undefined ? [] : childElements(area, 'DataItem').map((item) => readDataItem(item, context))
}

/**
 * Reads the IOData of a submodule; empty when it has none.
 *
 * @throws {GsdmlStructureError} When a DataItem or BitDataItem lacks a required attribute.
 */
export function readIoData(submodule: GsdmlXmlElement, context: GsdmlCatalogContext): GsdmlIoData {
  const ioData = childElement(submodule, 'IOData')
  const input = readDirection(ioData, 'Input', context)
  const output = readDirection(ioData, 'Output', context)
  return { input, output, inputBitLength: totalBitLength(input), outputBitLength: totalBitLength(output) }
}
