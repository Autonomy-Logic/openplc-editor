import { readFile } from 'node:fs'
import { join } from 'node:path'

import { i18n } from '@shared/i18n'
import { convert } from 'xmlbuilder2'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { ServiceResponse } from './types/response'
// Define the expected response type for the GetProjectService
type GetProjectServiceResponse = ServiceResponse<XMLSerializedAsObject>
/**
 * Service responsible for retrieving and processing project data from an XML file.
 */
const getProjectService = {
  /**
   * Executes the service to read and process the project XML file.
   * @param filePath - The path to the project XML file.
   * @returns A promise containing the service response.
   */
  async execute(filePath: string): Promise<GetProjectServiceResponse> {
    // Construct the full path to the 'plc.xml' file.
    filePath = join(filePath, 'plc.xml')
    // Read the XML file asynchronously.
    const file = await new Promise((resolve, reject) =>
      readFile(filePath, 'utf-8', (error, data) => {
        if (error) return reject(error)
        return resolve(data)
      }),
    )
    // If the file content is empty or not available, return an error response.
    if (!file) {
      return {
        ok: false,
        reason: {
          title: i18n.t('getProject:errors.readFile.title'),
          description: i18n.t('getProject:errors.readFile.description', {
            filePath,
          }),
        },
      }
    }
    // Convert the XML file content into a serialized object.
    return {
      ok: true,
      data: {
        xmlSerializedAsObject: convert(file, {
          format: 'object',
        }) as XMLSerializedAsObject,
      },
    }
  },
}

export default getProjectService
