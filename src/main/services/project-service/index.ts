import {
  CreateProjectFileProps,
  IProjectRecentHistoryEntry,
  IProjectServiceResponse,
} from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { app, BrowserWindow, dialog } from 'electron'
import { promises } from 'fs'
import { join } from 'path'

import { PLCProject } from '../../../types/PLC/open-plc'
import { i18n } from '../../../utils/i18n'
import { createProjectDefaultStructure, readProjectFiles } from './utils'

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

  async createProject(data: CreateProjectFileProps): Promise<IProjectServiceResponse> {
    const projectDefaultDirectoriesResponse = createProjectDefaultStructure(data.path, data)
    if (!projectDefaultDirectoriesResponse.success || !projectDefaultDirectoriesResponse.data) {
      return {
        success: false,
        error: projectDefaultDirectoriesResponse.error,
      }
    }
    await this.updateProjectHistory(data.path)
    return {
      success: true,
      data: {
        meta: {
          path: data.path, // Use the directory path instead of projectPath
        },
        content: projectDefaultDirectoriesResponse.data.content,
      },
    }
  }

  async readProjectHistory(historyProjectsFilePath: string): Promise<IProjectRecentHistoryEntry[]> {
    try {
      const historyContent = await promises.readFile(historyProjectsFilePath, 'utf-8')
      const content = (JSON.parse(historyContent) as IProjectRecentHistoryEntry[]) || []
      return content.map((entry) => ({
        ...entry,
        path: entry.path.normalize().endsWith('/project.json')
          ? entry.path.normalize().slice(0, -'/project.json'.length)
          : entry.path,
        projectFilePath: entry.projectFilePath
          ? entry.projectFilePath.normalize().endsWith('/project.json')
            ? entry.projectFilePath.normalize().slice(0, -'/project.json'.length)
            : entry.projectFilePath
          : '',
      }))
    } catch (error) {
      console.error('Error reading history file:', error)
      return []
    }
  }

  private async writeProjectHistory(
    projectsFilePath: string,
    historyData: IProjectRecentHistoryEntry[],
  ): Promise<void> {
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

  async openProjectByPath(projectPath: string): Promise<IProjectServiceResponse> {
    try {
      await promises.access(projectPath)
      const projectFiles = readProjectFiles(projectPath)

      if (!projectFiles.success || !projectFiles.data) {
        console.log(`Error opening project at path: ${projectPath}`, projectFiles.error)
        await this.removeProjectFromHistory(projectPath)

        return {
          success: false,
          error: {
            title: i18n.t('projectServiceResponses:openProject.errors.readProject.title'),
            description: i18n.t('projectServiceResponses:openProject.errors.readProject.description', {
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
          title: i18n.t('projectServiceResponses:openProject.errors.readProject.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readProject.description', {
            filePath: projectPath,
          }),
          error: error,
        },
      }
    }
  }

  async openProject(): Promise<IProjectServiceResponse> {
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

    const [directoryPath] = filePaths

    try {
      await promises.access(directoryPath)
      const projectFiles = readProjectFiles(directoryPath)

      if (!projectFiles.success || !projectFiles.data) {
        console.log(`Error opening project at path: ${directoryPath}`, projectFiles.error)
        await this.removeProjectFromHistory(directoryPath)

        return {
          success: false,
          error: {
            title: i18n.t('projectServiceResponses:openProject.errors.readProject.title'),
            description: i18n.t('projectServiceResponses:openProject.errors.readProject.description', {
              filePath: directoryPath,
            }),
            error: projectFiles.error,
          },
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
    } catch (error) {
      console.error(`Error accessing project directory: ${filePaths[0]}`, error)
      await this.removeProjectFromHistory(directoryPath)

      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.readProject.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readProject.description', {
            filePath: directoryPath,
          }),
          error: error,
        },
      }
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

    try {
      // Write each part to its correct file based on projectDefaultFilesMapSchema
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
