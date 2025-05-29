import { app, BrowserWindow, dialog } from 'electron'
import { promises, readFile, writeFile } from 'fs'
import { join } from 'path'

import { PLCProject, PLCProjectSchema } from '../../../types/PLC/open-plc'
import { i18n } from '../../../utils/i18n'
import { CreateJSONFile } from '../../utils'
import { baseJsonStructure } from './data'

export type IProjectServiceResponse = {
  success: boolean
  error?: {
    title: string
    description: string
    error: unknown
  }
  message?: string
  data?: {
    meta: {
      path: string
    }
    content: PLCProject
  }
}

interface IProjectHistoryEntry {
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
}

class ProjectService {
  constructor(private serviceManager: InstanceType<typeof BrowserWindow>) {}
  public getProjectsFilePath(): string {
    const pathToUserDataFolder = join(app.getPath('userData'), 'User')
    const pathToUserHistoryFolder = join(pathToUserDataFolder, 'History')

    return join(pathToUserHistoryFolder, 'projects.json')
  }
  async getProjectName(projectPath: string): Promise<string> {
    try {
      const projectFile = await promises.readFile(projectPath, 'utf-8')
      return (JSON.parse(projectFile) as PLCProject).meta.name || 'Unknown project'
    } catch {
      console.error('Error reading project file', projectPath)
      return 'Unknown project'
    }
  }
  async readProjectHistory(projectsFilePath: string): Promise<IProjectHistoryEntry[]> {
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
  async updateProjectHistory(projectPath: string): Promise<void> {
    const projectsFilePath = this.getProjectsFilePath()
    const projectName = await this.getProjectName(projectPath)
    const historyData = await this.readProjectHistory(projectsFilePath)
    const lastOpenedAt = new Date().toISOString()

    const existingProjectIndex = historyData.findIndex((proj) => proj.path === projectPath)
    if (existingProjectIndex > -1) {
      historyData[existingProjectIndex].lastOpenedAt = lastOpenedAt
      historyData[existingProjectIndex].name = projectName
    } else {
      historyData.push({ name: projectName, path: projectPath, createdAt: lastOpenedAt, lastOpenedAt })
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
      const parsedFile = PLCProjectSchema.safeParse(JSON.parse(fileContent))

      if (!parsedFile.success) {
        return this.createErrorResponse('Error parsing project file.', parsedFile.error.errors)
      }

      await this.updateProjectHistory(projectPath)
      return this.createSuccessResponse(projectPath, parsedFile.data)
    } catch (error) {
      await this.removeProjectFromHistory(projectPath)
      return this.createErrorResponse('Error reading project file.', error)
    }
  }
  private createErrorResponse(description: string, error: unknown): IProjectServiceResponse {
    return {
      success: false,
      error: {
        title: 'Error reading project file',
        description,
        error,
      },
    }
  }
  private createSuccessResponse(projectPath: string, content: PLCProject): IProjectServiceResponse {
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
          error: null,
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
          error: null,
        },
      }
    }

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
          error: null,
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
          error: null,
        },
      }
    }
    const parsedFile = PLCProjectSchema.safeParse(JSON.parse(file))
    if (!parsedFile.success) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.readFile.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readFile.description'),
          error: null,
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
  saveProject(data: { projectPath: string; projectData: PLCProject }): IProjectServiceResponse {
    const { projectPath, projectData } = data
    if (!projectPath || !projectData) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:saveProject.errors.missingParams.title'),
          description: i18n.t('projectServiceResponses:saveProject.errors.missingParams.description'),
          error: null,
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

export { ProjectService }
