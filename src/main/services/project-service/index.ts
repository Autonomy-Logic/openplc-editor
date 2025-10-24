import { fileOrDirectoryExists } from '@root/main/utils'
import {
  CreateProjectFileProps,
  IProjectRecentHistoryEntry,
  IProjectServiceResponse,
} from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { getExtensionFromLanguage } from '@root/utils/PLC/pou-file-extensions'
import {
  serializeGraphicalPouToString,
  serializeHybridPouToString,
  serializeTextualPouToString,
} from '@root/utils/PLC/pou-text-serializer'
import { app, BrowserWindow, dialog } from 'electron'
import { promises } from 'fs'
import { dirname, join, normalize } from 'path'

import { PLCPou, PLCProject } from '../../../types/PLC/open-plc'
import { i18n } from '../../../utils/i18n'
import { createProjectDefaultStructure, readProjectFiles } from './utils'

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
        path: normalize(entry.path).endsWith('/project.json')
          ? normalize(entry.path).slice(0, -'/project.json'.length)
          : normalize(entry.path),
        projectFilePath: entry.projectFilePath
          ? normalize(entry.projectFilePath).endsWith('/project.json')
            ? normalize(entry.projectFilePath).slice(0, -'/project.json'.length)
            : normalize(entry.projectFilePath)
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
      const projectFiles = await readProjectFiles(projectPath)

      if (!projectFiles.success || !projectFiles.data) {
        console.error(`Error opening project at path: ${projectPath}`, projectFiles.error)
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
      console.error(`Error opening project at path: ${projectPath}`, error)
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
      const projectFiles = await readProjectFiles(directoryPath)

      if (!projectFiles.success || !projectFiles.data) {
        console.error(`Error opening project at path: ${directoryPath}`, projectFiles.error)
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
      pous: PLCPou[]
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
          title: i18n.t('projectServiceResponses:saveProject.errors.failedToSaveFile.title'),
          description: i18n.t('projectServiceResponses:saveProject.errors.failedToSaveFile.description', {
            filePath: projectPath,
          }),
          error,
        },
      }
    }

    // Save pous
    try {
      const savedPous = {
        programs: data.content.pous.filter((pou) => pou.type === 'program'),
        functions: data.content.pous.filter((pou) => pou.type === 'function'),
        'function-blocks': data.content.pous.filter((pou) => pou.type === 'function-block'),
      }

      // Save each POU in its respective folder
      for (const [type, pous] of Object.entries(savedPous)) {
        const dir = join(directoryPath, 'pous', type)

        if (!fileOrDirectoryExists(dir)) {
          await promises.mkdir(dir, { recursive: true })
        }

        // Write/update each POU file
        for (const pou of pous) {
          const language = pou.data.body.language
          const extension = getExtensionFromLanguage(language)
          const filePath = join(dir, `${pou.data.name}${extension}`)
          const textContent = serializePouToText(pou)
          await promises.writeFile(filePath, textContent, 'utf-8')
        }
      }
    } catch (error) {
      console.error('Error saving POUs:', error)
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:saveProject.errors.failedToSaveFile.title'),
          description: i18n.t('projectServiceResponses:saveProject.errors.failedToSaveFile.description', {
            filePath: directoryPath,
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

  async saveFile(filePath: string, content: unknown): Promise<IProjectServiceResponse> {
    try {
      if (!fileOrDirectoryExists(filePath)) {
        const dir = dirname(filePath)
        await promises.mkdir(dir, { recursive: true })
      }

      const isPou = typeof content === 'object' && content !== null && 'type' in content && 'data' in content

      if (isPou) {
        const pou = content as PLCPou
        const textContent = serializePouToText(pou)
        await promises.writeFile(filePath, textContent, 'utf-8')
      } else {
        await promises.writeFile(filePath, JSON.stringify(content, null, 2))
      }

      return {
        success: true,
        message: i18n.t('projectServiceResponses:saveProject.success.successToSaveFile.message'),
      }
    } catch (error) {
      console.error('Error saving file:', error)
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:saveProject.errors.failedToSaveFile.title'),
          description: i18n.t('projectServiceResponses:saveProject.errors.failedToSaveFile.description', {
            filePath,
          }),
          error,
        },
      }
    }
  }
}

export { ProjectService }
