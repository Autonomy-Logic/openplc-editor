import {
  CreateProjectFileProps,
  IProjectRecentHistoryEntry,
  IProjectServiceResponse,
} from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { getExtensionFromLanguage } from '@root/utils/PLC/pou-file-extensions'
import { serializePouToText } from '@root/utils/PLC/pou-text-serializer'
import { app, BrowserWindow, dialog } from 'electron'
import { promises } from 'fs'
import { dirname, join, normalize } from 'path'

import { PLCPou, PLCProject, PLCRemoteDevice, PLCServer } from '../../../types/PLC/open-plc'
import { fileOrDirectoryExists, ipcPouToFlat } from '../../utils'
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
      return ((JSON.parse(projectFile) as PLCProject).meta.name as string) || 'Unknown project'
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

  /**
   * Read all project files as raw strings — no parsing, no transformation.
   * The frontend is responsible for parsing the returned content.
   */
  async readRawProjectFiles(
    projectPath: string,
  ): Promise<{
    success: boolean
    data?: {
      projectPath: string
      projectJson: string
      deviceConfig: string
      pinMapping: string
      pouFiles: Array<{ relativePath: string; content: string }>
      serverFiles: Array<{ relativePath: string; content: string }>
      remoteDeviceFiles: Array<{ relativePath: string; content: string }>
    }
    error?: { title: string; description: string }
  }> {
    try {
      await promises.access(projectPath)

      const readFileIfExists = async (filePath: string): Promise<string> => {
        try {
          return await promises.readFile(filePath, 'utf-8')
        } catch {
          return ''
        }
      }

      const readDirRecursive = async (
        dirPath: string,
        basePath: string,
      ): Promise<Array<{ relativePath: string; content: string }>> => {
        const results: Array<{ relativePath: string; content: string }> = []
        try {
          const entries = await promises.readdir(dirPath, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = join(dirPath, entry.name)
            const relPath = join(basePath, entry.name)
            if (entry.isDirectory()) {
              const subResults = await readDirRecursive(fullPath, relPath)
              results.push(...subResults)
            } else if (entry.isFile()) {
              const content = await promises.readFile(fullPath, 'utf-8')
              results.push({ relativePath: relPath, content })
            }
          }
        } catch {
          // Directory doesn't exist — return empty
        }
        return results
      }

      const projectJson = await readFileIfExists(join(projectPath, 'project.json'))
      const deviceConfig = await readFileIfExists(join(projectPath, 'devices', 'configuration.json'))
      const pinMapping = await readFileIfExists(join(projectPath, 'devices', 'pin-mapping.json'))

      const pouDirs = ['pous/functions', 'pous/function-blocks', 'pous/programs']
      const pouFiles: Array<{ relativePath: string; content: string }> = []
      for (const pouDir of pouDirs) {
        const files = await readDirRecursive(join(projectPath, ...pouDir.split('/')), pouDir)
        pouFiles.push(...files)
      }

      const serverFiles = await readDirRecursive(join(projectPath, 'devices', 'servers'), 'devices/servers')
      const remoteDeviceFiles = await readDirRecursive(
        join(projectPath, 'devices', 'remote'),
        'devices/remote',
      )

      return {
        success: true,
        data: {
          projectPath,
          projectJson,
          deviceConfig,
          pinMapping,
          pouFiles,
          serverFiles,
          remoteDeviceFiles,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: {
          title: 'Error reading project files',
          description: error instanceof Error ? error.message : 'Unknown error',
        },
      }
    }
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
            title: 'Failed to read project',
            description: 'Could not read the project. Please check the project directory.',
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
          title: 'Failed to read project',
          description: 'Could not read the project. Please check the project directory.',
          error: error,
        },
      }
    }
  }

  async openProject(): Promise<IProjectServiceResponse> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.serviceManager, {
      title: 'Select a PLC project to open',
      properties: ['openDirectory'],
    })

    if (canceled) {
      return {
        success: false,
        error: {
          title: 'Operation canceled',
          description: 'Operation canceled by the user.',
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
            title: 'Failed to read project',
            description: 'Could not read the project. Please check the project directory.',
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
          title: 'Failed to read project',
          description: 'Could not read the project. Please check the project directory.',
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
      servers?: PLCServer[]
      remoteDevices?: PLCRemoteDevice[]
    }
  }): Promise<IProjectServiceResponse> {
    const {
      projectPath,
      content: { deviceConfiguration, devicePinMapping, projectData, servers, remoteDevices },
    } = data
    if (!projectPath || !projectData) {
      return {
        success: false,
        error: {
          title: 'Missing parameters',
          description: 'Missing parameters',
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
          title: 'Failed to save file',
          description: 'Unable to save the project file.',
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
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          const flat = ipcPouToFlat(pou)
          const extension: string = getExtensionFromLanguage(flat.body.language)
          const filePath = join(dir, `${flat.name}${extension}`)
          const textContent: string = serializePouToText(flat)
          await promises.writeFile(filePath, textContent, 'utf-8')
        }
      }

      if (projectData.data.deletedPous && projectData.data.deletedPous.length > 0) {
        for (const deletedPou of projectData.data.deletedPous) {
          const typeDir =
            deletedPou.type === 'function'
              ? 'functions'
              : deletedPou.type === 'function-block'
                ? 'function-blocks'
                : 'programs'
          const extension = getExtensionFromLanguage(deletedPou.language)
          const filePath = join(directoryPath, 'pous', typeDir, `${deletedPou.name}${extension}`)

          try {
            if (fileOrDirectoryExists(filePath)) {
              await promises.unlink(filePath)
            }
          } catch (deleteError) {
            console.error(`Error deleting POU file ${filePath}:`, deleteError)
          }

          const jsonFilePath = join(directoryPath, 'pous', typeDir, `${deletedPou.name}.json`)
          try {
            if (fileOrDirectoryExists(jsonFilePath)) {
              await promises.unlink(jsonFilePath)
            }
          } catch (deleteError) {
            console.error(`Error deleting legacy JSON POU file ${jsonFilePath}:`, deleteError)
          }
        }
      }
    } catch (error) {
      console.error('Error saving POUs:', error)
      return {
        success: false,
        error: {
          title: 'Failed to save file',
          description: 'Unable to save the project file.',
          error,
        },
      }
    }

    // Save servers
    if (
      (servers && servers.length > 0) ||
      (projectData.data.deletedServers && projectData.data.deletedServers.length > 0)
    ) {
      try {
        const serversDir = join(directoryPath, 'devices', 'servers')
        if (!fileOrDirectoryExists(serversDir)) {
          await promises.mkdir(serversDir, { recursive: true })
        }

        if (servers && servers.length > 0) {
          for (const server of servers) {
            const serverFilePath = join(serversDir, `${server.name}.json`)
            await promises.writeFile(serverFilePath, JSON.stringify(server, null, 2), 'utf-8')
          }
        }

        // Handle deleted servers
        if (projectData.data.deletedServers && projectData.data.deletedServers.length > 0) {
          for (const deletedServer of projectData.data.deletedServers) {
            const serverFilePath = join(serversDir, `${deletedServer.name}.json`)
            try {
              if (fileOrDirectoryExists(serverFilePath)) {
                await promises.unlink(serverFilePath)
              }
            } catch (deleteError) {
              console.error(`Error deleting server file ${serverFilePath}:`, deleteError)
            }
          }
        }
      } catch (error) {
        console.error('Error saving servers:', error)
        return {
          success: false,
          error: {
            title: 'Failed to save file',
            description: 'Unable to save the project file.',
            error,
          },
        }
      }
    }

    // Save remote devices
    if (
      (remoteDevices && remoteDevices.length > 0) ||
      (projectData.data.deletedRemoteDevices && projectData.data.deletedRemoteDevices.length > 0)
    ) {
      try {
        const remoteDevicesDir = join(directoryPath, 'devices', 'remote')
        if (!fileOrDirectoryExists(remoteDevicesDir)) {
          await promises.mkdir(remoteDevicesDir, { recursive: true })
        }

        if (remoteDevices && remoteDevices.length > 0) {
          for (const remoteDevice of remoteDevices) {
            const remoteDeviceFilePath = join(remoteDevicesDir, `${remoteDevice.name}.json`)
            await promises.writeFile(remoteDeviceFilePath, JSON.stringify(remoteDevice, null, 2), 'utf-8')
          }
        }

        // Handle deleted remote devices
        if (projectData.data.deletedRemoteDevices && projectData.data.deletedRemoteDevices.length > 0) {
          for (const deletedRemoteDevice of projectData.data.deletedRemoteDevices) {
            const remoteDeviceFilePath = join(remoteDevicesDir, `${deletedRemoteDevice.name}.json`)
            try {
              if (fileOrDirectoryExists(remoteDeviceFilePath)) {
                await promises.unlink(remoteDeviceFilePath)
              }
            } catch (deleteError) {
              console.error(`Error deleting remote device file ${remoteDeviceFilePath}:`, deleteError)
            }
          }
        }
      } catch (error) {
        console.error('Error saving remote devices:', error)
        return {
          success: false,
          error: {
            title: 'Failed to save file',
            description: 'Unable to save the project file.',
            error,
          },
        }
      }
    }

    return {
      success: true,
      message: 'Your project was saved successfully',
    }
  }

  async saveFile(filePath: string, content: unknown): Promise<IProjectServiceResponse> {
    try {
      if (!fileOrDirectoryExists(filePath)) {
        const dir = dirname(filePath)
        await promises.mkdir(dir, { recursive: true })
      }

      if (typeof content === 'string') {
        // Pre-serialized content from frontend — write as-is
        await promises.writeFile(filePath, content, 'utf-8')
      } else {
        const isPou = typeof content === 'object' && content !== null && 'type' in content && 'data' in content

        if (isPou) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          const flat = ipcPouToFlat(content as PLCPou)

          let actualFilePath = filePath
          if (filePath.endsWith('.json')) {
            const extension: string = getExtensionFromLanguage(flat.body.language)
            actualFilePath = filePath.replace(/\.json$/, extension)
          }

          const textContent: string = serializePouToText(flat)
          await promises.writeFile(actualFilePath, textContent, 'utf-8')
        } else {
          await promises.writeFile(filePath, JSON.stringify(content, null, 2))
        }
      }

      return {
        success: true,
        message: 'Your project was saved successfully',
      }
    } catch (error) {
      console.error('Error saving file:', error)
      return {
        success: false,
        error: {
          title: 'Failed to save file',
          description: 'Unable to save the project file.',
          error,
        },
      }
    }
  }
}

export { ProjectService }
