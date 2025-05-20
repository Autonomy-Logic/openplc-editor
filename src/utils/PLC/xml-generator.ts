import { create } from 'xmlbuilder2'

import type { ProjectState } from '../../renderer/store/slices'
import {
  getBaseOldEditorXmlStructure,
  instanceToXml,
  parseDataTypesToXML,
  parsePousToXML,
} from '../PLC/xml-generator/old-editor'

const XmlGenerator = (projectToGenerateXML: ProjectState['data'], parseTo: 'old-editor' | 'codesys' = 'old-editor') => {
  let xmlResult = parseTo === 'old-editor' ? getBaseOldEditorXmlStructure() : getBaseOldEditorXmlStructure()

  /**
   * Parse POUs
   */
  const pous = projectToGenerateXML.pous

  const mainPou = pous.find((pou) => pou.data.name === 'main' && pou.type === 'program')
  if (!mainPou) return { ok: false, message: 'Main POU not found.', data: undefined }

  if (parseTo === 'old-editor') {
    xmlResult = parsePousToXML(xmlResult, pous)

    /**
     * Parse data types
     */
    const dataTypes = projectToGenerateXML.dataTypes
    xmlResult = parseDataTypesToXML(xmlResult, dataTypes)

    /**
     * Parse instances
     */
    const configuration = projectToGenerateXML.configuration
    xmlResult = instanceToXml(xmlResult, configuration)
  }

  const doc = create(xmlResult)
  doc.dec({ version: '1.0', encoding: 'utf-8' })

  return { ok: true, message: 'XML generated', data: doc.end({ prettyPrint: true }) }
}

export { XmlGenerator }
