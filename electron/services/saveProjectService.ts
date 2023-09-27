import { writeFile } from 'node:fs'
import { join } from 'node:path'

import { i18n } from '@shared/i18n'
import { create } from 'xmlbuilder2'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { ServiceResponse } from './types/response'
/**
 * Service responsible for saving a project as an XML file.
 */
const saveProjectService = {
  /**
   * Executes the service to save a project as an XML file.
   * @param filePath - The path where the XML file should be saved.
   * @param xmlSerializedAsObject - The XML data to be serialized and saved.
   * @returns A promise containing the service response.
   */
  async execute(
    filePath: string,
    xmlSerializedAsObject: XMLSerializedAsObject,
  ): Promise<ServiceResponse<string>> {
    // Check if required parameters are provided.
    if (!filePath || !xmlSerializedAsObject)
      return {
        ok: false,
        reason: {
          title: i18n.t('saveProject:errors.failedToSaveFile.title'),
          description: i18n.t(
            'saveProject:errors.failedToSaveFile.description',
          ),
        },
      }

    // Create the full path to the 'plc.xml' file.
    filePath = join(filePath, 'plc.xml')

    // Serialize the XML data using xmlbuilder2.
    const xmlBuilder = create(xmlSerializedAsObject)

    let failedToSaveFile = false

    const plc = xmlBuilder.end({ prettyPrint: true })

    // Write the serialized XML to the file asynchronously.
    writeFile(filePath, plc, (error) => {
      if (error) failedToSaveFile = true
    })

    // If the file saving failed, return an error response.
    if (failedToSaveFile)
      return {
        ok: false,
        reason: {
          title: i18n.t('saveProject:errors.failedToSaveFile.title'),
          description: i18n.t(
            'saveProject:errors.failedToSaveFile.description',
          ),
        },
      }
    // Return a successful response upon successful file save.
    return {
      ok: true,
      reason: {
        title: i18n.t('saveProject:success.successToSaveFile.title'),
        description: i18n.t(
          'saveProject:success.successToSaveFile.description',
        ),
      },
    }
  },
}

export default saveProjectService
