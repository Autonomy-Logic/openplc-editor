import type { PLCVariableType } from '../../../../middleware/shared/ports/types'
import { lookupBaseTypeByXmlElement, parseStringLength } from '../../iec-types-registry'
import { canonicalGenericType } from '../generic-types'
import { asArray, asRecord, asString } from './xml-node'

type LeafBaseType = { definition: 'base-type' | 'user-data-type'; value: string }

// Reverse of `convertTypeToXml` (xml-generator/old-editor/type-xml.ts): a
// PLCopen `<type>`/`<baseType>` element has exactly one child key, which is
// either a recognised IEC base-type tag, `derived` (user type/FB reference),
// or `array` (nested dimensions + element base type).
/**
 * Fold a TC6 `length` attribute into the type name, so `<string length="23"/>`
 * becomes `STRING(23)`.
 *
 * A length this implementation cannot carry degrades to the unqualified type
 * rather than failing the load.
 */
function withDeclaredLength(name: string, elementXml: unknown): string {
  const raw = asRecord(elementXml)['@length']
  if (raw === undefined) return name
  const candidate = `${name}(${asString(raw).trim()})`
  // Both halves matter: `parseStringLength` reports `valid: true` with no
  // `length` for an unqualified name, so checking `valid` alone would admit
  // `<string length="lots"/>` as a type named "STRING(lots)".
  const { length, valid } = parseStringLength(candidate)
  return length !== undefined && valid ? candidate : name
}

function parseBaseTypeLeaf(baseTypeXml: unknown): LeafBaseType {
  const rec = asRecord(baseTypeXml)
  if ('derived' in rec) {
    return { definition: 'user-data-type', value: asString(asRecord(rec.derived)['@name']) }
  }
  const tag = Object.keys(rec)[0]
  if (tag === undefined) throw new Error('Type element has no recognizable base type')
  const generic = canonicalGenericType(tag)
  if (generic) return { definition: 'user-data-type', value: generic }
  const name = lookupBaseTypeByXmlElement(tag)?.name ?? tag
  return { definition: 'base-type', value: withDeclaredLength(name, rec[tag]) }
}

function parseDimensionsXml(dimensionXml: unknown): Array<{ dimension: string }> {
  return asArray(dimensionXml).map((d) => {
    const dim = asRecord(d)
    return { dimension: `${asString(dim['@lower'])}..${asString(dim['@upper'])}` }
  })
}

export function parseTypeXml(typeXml: unknown): PLCVariableType {
  const type = asRecord(typeXml)

  if ('array' in type) {
    const arrayXml = asRecord(type.array)
    const baseType = parseBaseTypeLeaf(arrayXml.baseType)
    const dimensions = parseDimensionsXml(arrayXml.dimension)
    const value = `ARRAY[${dimensions.map((d) => d.dimension).join(',')}] OF ${baseType.value}`
    return { definition: 'array', value, data: { baseType, dimensions } }
  }

  if ('derived' in type) {
    return { definition: 'derived', value: asString(asRecord(type.derived)['@name']) }
  }

  const tag = Object.keys(type)[0]
  if (tag === undefined) throw new Error('Variable type element is empty')
  // A generic is an elementaryTypes element in the schema, but not a base type
  // here — `base-type` values are validated against the elementary registry,
  // which a generic is deliberately absent from. See `generic-types.ts`.
  const generic = canonicalGenericType(tag)
  if (generic) return { definition: 'user-data-type', value: generic }
  const name = lookupBaseTypeByXmlElement(tag)?.name ?? tag
  return { definition: 'base-type', value: withDeclaredLength(name, type[tag]) }
}

export { parseBaseTypeLeaf, parseDimensionsXml }
