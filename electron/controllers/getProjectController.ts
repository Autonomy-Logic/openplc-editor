import { getProjectService } from '../services'

const getProjectController = {
  async handle(filePath: string) {
    const result = await getProjectService.execute(filePath)
    return result
  },
}

export default getProjectController
