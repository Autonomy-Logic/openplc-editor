import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { app, BrowserWindow, dialog } from 'electron'
import { promises } from 'fs'
import { join } from 'path'

import { PLCProject } from '../../../types/PLC/open-plc'
import { i18n } from '../../../utils/i18n'
import { CreateJSONFile } from '../../utils'
import { baseJsonStructure } from './data'
import { IProjectHistoryEntry } from './types'
import { isEmptyDir, readProjectFiles } from './utils'

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

export type INewProjectServiceResponse = {
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
    content: {
      project: PLCProject
      deviceConfiguration: DeviceConfiguration
      devicePinMapping: DevicePin[]
    }
  }
}

class ProjectService {
  constructor(private serviceManager: InstanceType<typeof BrowserWindow>) {}

  public getHistoryProjectsFilePath(): string {
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

    if (!(await isEmptyDir(filePath))) {
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

  async readProjectHistory(historyProjectsFilePath: string): Promise<IProjectHistoryEntry[]> {
    try {
      const historyContent = await promises.readFile(historyProjectsFilePath, 'utf-8')
      const content = (JSON.parse(historyContent) as IProjectHistoryEntry[]) || []
      return content.map((entry) => ({
        ...entry,
        path: entry.path.endsWith('/project.json') ? entry.path.slice(0, -'/project.json'.length) : entry.path,
        projectFilePath: entry.projectFilePath
          ? entry.projectFilePath.endsWith('/project.json')
            ? entry.projectFilePath.slice(0, -'/project.json'.length)
            : entry.projectFilePath
          : '',
      }))
    } catch (error) {
      console.error('Error reading history file:', error)
      return []
    }
  }

  private async writeProjectHistory(projectsFilePath: string, historyData: IProjectHistoryEntry[]): Promise<void> {
    await promises.writeFile(projectsFilePath, JSON.stringify(historyData, null, 2))
  }

  async updateProjectHistory(projectPath: string): Promise<void> {
    const historyProjectsFilePath = this.getHistoryProjectsFilePath()

    const directoryPath = projectPath.endsWith('/project.json')
      ? projectPath.slice(0, -'/project.json'.length)
      : projectPath
    const projectFilePath = projectPath.endsWith('/project.json') ? projectPath : join(projectPath, 'project.json')

    const projectName = await this.getProjectName(projectFilePath)
    const historyData = await this.readProjectHistory(historyProjectsFilePath)
    const lastOpenedAt = new Date().toISOString()

    const existingProjectIndex = historyData.findIndex((proj) => proj.path === directoryPath)
    if (existingProjectIndex > -1) {
      historyData[existingProjectIndex].name = projectName
      historyData[existingProjectIndex].path = directoryPath
      historyData[existingProjectIndex].projectFilePath = projectFilePath
      historyData[existingProjectIndex].lastOpenedAt = lastOpenedAt
    } else {
      historyData.push({
        name: projectName,
        path: directoryPath,
        projectFilePath: projectFilePath,
        createdAt: lastOpenedAt,
        lastOpenedAt,
      })
    }

    historyData.sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())
    await this.writeProjectHistory(historyProjectsFilePath, historyData)
  }

  async removeProjectFromHistory(projectPath: string): Promise<void> {
    const historyProjectsFilePath = this.getHistoryProjectsFilePath()
    const historyData = await this.readProjectHistory(historyProjectsFilePath)
    const updatedHistory = historyData.filter((project) => project.path !== projectPath)
    await this.writeProjectHistory(historyProjectsFilePath, updatedHistory)
  }

  async openProjectByPath(projectPath: string): Promise<INewProjectServiceResponse> {
    try {
      await promises.access(projectPath)
      const projectFiles = readProjectFiles(projectPath)

      if (!projectFiles.success || !projectFiles.data) {
        return {
          success: false,
          error: {
            title: i18n.t('projectServiceResponses:openProject.errors.readFile.title'),
            description: i18n.t('projectServiceResponses:openProject.errors.readFile.description', {
              filePath: projectPath,
            }),
            error: projectFiles.error,
          },
        }
      }

      await this.updateProjectHistory(projectPath)
      return {
        success: true,
        data: {
          meta: {
            path: projectPath,
          },
          content: projectFiles.data,
        },
      }
    } catch (error) {
      console.log(`Error opening project at path: ${projectPath}`, error)
      await this.removeProjectFromHistory(projectPath)
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.readFile.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readFile.description', {
            filePath: projectPath,
          }),
          error: error,
        },
      }
    }
  }

  async openProject(): Promise<INewProjectServiceResponse> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.serviceManager, {
      title: i18n.t('openProject:dialog.title'),
      properties: ['openDirectory'],
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

    const directoryPath = filePaths[0]
    const projectFiles = readProjectFiles(directoryPath)

    if (!projectFiles.success || !projectFiles.data) {
      return {
        success: false,
        error: projectFiles.error,
      }
    }

    await this.updateProjectHistory(directoryPath)

    return {
      success: true,
      data: {
        meta: {
          path: directoryPath,
        },
        content: projectFiles.data,
      },
    }
  }

  async saveProject(data: {
    projectPath: string
    content: {
      projectData: PLCProject
      deviceConfiguration: DeviceConfiguration
      devicePinMapping: DevicePin[]
    }
  }): Promise<IProjectServiceResponse> {
    const {
      projectPath,
      content: { deviceConfiguration, devicePinMapping, projectData },
    } = data
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

    const directoryPath = projectPath.endsWith('/project.json')
      ? projectPath.slice(0, -'/project.json'.length)
      : projectPath

    console.log('Saving project to:', directoryPath)
    console.log('Project data:', projectData)
    console.log('Device configuration:', deviceConfiguration)
    console.log('Device pin mapping:', devicePinMapping)

    try {
      // Write each part to its correct file based on projectFileMapSchema
      await Promise.all([
        promises.writeFile(join(directoryPath, 'project.json'), JSON.stringify(projectData, null, 2)),
        promises.writeFile(
          join(directoryPath, 'devices/configuration.json'),
          JSON.stringify(deviceConfiguration, null, 2),
        ),
        promises.writeFile(join(directoryPath, 'devices/pin-mapping.json'), JSON.stringify(devicePinMapping, null, 2)),
      ])
    } catch (error) {
      console.error(error)
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.readFile.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readFile.description', {
            filePath: projectPath,
          }),
          error,
        },
      }
    }

    return {
      success: true,
      message: i18n.t('projectServiceResponses:saveProject.success.successToSaveFile.message'),
    }
  }
}

export { ProjectService }
