import { app, BrowserWindow, dialog } from 'electron'
import { promises, readFile, writeFile } from 'fs'
import { join } from 'path'

// import { projectSchema } from '../../../types/PLC'
import { PLCProjectData, PLCProjectDataSchema } from '../../../types/PLC/open-plc'
import { i18n } from '../../../utils/i18n'
import { CreateJSONFile } from '../../utils'
import { UserService } from '../user-service'
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

interface IProjectHistoryEntry {
  path: string
  createdAt: string
  lastOpenedAt: string
}

class ProjectService {
  constructor(private serviceManager: InstanceType<typeof BrowserWindow>) {}
  async openProjectByPath(projectPath: string): Promise<IProjectServiceResponse> {
    try {
      const fileContent = await promises.readFile(projectPath, 'utf-8')

      const parsedFile = PLCProjectDataSchema.safeParse(JSON.parse(fileContent))
      if (!parsedFile.success) {
        return {
          success: false,
          error: {
            title: 'Error reading project file',
            description: 'Error parsing project file.',
          },
        }
      }

      await this.updateProjectHistory(projectPath)

      return {
        success: true,
        data: {
          meta: { path: projectPath },
          content: parsedFile.data,
        },
      }
    } catch (_error) {
      return {
        success: false,
        error: {
          title: 'Error reading project file',
          description: 'Error reading project file. ',
        },
      }
    }
  }

  async readProjectHistory(projectsFilePath: string): Promise<IProjectHistoryEntry[]> {
    try {
      const historyContent = await promises.readFile(projectsFilePath, 'utf-8')
      const historyData = JSON.parse(historyContent) as IProjectHistoryEntry[]
      return Array.isArray(historyData) ? historyData : []
    } catch (error) {
      console.error('Error reading history file:', error)
      return []
    }
  }

  async writeProjectHistory(projectsFilePath: string, historyData: IProjectHistoryEntry[]): Promise<void> {
    await promises.writeFile(projectsFilePath, JSON.stringify(historyData, null, 2))
  }

  async updateProjectHistory(projectPath: string): Promise<void> {
    const pathToUserDataFolder = join(app.getPath('userData'), 'User')
    const pathToUserHistoryFolder = join(pathToUserDataFolder, 'History')
    const projectsFilePath = join(pathToUserHistoryFolder, 'projects.json')

    const historyData = await this.readProjectHistory(projectsFilePath)
    const lastOpenedAt = new Date().toISOString()

    const existingProjectIndex = historyData.findIndex((proj) => proj.path === projectPath)

    if (existingProjectIndex > -1) {
      historyData[existingProjectIndex].lastOpenedAt = lastOpenedAt
    } else {
      historyData.push({
        path: projectPath,
        createdAt: lastOpenedAt,
        lastOpenedAt: lastOpenedAt,
      })
    }

    historyData.sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())
    await this.writeProjectHistory(projectsFilePath, historyData)
  }

  async createProject(): Promise<IProjectServiceResponse> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.serviceManager, {
      title: i18n.t('createProject:dialog.title'),
      properties: ['openDirectory', 'createDirectory'],
    })

    if (canceled) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:createProject.errors.canceled.title'),
          description: i18n.t('projectServiceResponses:createProject.errors.canceled.description'),
        },
      }
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

    await UserService.checkIfUserHistoryFolderExists()
    CreateJSONFile(filePath, JSON.stringify(baseJsonStructure, null, 2), 'data')

    const projectPath = join(filePath, 'data.json')
    await this.updateProjectHistory(projectPath)

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

    if (canceled) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.canceled.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.canceled.description'),
        },
      }
    }

    const filePath = filePaths[0]

    const file = await new Promise<string>((resolve, reject) => {
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

    const parsedFile = PLCProjectDataSchema.safeParse(JSON.parse(file))
    if (!parsedFile.success) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.readFile.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readFile.description'),
        },
      }
    }

    const projectPath = filePath
    await this.updateProjectHistory(projectPath)

    return {
      success: true,
      data: {
        meta: {
          path: projectPath,
        },
        content: parsedFile.data,
      },
    }
  }

  saveProject(data: { projectPath: string; projectData: PLCProjectData }): IProjectServiceResponse {
    const { projectPath, projectData } = data
    if (!projectPath || !projectData) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:saveProject.errors.missingParams.title'),
          description: i18n.t('projectServiceResponses:saveProject.errors.missingParams.description'),
        },
      }
    }

    const normalizedDataToWrite = JSON.stringify(projectData, null, 2)

    writeFile(projectPath, normalizedDataToWrite, (error) => {
      if (error) {
        console.error(error)
        throw error
      }
    })

    return {
      success: true,
      message: i18n.t('projectServiceResponses:saveProject.success.successToSaveFile.message'),
    }
  }
}

export default ProjectService
