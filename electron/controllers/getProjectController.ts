import { getProjectService } from '../services'
/**
 * Controller responsible for handling project retrieval.
 */
const getProjectController = {
  /**
   * Handles the project retrieval process.
   * @param {string} filePath - The path to the project file.
   * @returns {Promise<any>} A promise that resolves to the result of the project retrieval.
   */
  async handle(filePath: string) {
    /**
     * Calls the execute method of the getProjectService to retrieve project data.
     * @param {string} filePath - The path to the project file.
     * @returns {Promise<any>} A promise that resolves to the result of the project retrieval.
     */
    const result = await getProjectService.execute(filePath)
    return result
  },
}

export default getProjectController
