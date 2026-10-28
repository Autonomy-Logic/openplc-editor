import type { SystemLibrary } from '../../../../middleware/shared/ports/library-types'
import type { PLCDataType, PLCInstance, PLCPou, PLCTask, PLCVariable } from '../../../../middleware/shared/ports/types'
import { createBlockSignatureResolver } from './block-signatures'
import { parseDataTypesXml } from './data-type-xml'
import { parseConfigurationXml } from './instances-xml'
import { parseXmlDocument } from './parse-xml-document'
import { parsePouHeadersXml, parsePousXml } from './pou-xml'
import { asRecord, asString } from './xml-node'

// Structurally matches `ParsedProjectData['projectData']`
// (backend/shared/utils/parse-project-files.ts) minus the fields PLCopen XML
// has no representation for (servers, remoteDevices, libraryManifest,
// debugVariables) — `libraries` is filled with `[]` since it's a required
// field on that target shape and bundled/canonical libraries are always-on
// regardless of an explicit enablement list.
export interface ParsedPlcopenProjectData {
  dataTypes: PLCDataType[]
  pous: PLCPou[]
  configurations: {
    resource: {
      tasks: PLCTask[]
      instances: PLCInstance[]
      globalVariables: PLCVariable[]
    }
  }
  libraries: { name: string; version: string }[]
}

export interface PlcopenParseResult {
  projectData: ParsedPlcopenProjectData
  warnings: string[]
  // <contentHeader name="..."> — the generator never sets this to anything
  // but the hardcoded 'Unnamed' (it takes no project-name input), so this is
  // only ever meaningful for XML from another tool (e.g. u-Create). '' when
  // absent; callers decide what placeholder to fall back to.
  projectName: string
}

// Parses PLCopen TC6-0201 XML into the same project-data shape
// `PlcopenXmlGenerator` consumes — the inverse of that pipeline
// (xml-generator/old-editor/*.ts). SFC bodies and other unsupported
// elements surface as non-fatal warnings rather than being parsed.
export interface PlcopenParseOptions {
  // Ladder blocks are drawn from their signature, which a foreign XML does not carry for library blocks.
  systemLibraries?: SystemLibrary[]
}

export function parsePlcopenXml(xml: string, options: PlcopenParseOptions = {}): PlcopenParseResult {
  const project = parseXmlDocument(xml)
  const types = asRecord(project.types)

  const dataTypes = parseDataTypesXml(asRecord(types.dataTypes).dataType)
  const pouXml = asRecord(types.pous).pou
  const resolveBlock = createBlockSignatureResolver(
    parsePouHeadersXml(pouXml),
    options.systemLibraries ?? [],
    project.addData,
  )
  const { pous, warnings } = parsePousXml(pouXml, { resolveBlock })
  const configurations = parseConfigurationXml(project.instances)
  const projectName = asString(asRecord(project.contentHeader)['@name'])

  return { projectData: { dataTypes, pous, configurations, libraries: [] }, warnings, projectName }
}
