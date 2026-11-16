import type {
  GsdmlAllowedValueRange,
  GsdmlDataField,
  GsdmlParameterEnumOption,
  GsdmlParameterField,
  GsdmlParameterFieldKind,
  GsdmlParameterRecord,
} from '@root/middleware/shared/ports/gsdml-types'

import { type GsdmlCatalogContext, noteDanglingReference } from './gsdml-catalog-context'
import { dataTypeBitLength } from './gsdml-catalog-io'
import { optionalUnsigned, requireAttribute, requireOctets, requireUnsigned } from './gsdml-structure'
import { attributeValue, childElements, type GsdmlXmlElement, listItems, parseBooleanValue } from './gsdml-xml'

const FIELD_KINDS: ReadonlyMap<string, GsdmlParameterFieldKind> = new Map([
  ['Bit', 'bit'],
  ['BitArea', 'bitArea'],
  ['Integer8', 'integer'],
  ['Integer16', 'integer'],
  ['Integer32', 'integer'],
  ['Integer64', 'integer'],
  ['Unsigned8', 'unsigned'],
  ['Unsigned16', 'unsigned'],
  ['Unsigned32', 'unsigned'],
  ['Unsigned64', 'unsigned'],
  ['Float32', 'float'],
  ['Float64', 'float'],
  ['VisibleString', 'string'],
  ['OctetString', 'octets'],
])

/**
 * Reads a Ref element as a data field: identity from ID and TextId, offsets in decimal, size from its data type.
 *
 * @throws {GsdmlStructureError} When the Ref lacks DataType or ByteOffset.
 */
export function readDataField(ref: GsdmlXmlElement, context: GsdmlCatalogContext): GsdmlDataField {
  const dataType = requireAttribute(ref, 'Ref', 'DataType')
  const byteOffset = requireUnsigned(ref, 'Ref', 'ByteOffset')
  const textId = attributeValue(ref, 'TextId') ?? ''
  return {
    id: attributeValue(ref, 'ID') ?? null,
    textId,
    text: context.texts.resolve(textId),
    byteOffset,
    bitOffset: optionalUnsigned(ref, 'BitOffset', 0),
    bitLength: dataTypeBitLength(ref, 'Ref', dataType, false, context),
    dataType,
  }
}

/** Splits AllowedValues into lexical ranges as written, `a..b` or single values; null when the attribute is absent. */
function parseAllowedValues(raw: string | undefined): GsdmlAllowedValueRange[] | null {
  if (raw === undefined) return null
  return raw
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '')
    .map((token) => {
      const separator = token.indexOf('..')
      return separator === -1
        ? { min: token, max: token }
        : { min: token.slice(0, separator), max: token.slice(separator + 2) }
    })
}

/** The enum options a Ref names through ValueItemTarget; empty with a `dangling-reference` notice when none has that ID. */
function readEnumOptions(
  ref: GsdmlXmlElement,
  ownerId: string,
  context: GsdmlCatalogContext,
): readonly GsdmlParameterEnumOption[] {
  const target = attributeValue(ref, 'ValueItemTarget')
  if (target === undefined) return []
  if (!context.valueList.has(target)) {
    noteDanglingReference(context, 'ValueItemTarget', target, 'ValueItem', ownerId)
    return []
  }
  return context.valueList.options(target, context.texts)
}

/** Reads a Ref of a ParameterRecordDataItem as a parameter field. */
function readParameterField(ref: GsdmlXmlElement, ownerId: string, context: GsdmlCatalogContext): GsdmlParameterField {
  const field = readDataField(ref, context)
  const defaultValue = requireAttribute(ref, 'Ref', 'DefaultValue')
  const enumOptions = readEnumOptions(ref, ownerId, context)
  return {
    ...field,
    kind: enumOptions.length > 0 ? 'enum' : (FIELD_KINDS.get(field.dataType) ?? 'other'),
    defaultValue,
    allowedValues: parseAllowedValues(attributeValue(ref, 'AllowedValues')),
    enumOptions,
    changeable: parseBooleanValue(attributeValue(ref, 'Changeable'), true),
    visible: parseBooleanValue(attributeValue(ref, 'Visible'), true),
  }
}

/** Reads one ParameterRecordDataItem with its Const and Ref children. */
function readParameterRecord(
  item: GsdmlXmlElement,
  ownerId: string,
  context: GsdmlCatalogContext,
): GsdmlParameterRecord {
  const index = requireUnsigned(item, 'ParameterRecordDataItem', 'Index')
  const length = requireUnsigned(item, 'ParameterRecordDataItem', 'Length')
  return {
    index,
    length,
    transferSequence: optionalUnsigned(item, 'TransferSequence', null),
    name: context.texts.resolveChild(item, 'Name'),
    constants: childElements(item, 'Const').map((constant) => ({
      byteOffset: optionalUnsigned(constant, 'ByteOffset', 0),
      data: requireOctets(constant, 'Const', 'Data'),
    })),
    fields: childElements(item, 'Ref').map((ref) => readParameterField(ref, ownerId, context)),
  }
}

/**
 * Reads RecordDataList/ParameterRecordDataItem of a submodule.
 *
 * @param ownerId - The ID of the submodule, named by its notices.
 * @throws {GsdmlStructureError} When a record, Const or Ref lacks a required attribute.
 */
export function readParameterRecords(
  submodule: GsdmlXmlElement,
  ownerId: string,
  context: GsdmlCatalogContext,
): GsdmlParameterRecord[] {
  return listItems(submodule, 'RecordDataList', 'ParameterRecordDataItem').map((item) =>
    readParameterRecord(item, ownerId, context),
  )
}
