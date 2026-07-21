import type { PLCPou, PLCVariable, PouType, VariableClass } from '../../../../middleware/shared/ports/types'
import { lookupBaseTypeByXmlElement } from '../../iec-types-registry'
import { parseFbdXml } from './language/fbd-xml'
import { parseLadderXml } from './language/ladder-xml'
import { extractXhtmlText, parseDocumentationXml, parseVariableXml } from './variable-xml'
import { asArray, asRecord, asString } from './xml-node'

const VAR_GROUP_TO_CLASS: Record<string, VariableClass> = {
  inputVars: 'input',
  outputVars: 'output',
  inOutVars: 'inOut',
  externalVars: 'external',
  localVars: 'local',
  tempVars: 'temp',
}

const POU_TYPE_FROM_XML: Record<string, PouType> = {
  program: 'program',
  function: 'function',
  functionBlock: 'function-block',
}

// Reverse of `oldEditorParseInterface` (xml-generator/old-editor/pou-xml.ts).
export function parseInterfaceXml(interfaceXml: unknown): { variables: PLCVariable[]; returnType?: string } {
  const iface = asRecord(interfaceXml)
  const variables: PLCVariable[] = []

  for (const [group, variableClass] of Object.entries(VAR_GROUP_TO_CLASS)) {
    const groupXml = asRecord(iface[group])
    for (const varXml of asArray(groupXml.variable)) {
      variables.push(parseVariableXml(varXml, variableClass))
    }
  }

  if (!iface.returnType) return { variables }

  const returnTypeXml = asRecord(iface.returnType)
  if ('derived' in returnTypeXml) {
    return { variables, returnType: asString(asRecord(returnTypeXml.derived)['@name']) }
  }
  const tag = Object.keys(returnTypeXml)[0]
  return { variables, returnType: tag !== undefined ? (lookupBaseTypeByXmlElement(tag)?.name ?? tag) : undefined }
}

// Reverse of `oldEditorParsePousToXML`. ST/IL/LD/FBD bodies all parse in
// full; SFC and codesys-dialect bodies are surfaced as a non-fatal warning
// and the POU is skipped — this importer's scope is the old-editor dialect
// only (see xml-parser/index.ts).
export function parsePousXml(pouXml: unknown): { pous: PLCPou[]; warnings: string[] } {
  const pous: PLCPou[] = []
  const warnings: string[] = []

  for (const entryRaw of asArray(pouXml)) {
    const entry = asRecord(entryRaw)
    const name = asString(entry['@name'])
    const pouTypeXml = asString(entry['@pouType'])
    const type = POU_TYPE_FROM_XML[pouTypeXml]
    if (!type) {
      warnings.push(`POU "${name}": unrecognized pouType "${pouTypeXml}", skipped`)
      continue
    }

    const body = asRecord(entry.body)
    const { variables, returnType } = parseInterfaceXml(entry.interface)
    const documentation = parseDocumentationXml(entry.documentation)
    const pouInterface = { variables, ...(returnType !== undefined ? { returnType } : {}) }

    if (body.ST !== undefined) {
      pous.push({
        name,
        pouType: type,
        interface: pouInterface,
        body: { language: 'st', value: extractXhtmlText(body.ST) },
        documentation,
      })
      continue
    }
    if (body.IL !== undefined) {
      pous.push({
        name,
        pouType: type,
        interface: pouInterface,
        body: { language: 'il', value: extractXhtmlText(body.IL) },
        documentation,
      })
      continue
    }
    if (body.LD !== undefined) {
      const { body: ldBody, warnings: ldWarnings } = parseLadderXml(name, body.LD)
      warnings.push(...ldWarnings)
      pous.push({
        name,
        pouType: type,
        interface: pouInterface,
        body: { language: 'ld', value: ldBody },
        documentation,
      })
      continue
    }
    if (body.FBD !== undefined) {
      const { body: fbdBody, warnings: fbdWarnings } = parseFbdXml(name, body.FBD)
      warnings.push(...fbdWarnings)
      pous.push({
        name,
        pouType: type,
        interface: pouInterface,
        body: { language: 'fbd', value: fbdBody },
        documentation,
      })
      continue
    }
    if (body.SFC !== undefined) {
      warnings.push(`POU "${name}": Sequential Function Chart is not supported by the importer, skipped`)
      continue
    }
    warnings.push(`POU "${name}": no recognized body language found, skipped`)
  }

  return { pous, warnings }
}
