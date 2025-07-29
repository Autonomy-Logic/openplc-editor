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
      await UserService.deleteFile(filePath)
      return { success: true }
    } catch (error) {
      console.error('Error deleting POU file:', error)
      return { success: false, error: { title: 'POU Deletion Error', description: 'Failed to delete POU file', error } }
    }
  }

  async renamePouFile(filePath: string, newFileName: string): Promise<PouServiceResponse> {
    try {
      const newFilePath = filePath.replace(/[^/]+$/, newFileName)
      const result = await UserService.renameFile(filePath, newFilePath)
      if (result.success) {
        return { success: true, data: { filePath: newFilePath } }
      } else {
        return { success: false, error: result.error }
      }
    } catch (error) {
      console.error('Error renaming POU file:', error)
      return { success: false, error: { title: 'POU Rename Error', description: 'Failed to rename POU file', error } }
    }
  }
}

export { PouService }
