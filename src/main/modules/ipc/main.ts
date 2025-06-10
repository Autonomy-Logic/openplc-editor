import { app, nativeTheme, shell } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { platform } from 'process'

import { ProjectState } from '../../../renderer/store/slices'
import { PLCProject } from '../../../types/PLC/open-plc'
import { MainIpcModule, MainIpcModuleConstructor } from '../../contracts/types/modules/ipc/main'
import { logger } from '../../services'
import { CreateProjectFile, GetProjectPath } from '../../services/project-service/utils'

type IDataToWrite = {
  projectPath: string
  projectData: PLCProject
}
type CreateProjectFileProps = {
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
  time: string
  type: 'plc-project' | 'plc-library'
  name: string
  path: string
}

class MainProcessBridge implements MainIpcModule {
  ipcMain
  mainWindow
  projectService
  store
  compilerService
  menuBuilder
  hardwareService

  constructor({
    ipcMain,
    mainWindow,
    projectService,
    store,
    compilerService,
    menuBuilder,
    hardwareService,
  }: MainIpcModuleConstructor) {
    this.ipcMain = ipcMain
    this.mainWindow = mainWindow
    this.projectService = projectService
    this.compilerService = compilerService
    this.store = store
    this.menuBuilder = menuBuilder
    this.hardwareService = hardwareService
  }

  setupMainIpcListener() {
    this.ipcMain.handle('open-external-link', async (_event, url: string) => {
      console.log('Opening external link:', url)
      try {
        console.log('Opening external link:', url)
        await shell.openExternal(url)
        return { success: true }
      } catch (error) {
        console.log('Opening external link:', url)
        console.error('Error opening external link:', error)
        return { success: false, error }
      }
    })
    this.ipcMain.handle('project:create', async () => {
      const response = await this.projectService.createProject()
      return response
    })
    this.ipcMain.handle('project:open', async () => {
      const response = await this.projectService.openProject()
      return response
    })

    /**
     * BAD CODE!!!!
     * We define two handles for one flow
     */

    this.ipcMain.handle('project:path-picker', async (_event) => {
      const windowManager = this.mainWindow
      try {
        if (windowManager) {
          const res = await GetProjectPath(windowManager)
          return res
        }
        console.log('Window object not defined')
      } catch (error) {
        console.error('Error getting project path:', error)
      }
    })
    this.ipcMain.handle('project:create-project-file', (_event, dataToCreateProjectFile: CreateProjectFileProps) => {
      const res = CreateProjectFile(dataToCreateProjectFile)
      if (res.success) {
        void this.projectService.updateProjectHistory(
          dataToCreateProjectFile.path + `${platform === 'win32' ? '\\' : '/'}project.json`,
        )
      }
      return res
    })

    this.ipcMain.handle('project:save', (_event, { projectPath, projectData }: IDataToWrite) =>
      this.projectService.saveProject({ projectPath, projectData }),
    )

    this.ipcMain.handle('system:get-system-info', () => {
      return {
        OS: platform,
        architecture: 'x64',
        prefersDarkMode: nativeTheme.shouldUseDarkColors,
        isWindowMaximized: this.mainWindow?.isMaximized(),
      }
    })
    this.ipcMain.handle('project:open-by-path', async (_event, projectPath: string) => {
      try {
        const response = await this.projectService.openProjectByPath(projectPath)
        return response
      } catch (_error) {
        return {
          success: false,
          error: {
            title: 'Error opening project',
            description: 'Please try again',
          },
        }
      }
    })
    this.ipcMain.handle('app:store-retrieve-recent', async () => {
      const pathToUserDataFolder = join(app.getPath('userData'), 'User')
      const pathToUserHistoryFolder = join(pathToUserDataFolder, 'History')
      const projectsFilePath = join(pathToUserHistoryFolder, 'projects.json')
      const response = await this.projectService.readProjectHistory(projectsFilePath)
      try {
        return response
      } catch (error) {
        console.error('Error reading history file:', error)
        return []
      }
    })
    this.ipcMain.on('app:quit', () => {
      if (this.mainWindow) {
        this.mainWindow.destroy()
      }
      app.quit()
    })
    // this.ipcMain.on('app:reply-if-app-is-closing', (_, shouldQuit) => {
    //   if (!shouldQuit) return
    //   this.mainWindow?.destroy()
    //   app.exit(0)
    // })

    this.ipcMain.on('system:update-theme', () => this.mainIpcEventHandlers.handleUpdateTheme())
    // this.ipcMain.handle('app:store-get', this.mainIpcEventHandlers.getStoreValue)
    // This is only for MacOS

    /**
     * Compiler Service
     */

    // !! UNDER DEVELOPMENT !!
    this.ipcMain.on('compiler:setup-environment', (event) => {
      const [replyPort] = event.ports
      void this.compilerService.setupEnvironment(replyPort)
    })

    this.ipcMain.handle('compiler:create-build-directory', (_ev, pathToUserProject: string) =>
      this.compilerService.createBuildDirectoryIfNotExist(pathToUserProject),
    )
    this.ipcMain.handle(
      'compiler:export-project-xml',
      (_ev, pathToUserProject: string, dataToCreateXml: ProjectState['data'], parseTo: 'old-editor' | 'codesys') =>
        this.compilerService.createXmlFile(pathToUserProject, dataToCreateXml, parseTo),
    )
    this.ipcMain.handle(
      'compiler:build-xml-file',
      (_ev, pathToUserProject: string, dataToCreateXml: ProjectState['data']) =>
        this.compilerService.buildXmlFile(pathToUserProject, dataToCreateXml),
    )
    /**
     * This is a mock implementation to be used as a presentation.
     * !! Do not use this on production !!
     */
    this.ipcMain.on('compiler:build-st-program', (event, pathToXMLFile: string) => {
      const [replyPort] = event.ports
      this.compilerService.compileSTProgram(pathToXMLFile, replyPort)
    })
    this.ipcMain.on('compiler:generate-c-files', (event, pathToStProgram: string) => {
      const [replyPort] = event.ports
      this.compilerService.generateCFiles(pathToStProgram, replyPort)
    })

    /**
     * Window Controls
     */
    this.ipcMain.on('window-controls:close', () => this.mainWindow?.close())
    this.ipcMain.on('window-controls:closed', () => this.mainWindow?.destroy())
    this.ipcMain.on('window-controls:hide', () => this.mainWindow?.hide())
    this.ipcMain.on('window-controls:minimize', () => this.mainWindow?.minimize())
    this.ipcMain.on('window-controls:maximize', () => {
      if (this.mainWindow?.isMaximized()) {
        this.mainWindow?.restore()
      } else {
        this.mainWindow?.maximize()
      }
    })
    /**
     * Window
     */
    this.ipcMain.on('window:reload', () => this.mainWindow?.webContents.reload())
    this.ipcMain.on('window:rebuild-menu', () => void this.menuBuilder.buildMenu())
    /**
     * Hardware
     */
    this.ipcMain.handle('hardware:device-configuration-options', this.hardwareService.getDeviceConfigurationOptions.bind(this.hardwareService))
    this.ipcMain.handle('hardware:refresh-communication-ports', async () =>
      this.hardwareService.getAvailableSerialPorts(),
    )
    this.ipcMain.handle('hardware:refresh-available-boards', async () => this.hardwareService.getAvailableBoards())
    /**
     * Utilities
     */
    this.ipcMain.handle('util:get-preview-image', async (_event, image: string) => {
      if (image === '') return

      const isDevelopment = process.env.NODE_ENV === 'development'

      const previewImage = join(
        isDevelopment ? process.cwd() : process.resourcesPath,
        isDevelopment ? 'resources' : '',
        'runtime',
        'previews',
        image,
      )

      const imageBuffer = await readFile(previewImage)

      const mimeType = 'image/png'

      const base64 = imageBuffer.toString('base64')

      return `data:${mimeType};base64,${base64}`
    })
    this.ipcMain.on('util:log', (_, { level, message }: { level: 'info' | 'error'; message: string }) => {
      logger[level](message)
    })
  }

  mainIpcEventHandlers = {
    handleUpdateTheme: () => {
      nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'
    },
    createPou: () => this.mainWindow?.webContents.send('pou:createPou', { ok: true }),
  }
}

export default MainProcessBridge
