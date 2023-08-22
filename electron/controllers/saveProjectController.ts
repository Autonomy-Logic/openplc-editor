import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { saveProjectService } from '../services'
/**
 * Controller responsible for handling project saving.
 */
const saveProjectController = {
  /**
   * Handles the project saving process.
   * @param {string} filePath - The path to save the project to.
   * @param {XMLSerializedAsObject} xmlSerializedAsObject - The XML serialized data to be saved.
   * @returns {Promise<any>} A promise that resolves to the result of the project saving.
   */
  async handle(filePath: string, xmlSerializedAsObject: XMLSerializedAsObject) {
    /**
     * Calls the execute method of the saveProjectService to initiate project saving.
     * @param {string} filePath - The path to save the project to.
     * @param {XMLSerializedAsObject} xmlSerializedAsObject - The XML serialized data to be saved.
     * @returns {Promise<any>} A promise that resolves to the result of the project saving.
     */
    const result = await saveProjectService.execute(
      filePath,
      xmlSerializedAsObject,
    )
    return result
  },
}

export default saveProjectController
