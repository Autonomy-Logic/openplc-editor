import type { PLCVariableType } from '../../../../middleware/shared/ports/types'
import { lookupBaseTypeByXmlElement } from '../../iec-types-registry'
import { asArray, asRecord, asString } from './xml-node'

type LeafBaseType = { definition: 'base-type' | 'user-data-type'; value: string }

// Reverse of `convertTypeToXml` (xml-generator/old-editor/type-xml.ts): a
// PLCopen `<type>`/`<baseType>` element has exactly one child key, which is
// either a recognised IEC base-type tag, `derived` (user type/FB reference),
// or `array` (nested dimensions + element base type).
function parseBaseTypeLeaf(baseTypeXml: unknown): LeafBaseType {
  const rec = asRecord(baseTypeXml)
  if ('derived' in rec) {
    return { definition: 'user-data-type', value: asString(asRecord(rec.derived)['@name']) }
  }
  const tag = Object.keys(rec)[0]
  if (tag === undefined) throw new Error('Type element has no recognizable base type')
  return { definition: 'base-type', value: lookupBaseTypeByXmlElement(tag)?.name ?? tag }
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
  return { definition: 'base-type', value: lookupBaseTypeByXmlElement(tag)?.name ?? tag }
}

export { parseBaseTypeLeaf, parseDimensionsXml }
