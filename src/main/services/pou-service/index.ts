import { CreatePouFileProps, PouServiceResponse } from '@root/types/IPC/pou-service'

import { UserService } from '../user-service'

class PouService {
  constructor() {}

  async createPouFile(props: CreatePouFileProps): Promise<PouServiceResponse> {
    try {
      const filePath = props.path
      await UserService.createJSONFileIfNotExists(filePath, props.pou)

      return { success: true, data: { pou: props.pou } }
    } catch (error) {
      console.error('Error creating POU file:', error)
      return { success: false, error: { title: 'POU Creation Error', description: 'Failed to create POU file', error } }
    }
  }

  async deletePouFile(filePath: string): Promise<PouServiceResponse> {
    try {
      console.log('Deleting POU file at:', filePath)
      await UserService.deleteFile(filePath)
      return { success: true }
    } catch (error) {
      console.error('Error deleting POU file:', error)
      return { success: false, error: { title: 'POU Deletion Error', description: 'Failed to delete POU file', error } }
    }
  }
}

export { PouService }
