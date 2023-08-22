import { createProjectService } from '../services'
/**
 * Controller responsible for handling project creation.
 */
const createProjectController = {
  /**
   * Handles the project creation process.
   * @returns {Promise<any>} A promise that resolves to the result of the project creation.
   */
  async handle(): Promise<unknown> {
    /**
     * Calls the execute method of the createProjectService to initiate project creation.
     * @returns {Promise<any>} A promise that resolves to the result of the project creation.
     */
    const result = await createProjectService.execute()
    return result
  },
}

export default createProjectController
