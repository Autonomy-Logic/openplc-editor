import { CreatePouFileProps, PouServiceResponse } from '@root/types/IPC/pou-service'
import { promises } from 'fs'
import { dirname, join } from 'path'

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
    } catch (error) {
      console.error('Error deleting POU file:', error)
      return { success: false, error: { title: 'POU Deletion Error', description: 'Failed to delete POU file', error } }
    }
    return { success: true }
  }

  async renamePouFile(data: {
    filePath: string
    newFileName: string
    fileContent?: unknown
  }): Promise<PouServiceResponse> {
    const { filePath, newFileName, fileContent } = data
    const newFilePath = join(dirname(filePath), newFileName)

    if (fileContent) {
      try {
        await promises.writeFile(filePath, JSON.stringify(fileContent, null, 2))
      } catch (writeError) {
        console.error(`Error writing content before rename: ${String(writeError)}`)
        return {
          success: false,
          error: {
            title: 'File Write Error',
            description: 'Failed to update content before rename',
            error: writeError as Error,
          },
        }
      }
    }

    try {
      const result = await UserService.renameFile(filePath, newFilePath)
      if (!result.success) {
        console.error('Error renaming POU file:', result.error)
        return { success: false, error: result.error }
      }
    } catch (error) {
      console.error('Error renaming POU file:', error)
      return { success: false, error: { title: 'POU Rename Error', description: 'Failed to rename POU file', error } }
    }

    return { success: true, data: { filePath: newFilePath } }
  }
}

export { PouService }
