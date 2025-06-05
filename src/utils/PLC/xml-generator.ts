import { BaseXml as codeSysBaseXml } from '@root/types/PLC/xml-data/codesys'
import { BaseXml as oldBaseXml } from '@root/types/PLC/xml-data/old-editor'
import { create } from 'xmlbuilder2'

import type { ProjectState } from '../../renderer/store/slices'
import {
  codeSysInstanceToXml,
  codeSysParseDataTypesToXML,
  codeSysParsePousToXML,
  getBaseCodeSysXmlStructure,
} from './xml-generator/codesys'
import {
  getBaseOldEditorXmlStructure,
  oldEditorInstanceToXml,
  oldEditorParseDataTypesToXML,
  oldEditorParsePousToXML,
} from './xml-generator/old-editor'

const XmlGenerator = (projectToGenerateXML: ProjectState['data'], parseTo: 'old-editor' | 'codesys' = 'old-editor') => {
  let xmlResult = parseTo === 'old-editor' ? getBaseOldEditorXmlStructure() : getBaseCodeSysXmlStructure()

  /**
   * Parse POUs
   */
  const pous = projectToGenerateXML.pous

  const mainPou = pous.find((pou) => pou.data.name === 'main' && pou.type === 'program')
  if (!mainPou) return { ok: false, message: 'Main POU not found.', data: undefined }

  if (parseTo === 'old-editor') {
    xmlResult = oldEditorParsePousToXML(xmlResult as oldBaseXml, pous)

    /**
     * Parse data types
     */
    const dataTypes = projectToGenerateXML.dataTypes
    xmlResult = oldEditorParseDataTypesToXML(xmlResult, dataTypes)

    /**
     * Parse instances
     */
    const configuration = projectToGenerateXML.configuration
    xmlResult = oldEditorInstanceToXml(xmlResult, configuration)
  } else {
    xmlResult = codeSysParsePousToXML(xmlResult as codeSysBaseXml, pous)

    /**
     * Parse data types
     */
    const dataTypes = projectToGenerateXML.dataTypes
    xmlResult = codeSysParseDataTypesToXML(xmlResult, dataTypes)

    /**
     * Parse instances
     */
    const configuration = projectToGenerateXML.configuration
    xmlResult = codeSysInstanceToXml(xmlResult, configuration)
  }

  const doc = create(xmlResult)
  doc.dec({ version: '1.0', encoding: 'utf-8' })

  return { ok: true, message: 'XML generated', data: doc.end({ prettyPrint: true }) }
}

export { XmlGenerator }
