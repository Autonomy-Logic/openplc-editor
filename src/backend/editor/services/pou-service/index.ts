import { PLCPou } from '@root/backend/shared/types/PLC/open-plc'
import { getExtensionFromLanguage } from '@root/frontend/utils/PLC/pou-file-extensions'
import { serializePouToText } from '@root/frontend/utils/PLC/pou-text-serializer'
import { CreatePouFileProps, PouServiceResponse } from '@root/types/IPC/pou-service'
import { promises } from 'fs'
import { basename, dirname, join } from 'path'

import { ipcPouToFlat } from '../../utils'
import { UserService } from '../user-service'

class PouService {
  constructor() {}

  async createPouFile(props: CreatePouFileProps): Promise<PouServiceResponse> {
    const { pou } = props
    const flat = ipcPouToFlat(pou)
    const extension = getExtensionFromLanguage(flat.body.language)
    const filePath = join(dirname(props.path), `${flat.name}${extension}`)

    try {
      await promises.access(filePath)
      return {
        success: false,
        error: {
          title: 'POU Create Error',
          description: 'A file with the target name already exists',
          error: new Error('EEXIST'),
        },
      }
    } catch {
      // File does not exist, proceed with creation
      // If the file does not exist, we can create it
      // No action needed here, just continue
    }

    try {
      await UserService.createDirectoryIfNotExists(dirname(filePath))
      const textContent: string = serializePouToText(flat)
      await promises.writeFile(filePath, textContent, 'utf-8')

      return { success: true, data: { pou } }
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
    const safeNewFileName = basename(newFileName)
    if (!safeNewFileName || safeNewFileName === '.' || safeNewFileName === '..') {
      return {
        success: false,
        error: {
          title: 'POU Rename Error',
          description: 'Invalid target file name',
          error: new Error('EINVAL'),
        },
      }
    }

    // Determine actual file paths by converting .json virtual paths to real language extensions
    let actualOldFilePath = filePath
    let actualNewFilePath = join(dirname(filePath), safeNewFileName)

    const isPou =
      typeof fileContent === 'object' && fileContent !== null && 'type' in fileContent && 'data' in fileContent

    if (isPou) {
      const flat = ipcPouToFlat(fileContent as PLCPou)
      const extension: string = getExtensionFromLanguage(flat.body.language)

      // Convert .json paths to actual language extension paths
      if (filePath.endsWith('.json')) {
        actualOldFilePath = filePath.replace(/\.json$/, extension)
      }
      if (safeNewFileName.endsWith('.json')) {
        const newFileNameWithExtension = safeNewFileName.replace(/\.json$/, extension)
        actualNewFilePath = join(dirname(filePath), newFileNameWithExtension)
      }
    }

    try {
      await promises.access(actualNewFilePath)
      return {
        success: false,
        error: {
          title: 'POU Rename Error',
          description: 'A file with the target name already exists',
          error: new Error('EEXIST'),
        },
      }
    } catch {
      // File does not exist, proceed with renaming
      // No action needed here, just continue
    }

    if (fileContent && isPou) {
      try {
        const flat = ipcPouToFlat(fileContent as PLCPou)
        const textContent: string = serializePouToText(flat)
        await promises.writeFile(actualOldFilePath, textContent, 'utf-8')
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
    } else if (fileContent) {
      try {
        await promises.writeFile(actualOldFilePath, JSON.stringify(fileContent, null, 2))
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
      const result = await UserService.renameFile(actualOldFilePath, actualNewFilePath)
      if (!result.success) {
        console.error('Error renaming POU file:', result.error)
        return { success: false, error: result.error }
      }
    } catch (error) {
      console.error('Error renaming POU file:', error)
      return { success: false, error: { title: 'POU Rename Error', description: 'Failed to rename POU file', error } }
    }

    return { success: true, data: { filePath: actualNewFilePath } }
  }
}

export { PouService }
