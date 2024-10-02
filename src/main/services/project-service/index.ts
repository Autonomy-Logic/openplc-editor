import { app, BrowserWindow, dialog } from 'electron'
import { promises, readFile, writeFile } from 'fs'
import { join } from 'path'

// import { projectSchema } from '../../../types/PLC'
import { PLCProjectData, PLCProjectDataSchema } from '../../../types/PLC/open-plc'
import { i18n } from '../../../utils/i18n'
import { CreateJSONFile } from '../../utils'
import { baseJsonStructure } from './data'

export type IProjectServiceResponse = {
  success: boolean
  error?: {
    title: string
    description: string
  }
  message?: string
  data?: {
    meta: {
      path: string
    }
    content: PLCProjectData
  }
}

class ProjectService {
  constructor(private serviceManager: InstanceType<typeof BrowserWindow>) {}

  async createProject(): Promise<IProjectServiceResponse> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.serviceManager, {
      title: i18n.t('createProject:dialog.title'),
      properties: ['openDirectory', 'createDirectory'],
    })

    if (canceled)
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:createProject.errors.canceled.title'),
          description: i18n.t('projectServiceResponses:createProject.errors.canceled.description'),
        },
      }
    const [filePath] = filePaths

    const isEmptyDir = async () => {
      try {
        const directory = await promises.opendir(filePath)
        const entry = await directory.read()
        await directory.close()
        return entry === null
      } catch (_error) {
        return false
      }
    }

    if (!(await isEmptyDir())) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:createProject.errors.directoryNotEmpty.title'),
          description: i18n.t('projectServiceResponses:createProject.errors.directoryNotEmpty.description'),
        },
      }
    }

    CreateJSONFile(filePath, JSON.stringify(baseJsonStructure, null, 2), 'data')

    const projectPath = join(filePath, 'data.json')
    /**
     * First, read the content of the projects.json file in the History folder.
     * Second, write that content into a JavaScript object.
     * Third, concatenate the content of the file with the current path.
     * Fourth, write the content of the JavaScript object back to the projects.json file.
     */
    const pathToUserDataFolder = join(app.getPath('userData'), 'User')
    const historyFilePath = join(pathToUserDataFolder, 'History/projects.json')

    try {
      const historyContent = await promises.readFile(historyFilePath, 'utf-8')
      let historyData

      // Try to parse the content. If it fails, initialize an empty array.
      try {
        historyData = JSON.parse(historyContent)
      } catch (error) {
        console.error(error)
        historyData = []
      }

      // Check if historyData is an array.
      if (!Array.isArray(historyData)) {
        historyData = []
      }

      // Create an object with project information.
      const projectInfo = {
        path: projectPath,
        createdAt: new Date().toISOString(), // creation date in ISO format.
      }

      // Add the object to the history.
      historyData.push(projectInfo)

      // Write the new content back to the projects.json file.
      await promises.writeFile(historyFilePath, JSON.stringify(historyData, null, 2))
    } catch (error) {
      // If the file does not exist, initialize historyData as an empty array.
      if (error.code === 'ENOENT') {
        const initialData = [
          {
            path: projectPath,
            createdAt: new Date().toISOString(),
          },
        ]
        await promises.writeFile(historyFilePath, JSON.stringify(initialData, null, 2))
      } else {
        return {
          success: false,
          error: {
            title: 'Error reading or writing to the history file',
            description: 'An error occurred while reading or writing to the history file.',
          },
        }
      }
    }

    return {
      success: true,
      data: {
        meta: {
          path: projectPath,
        },
        content: baseJsonStructure,
      },
    }
  }

  async openProject(): Promise<IProjectServiceResponse> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.serviceManager, {
      title: i18n.t('openProject:dialog.title'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (canceled)
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.canceled.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.canceled.description'),
        },
      }
    const [filePath] = filePaths

    const file = await new Promise((resolve, reject) => {
      readFile(filePath, 'utf-8', (error, data) => {
        if (error) return reject(error)
        return resolve(data)
      })
    })

    if (!file) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.readFile.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readFile.description', {
            filePath,
          }),
        },
      }
    }

    const parsedFile = PLCProjectDataSchema.safeParse(JSON.parse(file as string))

    if (!parsedFile.success) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.readFile.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readFile.description'),
        },
      }
    }
    return {
      success: true,
      data: {
        meta: {
          path: filePath,
        },
        content: parsedFile.data,
      },
    }
  }

  saveProject(data: { projectPath: string; projectData: PLCProjectData }): IProjectServiceResponse {
    const { projectPath, projectData } = data
    if (!projectPath || !projectData)
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:saveProject.errors.missingParams.title'),
          description: i18n.t('projectServiceResponses:saveProject.errors.missingParams.description'),
        },
      }

    const normalizedDataToWrite = JSON.stringify(projectData, null, 2)

    writeFile(projectPath, normalizedDataToWrite, (error) => {
      if (error) throw error
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:saveProject.errors.failedToSaveFile.title'),
          description: i18n.t('projectServiceResponses:saveProject.errors.failedToSaveFile.description'),
        },
      }
    })

    return {
      success: true,
      message: i18n.t('projectServiceResponses:saveProject.success.successToSaveFile.message'),
    }
  }
}

export default ProjectService
