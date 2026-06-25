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
import { collectLibraryBlocks } from './collect-library-blocks'

const XmlGenerator = (
  projectToGenerateXML: PLCProjectData,
  xmlFormatTarget: 'old-editor' | 'codesys' = 'old-editor',
) => {
  let xmlResult = xmlFormatTarget === 'old-editor' ? getBaseOldEditorXmlStructure() : getBaseCodeSysXmlStructure()

  /**
   * Parse POUs
   *
   * No hardcoded "main" POU requirement here.  The compiler accepts
   * any program POU name and uses the configuration's `instances[]`
   * to pick the entry program; the editor template happens to seed a
   * POU called "main" + an instance referencing it, but the user is
   * free to rename either side (rename cascades from `updatePouName`
   * into matching instances).  A project with zero program POUs is
   * still serialisable — the resulting XML will fail downstream at
   * the IEC compile step with a clearer error than a vague editor
   * gate would produce.
   */
  const pous = projectToGenerateXML.pous

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

  /**
   * Embed the signatures of every library block the project uses, so xml2st
   * can type the temporaries it generates for FUNCTION outputs without
   * carrying a block library of its own.  Added last so it serialises after
   * <instances>, as the PLCopen schema requires for <addData>.
   */
  const libraryBlocks = collectLibraryBlocks(projectToGenerateXML)
  if (libraryBlocks) {
    ;(xmlResult as unknown as { project: Record<string, unknown> }).project.addData = libraryBlocks
  }

  const doc = create(xmlResult)
  doc.dec({ version: '1.0', encoding: 'utf-8' })

  return { ok: true, message: 'XML generated', data: doc.end({ prettyPrint: true }) }
}

export { XmlGenerator }
