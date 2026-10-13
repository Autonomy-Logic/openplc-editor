import type { PLCProjectData } from '@root/middleware/shared/ports/open-plc-types'
import { create } from 'xmlbuilder2'

import {
  getBaseOldEditorXmlStructure,
  oldEditorInstanceToXml,
  oldEditorParseDataTypesToXML,
  oldEditorParsePousToXML,
} from '../../../../frontend/utils/PLC/xml-generator/old-editor'
import { collectLibraryBlocks } from './collect-library-blocks'

const PlcopenXmlGenerator = (projectToGenerateXML: PLCProjectData) => {
  let xmlResult = getBaseOldEditorXmlStructure()

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
  xmlResult = oldEditorParsePousToXML(xmlResult, projectToGenerateXML.pous)

  /**
   * Parse data types
   */
  xmlResult = oldEditorParseDataTypesToXML(xmlResult, projectToGenerateXML.dataTypes)

  /**
   * Parse instances
   */
  xmlResult = oldEditorInstanceToXml(xmlResult, projectToGenerateXML.configuration)

  /**
   * Embed the signatures of every library block the project uses, so an ST generator
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

export { PlcopenXmlGenerator }
