import type { PLCDataType, PLCStructureVariable } from '../../../../middleware/shared/ports/types'
import { parseBaseTypeLeaf, parseDimensionsXml, parseTypeXml } from './type-xml'
import { asArray, asRecord, asString } from './xml-node'

function parseSimpleInitialValue(xml: unknown): string | undefined {
  const simpleValue = asRecord(asRecord(xml).simpleValue)
  const value = simpleValue['@value']
  return typeof value === 'string' ? value : undefined
}

function parseStructInitialValue(xml: unknown): { simpleValue: { value: string } } | undefined {
  const value = parseSimpleInitialValue(xml)
  return value === undefined ? undefined : { simpleValue: { value } }
}

// Reverse of `oldEditorParseDataTypesToXML` (xml-generator/old-editor/data-type-xml.ts).
export function parseDataTypesXml(dataTypeXml: unknown): PLCDataType[] {
  return asArray(dataTypeXml).map((entryRaw) => {
    const entry = asRecord(entryRaw)
    const name = asString(entry['@name'])
    const baseType = asRecord(entry.baseType)

    if ('struct' in baseType) {
      const structXml = asRecord(baseType.struct)
      const variable: PLCStructureVariable[] = asArray(structXml.variable).map((vRaw) => {
        const v = asRecord(vRaw)
        return {
          name: asString(v['@name']),
          type: parseTypeXml(v.type),
          initialValue: parseStructInitialValue(v.initialValue),
        }
      })
      return { name, derivation: 'structure', variable }
    }

    if ('enum' in baseType) {
      const valuesXml = asRecord(asRecord(baseType.enum).values)
      const values = asArray(valuesXml.value).map((v) => ({ description: asString(asRecord(v)['@name']) }))
      return { name, derivation: 'enumerated', initialValue: parseSimpleInitialValue(entry.initialValue), values }
    }

    if ('array' in baseType) {
      const arrayXml = asRecord(baseType.array)
      const elementBaseType = parseBaseTypeLeaf(arrayXml.baseType)
      const dimensions = parseDimensionsXml(arrayXml.dimension)
      return {
        name,
        derivation: 'array',
        baseType: elementBaseType,
        initialValue: parseSimpleInitialValue(entry.initialValue),
        dimensions,
      }
    }

    throw new Error(`Unrecognized dataType derivation for "${name}"`)
  })
}
