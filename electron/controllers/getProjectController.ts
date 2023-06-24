import { getProjectService } from '../services'

const getProjectController = {
  async handle(path: string) {
    const result = await getProjectService.execute(path)
    return result
  },
}

export default getProjectController
