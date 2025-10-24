import { CreatePouFileProps, PouServiceResponse } from '@root/types/IPC/pou-service'
import { PLCPou } from '@root/types/PLC/open-plc'
import { getExtensionFromLanguage } from '@root/utils/PLC/pou-file-extensions'
import {
  serializeGraphicalPouToString,
  serializeHybridPouToString,
  serializeTextualPouToString,
} from '@root/utils/PLC/pou-text-serializer'
import { promises } from 'fs'
import { basename, dirname, join } from 'path'

import { UserService } from '../user-service'

/**
 * Helper function to serialize a POU to text format based on its language
 * @param pou - The POU to serialize
 * @returns The serialized text string
 */
const serializePouToText = (pou: PLCPou): string => {
  const language = pou.data.body.language

  if (language === 'st' || language === 'il') {
    return serializeTextualPouToString(pou)
  } else if (language === 'python' || language === 'cpp') {
    return serializeHybridPouToString(pou)
  } else if (language === 'ld' || language === 'fbd') {
    return serializeGraphicalPouToString(pou)
  } else {
    throw new Error(`Unsupported language: ${language}`)
  }
}

class PouService {
  constructor() {}

  async createPouFile(props: CreatePouFileProps): Promise<PouServiceResponse> {
    const { pou } = props
    const language = pou.data.body.language
    const extension = getExtensionFromLanguage(language)
    const pouName = pou.data.name
    const filePath = join(dirname(props.path), `${pouName}${extension}`)

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
      const textContent = serializePouToText(pou)
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
    const newFilePath = join(dirname(filePath), safeNewFileName)

    try {
      await promises.access(newFilePath)
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

    if (fileContent) {
      try {
        const isPou =
          typeof fileContent === 'object' && fileContent !== null && 'type' in fileContent && 'data' in fileContent

        if (isPou) {
          const pou = fileContent as PLCPou
          const textContent = serializePouToText(pou)
          await promises.writeFile(filePath, textContent, 'utf-8')
        } else {
          await promises.writeFile(filePath, JSON.stringify(fileContent, null, 2))
        }
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
