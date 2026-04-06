import type { PLCProjectData } from '@root/middleware/shared/ports/open-plc-types'
import { BaseXml as codeSysBaseXml } from '@root/middleware/shared/ports/xml-types/codesys'
import { BaseXml as oldBaseXml } from '@root/middleware/shared/ports/xml-types/old-editor'
import { create } from 'xmlbuilder2'

import {
  codeSysInstanceToXml,
  codeSysParseDataTypesToXML,
  codeSysParsePousToXML,
  getBaseCodeSysXmlStructure,
} from '../../../../frontend/utils/PLC/xml-generator/codesys'
import {
  getBaseOldEditorXmlStructure,
  oldEditorInstanceToXml,
  oldEditorParseDataTypesToXML,
  oldEditorParsePousToXML,
} from '../../../../frontend/utils/PLC/xml-generator/old-editor'

const XmlGenerator = (
  projectToGenerateXML: PLCProjectData,
  xmlFormatTarget: 'old-editor' | 'codesys' = 'old-editor',
) => {
  let xmlResult = xmlFormatTarget === 'old-editor' ? getBaseOldEditorXmlStructure() : getBaseCodeSysXmlStructure()

  /**
   * Parse POUs
   */
  const pous = projectToGenerateXML.pous

  const mainPou = pous.find((pou) => pou.data.name === 'main' && pou.type === 'program')
  if (!mainPou) return { ok: false, message: 'Main POU not found.', data: undefined }

  if (xmlFormatTarget === 'old-editor') {
    let oldXml = xmlResult as oldBaseXml
    oldXml = oldEditorParsePousToXML(oldXml, pous)

    /**
     * Parse data types
     */
    const dataTypes = projectToGenerateXML.dataTypes
    oldXml = oldEditorParseDataTypesToXML(oldXml, dataTypes)

    /**
     * Parse instances
     */
    const configuration = projectToGenerateXML.configuration
    xmlResult = oldEditorInstanceToXml(oldXml, configuration)
  } else {
    let csXml = xmlResult as codeSysBaseXml
    csXml = codeSysParsePousToXML(csXml, pous)

    /**
     * Parse data types
     */
    const dataTypes = projectToGenerateXML.dataTypes
    csXml = codeSysParseDataTypesToXML(csXml, dataTypes)

    /**
     * Parse instances
     */
    const configuration = projectToGenerateXML.configuration
    xmlResult = codeSysInstanceToXml(csXml, configuration)
  }

  const doc = create(xmlResult)
  doc.dec({ version: '1.0', encoding: 'utf-8' })

  return { ok: true, message: 'XML generated', data: doc.end({ prettyPrint: true }) }
}

export { XmlGenerator }
