import { iterateWriteProjectFiles } from '@root/backend/shared/project/iterate-write-project-files'
import { projectDefaultFilesMapSchema } from '@root/backend/shared/project/project-files-schema'
import { PLCProject } from '@root/backend/shared/types/PLC/open-plc'
import { getDefaultSchemaValues } from '@root/backend/shared/utils/default-zod-schema-values'
import type { WriteProjectFiles } from '@root/middleware/shared/ports/project-port'
import {
  CreateProjectFileProps,
  IProjectRecentHistoryEntry,
  IProjectServiceResponse,
} from '@root/types/IPC/project-service'
import { app, BrowserWindow, dialog } from 'electron'
import { promises } from 'fs'
import { dirname, join, normalize } from 'path'

import { fileOrDirectoryExists } from '../../utils'
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
   * Recursively delete a project directory from disk and drop its entry
   * from the recent-projects history. Used by the start screen's "Delete
   * project" 3-dot-menu action.
   *
   * Safety gate: refuses to delete a directory that doesn't contain a
   * top-level `project.json`. Without this, a corrupt history file
   * pointing at an arbitrary path (e.g. `/Users/foo/Documents`) would
   * silently `rm -rf` it. The gate makes the operation no-op against
   * any path that isn't an OpenPLC project root.
   *
   * Returns `{ success: true }` on actual deletion; `{ success: false,
   * error }` when the gate trips or fs.rm fails. The history entry is
   * dropped on either success OR a `project.json`-missing error
   * (renderer-side: a missing project.json means the project is gone
   * already; keeping the stale entry in the recent list serves no
   * one), but NOT on other fs errors (permission denied, etc.) so the
   * user can retry after fixing the cause.
   */
  async deleteProject(projectPath: string): Promise<{ success: boolean; error?: string }> {
    const directoryPath = projectPath.endsWith('/project.json')
      ? projectPath.slice(0, -'/project.json'.length)
      : projectPath
    const projectJsonPath = join(directoryPath, 'project.json')

    let projectJsonExists = false
    try {
      const stat = await promises.stat(projectJsonPath)
      projectJsonExists = stat.isFile()
    } catch {
      projectJsonExists = false
    }

    if (!projectJsonExists) {
      // Stale entry — wipe from history but don't touch disk.
      await this.removeProjectFromHistory(directoryPath)
      return {
        success: false,
        error: `Path "${directoryPath}" does not contain a project.json. Removed the entry from the recent list.`,
      }
    }

    try {
      await promises.rm(directoryPath, { recursive: true, force: true })
    } catch (err) {
      return {
        success: false,
        error: `Failed to delete project directory: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    await this.removeProjectFromHistory(directoryPath)
    return { success: true }
  }

  /**
   * Read all project files as raw strings — no parsing, no transformation.
   * The frontend is responsible for parsing the returned content.
   */
  async readRawProjectFiles(projectPath: string): Promise<{
    success: boolean
    data?: {
      projectPath: string
      projectJson: string
      deviceConfig: string
      pinMapping: string
      libraryManifest: string
      pouFiles: Array<{ relativePath: string; content: string }>
      serverFiles: Array<{ relativePath: string; content: string }>
      remoteDeviceFiles: Array<{ relativePath: string; content: string }>
    }
    error?: { title: string; description: string }
  }> {
    const VALID_POU_EXTENSIONS = ['.st', '.il', '.ld', '.fbd', '.py', '.cpp', '.json']

    try {
      await promises.access(projectPath)

      // Validate that the directory contains a project.json file
      try {
        await promises.access(join(projectPath, 'project.json'))
      } catch {
        return {
          success: false,
          error: {
            title: 'Invalid project',
            description: 'The selected directory is not a valid OpenPLC project.',
          },
        }
      }

      /**
       * Read a default config file, creating it with schema defaults if missing or empty.
       * This mirrors the old backend's readAndParseFile behavior.
       */
      const readOrCreateDefault = async (
        filePath: string,
        schemaKey: keyof typeof projectDefaultFilesMapSchema,
      ): Promise<string> => {
        let content: string
        try {
          content = await promises.readFile(filePath, 'utf-8')
        } catch {
          content = ''
        }
        if (!content.trim()) {
          const schema = projectDefaultFilesMapSchema[schemaKey]
          const defaultValue = getDefaultSchemaValues(schema)
          const defaultJson = JSON.stringify(defaultValue, null, 2)
          const dir = dirname(filePath)
          await promises.mkdir(dir, { recursive: true })
          await promises.writeFile(filePath, defaultJson, 'utf-8')
          return defaultJson
        }
        return content
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
              const ext = entry.name.slice(entry.name.lastIndexOf('.'))
              if (!VALID_POU_EXTENSIONS.includes(ext)) continue
              const content = await promises.readFile(fullPath, 'utf-8')
              results.push({ relativePath: relPath, content })
            }
          }
        } catch {
          // Directory doesn't exist — return empty
        }
        return results
      }

      const projectJson = await readOrCreateDefault(join(projectPath, 'project.json'), 'project.json')
      const deviceConfig = await readOrCreateDefault(
        join(projectPath, 'devices', 'configuration.json'),
        'devices/configuration.json',
      )
      const pinMapping = await readOrCreateDefault(
        join(projectPath, 'devices', 'pin-mapping.json'),
        'devices/pin-mapping.json',
      )

      const pouDirs = ['pous/functions', 'pous/function-blocks', 'pous/programs']
      const pouFiles: Array<{ relativePath: string; content: string }> = []
      for (const pouDir of pouDirs) {
        const files = await readDirRecursive(join(projectPath, ...pouDir.split('/')), pouDir)
        pouFiles.push(...files)
      }

      const serverFiles = await readDirRecursive(join(projectPath, 'devices', 'servers'), 'devices/servers')
      const remoteDeviceFiles = await readDirRecursive(join(projectPath, 'devices', 'remote'), 'devices/remote')

      // Library projects own a `library.json` at the project root.
      // Read it as a plain string (parsing happens upstream in the
      // build pipeline + manifest editor — same convention POUs use:
      // raw bytes here, structure upstream).  Empty string for PLC
      // projects and for libraries whose disk shape is missing the
      // file; the manifest editor seeds a template on first save.
      let libraryManifest = ''
      try {
        libraryManifest = await promises.readFile(join(projectPath, 'library.json'), 'utf-8')
      } catch {
        // No library.json on disk — not a library, or a library
        // whose manifest was never persisted.  Leave empty.
      }

      return {
        success: true,
        data: {
          projectPath,
          projectJson,
          deviceConfig,
          pinMapping,
          libraryManifest,
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

  /**
   * Write pre-serialized project files to disk.
   * The frontend handles all serialization — this method is a dumb batch file writer.
   *
   * The "which files exist in a save" enumeration lives in the
   * shared `iterateWriteProjectFiles` so the web adapter's API
   * envelope packer walks the same category list — no more
   * hand-maintained twin lists drifting when a new file category
   * (like `library.json`) gets added.
   */
  async writeProjectFiles(files: WriteProjectFiles): Promise<IProjectServiceResponse> {
    const { projectPath, deletions } = files

    if (!projectPath) {
      return {
        success: false,
        error: { title: 'Missing parameters', description: 'Missing project path', error: null },
      }
    }

    const normalized = projectPath.replace(/\\/g, '/')
    const dir = normalized.endsWith('/project.json') ? normalized.slice(0, -'/project.json'.length) : normalized

    try {
      // Defensive mkdir for the project's canonical directory shape.
      // Keeps these paths present even when the corresponding file
      // arrays are empty (e.g. fresh library with no servers yet),
      // so callers can rely on them existing.
      await Promise.all(
        ['pous/programs', 'pous/functions', 'pous/function-blocks', 'devices/servers', 'devices/remote'].map((d) =>
          promises.mkdir(join(dir, d), { recursive: true }),
        ),
      )

      // Single source of truth for the file shape lives in the
      // shared iterator.  Each yielded entry is one independent
      // file write; the batch fans out in parallel since paths
      // are distinct and mkdir(recursive) is idempotent.
      await Promise.all(
        Array.from(iterateWriteProjectFiles(files), async (entry) => {
          const filePath = join(dir, entry.relativePath)
          await promises.mkdir(dirname(filePath), { recursive: true })
          await promises.writeFile(filePath, entry.content, 'utf-8')
        }),
      )

      // Process deletions
      for (const relativePath of deletions) {
        const filePath = join(dir, relativePath)
        try {
          if (fileOrDirectoryExists(filePath)) {
            await promises.unlink(filePath)
          }
        } catch (deleteError) {
          console.error(`Error deleting file ${filePath}:`, deleteError)
        }
      }

      return { success: true, message: 'Your project was saved successfully' }
    } catch (error) {
      console.error('Error writing project files:', error)
      return {
        success: false,
        error: { title: 'Failed to save project', description: 'Unable to write project files.', error },
      }
    }
  }

  async saveFile(filePath: string, content: string): Promise<IProjectServiceResponse> {
    try {
      if (!fileOrDirectoryExists(filePath)) {
        const dir = dirname(filePath)
        await promises.mkdir(dir, { recursive: true })
      }

      await promises.writeFile(filePath, content, 'utf-8')

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
