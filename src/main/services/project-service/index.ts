import { app, BrowserWindow, dialog } from 'electron'
import { promises, readFile, writeFile } from 'fs'
import { join } from 'path'

import { newPLCProject, newPLCProjectSchema } from '../../../types/PLC/open-plc'
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
    content: newPLCProject
  }
}

interface IProjectHistoryEntry {
  path: string
  createdAt: string
  lastOpenedAt: string
}

class ProjectService {
  constructor(private serviceManager: InstanceType<typeof BrowserWindow>) {}

  private getProjectsFilePath(): string {
    const pathToUserDataFolder = join(app.getPath('userData'), 'User')
    const pathToUserHistoryFolder = join(pathToUserDataFolder, 'History')

    return join(pathToUserHistoryFolder, 'projects.json')
  }

  private async readProjectHistory(projectsFilePath: string): Promise<IProjectHistoryEntry[]> {
    try {
      const historyContent = await promises.readFile(projectsFilePath, 'utf-8')
      return (JSON.parse(historyContent) as IProjectHistoryEntry[]) || []
    } catch (error) {
      console.error('Error reading history file:', error)
      return []
    }
  }

  private async writeProjectHistory(projectsFilePath: string, historyData: IProjectHistoryEntry[]): Promise<void> {
    await promises.writeFile(projectsFilePath, JSON.stringify(historyData, null, 2))
  }

  private async updateProjectHistory(projectPath: string): Promise<void> {
    const projectsFilePath = this.getProjectsFilePath()
    const historyData = await this.readProjectHistory(projectsFilePath)
    const lastOpenedAt = new Date().toISOString()

    const existingProjectIndex = historyData.findIndex((proj) => proj.path === projectPath)
    if (existingProjectIndex > -1) {
      historyData[existingProjectIndex].lastOpenedAt = lastOpenedAt
    } else {
      historyData.push({ path: projectPath, createdAt: lastOpenedAt, lastOpenedAt })
    }

    historyData.sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())
    await this.writeProjectHistory(projectsFilePath, historyData)
  }

  async removeProjectFromHistory(projectPath: string): Promise<void> {
    const projectsFilePath = this.getProjectsFilePath()
    const historyData = await this.readProjectHistory(projectsFilePath)
    const updatedHistory = historyData.filter((project) => project.path !== projectPath)
    await this.writeProjectHistory(projectsFilePath, updatedHistory)
  }

  async openProjectByPath(projectPath: string): Promise<IProjectServiceResponse> {
    try {
      await promises.access(projectPath)
      const fileContent = await promises.readFile(projectPath, 'utf-8')
      const parsedFile = PLCProjectDataSchema.safeParse(JSON.parse(fileContent))

      if (!parsedFile.success) {
        return this.createErrorResponse('Error parsing project file.')
      }

      await this.updateProjectHistory(projectPath)
      return this.createSuccessResponse(projectPath, parsedFile.data)
    } catch (_error) {
      await this.removeProjectFromHistory(projectPath)
      return this.createErrorResponse('Error reading project file.')
    }
  }

  private createErrorResponse(description: string): IProjectServiceResponse {
    return {
      success: false,
      error: {
        title: 'Error reading project file',
        description,
      },
    }
  }

  private createSuccessResponse(projectPath: string, content: PLCProjectData): IProjectServiceResponse {
    return {
      success: true,
      data: {
        meta: { path: projectPath },
        content,
      },
    }
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
    const parsedFile = newPLCProjectSchema.safeParse(JSON.parse(file as string))
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

  saveProject(data: { projectPath: string; projectData: newPLCProject }): IProjectServiceResponse {
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
