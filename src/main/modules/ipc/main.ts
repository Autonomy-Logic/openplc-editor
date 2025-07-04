import { getProjectPath } from '@root/main/utils'
import { CreateProjectFileProps } from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { app, nativeTheme, shell } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { platform } from 'process'

import { ProjectState } from '../../../renderer/store/slices'
import { PLCProject } from '../../../types/PLC/open-plc'
import { MainIpcModule, MainIpcModuleConstructor } from '../../contracts/types/modules/ipc/main'
import { logger } from '../../services'

type IDataToWrite = {
  projectPath: string
  content: {
    projectData: PLCProject
    deviceConfiguration: DeviceConfiguration
    devicePinMapping: DevicePin[]
  }
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

  // ===================== IPC HANDLER REGISTRATION =====================
  setupMainIpcListener() {
    // Project-related handlers
    this.ipcMain.handle('project:create', this.handleProjectCreate)
    this.ipcMain.handle('project:open', this.handleProjectOpen)
    this.ipcMain.handle('project:path-picker', this.handleProjectPathPicker)
    this.ipcMain.handle('project:save', this.handleProjectSave)
    this.ipcMain.handle('project:open-by-path', this.handleProjectOpenByPath)

    // App and system handlers
    this.ipcMain.handle('open-external-link', this.handleOpenExternalLink)
    this.ipcMain.handle('system:get-system-info', this.handleGetSystemInfo)
    this.ipcMain.handle('app:store-retrieve-recent', this.handleStoreRetrieveRecent)
    this.ipcMain.on('app:quit', this.handleAppQuit)
    // this.ipcMain.on('app:reply-if-app-is-closing', (_, shouldQuit) => { ... })

    // Theme and store handlers
    this.ipcMain.on('system:update-theme', this.mainIpcEventHandlers.handleUpdateTheme)
    // this.ipcMain.handle('app:store-get', this.mainIpcEventHandlers.getStoreValue)

    // ===================== COMPILER SERVICE =====================
    this.ipcMain.on('compiler:setup-environment', this.handleCompilerSetupEnvironment)
    this.ipcMain.handle('compiler:create-build-directory', this.handleCompilerCreateBuildDirectory)
    this.ipcMain.handle('compiler:export-project-xml', this.handleCompilerExportProjectXml)
    this.ipcMain.handle('compiler:build-xml-file', this.handleCompilerBuildXmlFile)
    this.ipcMain.on('compiler:build-st-program', this.handleCompilerBuildStProgram)
    this.ipcMain.on('compiler:generate-c-files', this.handleCompilerGenerateCFiles)

    // ===================== WINDOW CONTROLS =====================
    this.ipcMain.on('window-controls:close', this.handleWindowControlsClose)
    this.ipcMain.on('window-controls:closed', this.handleWindowControlsClosed)
    this.ipcMain.on('window-controls:hide', this.handleWindowControlsHide)
    this.ipcMain.on('window-controls:minimize', this.handleWindowControlsMinimize)
    this.ipcMain.on('window-controls:maximize', this.handleWindowControlsMaximize)
    this.ipcMain.on('window:reload', this.handleWindowReload)
    this.ipcMain.on('window:rebuild-menu', this.handleWindowRebuildMenu)

    // ===================== HARDWARE =====================
    this.ipcMain.handle('hardware:get-available-communication-ports', this.handleHardwareGetAvailableCommunicationPorts)
    this.ipcMain.handle('hardware:get-available-boards', this.handleHardwareGetAvailableBoards)
    this.ipcMain.handle('hardware:refresh-communication-ports', this.handleHardwareRefreshCommunicationPorts)
    this.ipcMain.handle('hardware:refresh-available-boards', this.handleHardwareRefreshAvailableBoards)

    // ===================== UTILITIES =====================
    this.ipcMain.handle('util:get-preview-image', this.handleUtilGetPreviewImage)
    this.ipcMain.on('util:log', this.handleUtilLog)
  }

  // ===================== HANDLER METHODS =====================
  // Project-related handlers
  handleProjectCreate = async (_event: IpcMainInvokeEvent, data: CreateProjectFileProps) => {
    const response = await this.projectService.createProject(data)
    return response
  }
  handleProjectOpen = async () => {
    const response = await this.projectService.openProject()
    return response
  }
  handleProjectPathPicker = async (_event: IpcMainInvokeEvent) => {
    const windowManager = this.mainWindow
    try {
      if (windowManager) {
        const res = await getProjectPath(windowManager)
        return res
      }
      console.log('Window object not defined')
    } catch (error) {
      console.error('Error getting project path:', error)
    }
  }
  handleProjectSave = (_event: IpcMainInvokeEvent, { projectPath, content }: IDataToWrite) =>
    this.projectService.saveProject({ projectPath, content })
  handleProjectOpenByPath = async (_event: IpcMainInvokeEvent, projectPath: string) => {
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
  }

  // App and system handlers
  handleOpenExternalLink = async (_event: IpcMainInvokeEvent, url: string) => {
    console.log('Opening external link:', url)
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error('Error opening external link:', error)
      return { success: false, error }
    }
  }
  handleGetSystemInfo = () => {
    return {
      OS: platform,
      architecture: 'x64',
      prefersDarkMode: nativeTheme.shouldUseDarkColors,
      isWindowMaximized: this.mainWindow?.isMaximized(),
    }
  }
  handleStoreRetrieveRecent = async () => {
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
  }
  handleAppQuit = () => {
    if (this.mainWindow) {
      this.mainWindow.destroy()
    }
    app.quit()
  }

  // Compiler service handlers
  handleCompilerSetupEnvironment = (event: IpcMainEvent) => {
    const replyPort = Array.isArray(event.ports) && event.ports.length > 0 ? event.ports[0] : undefined
    if (replyPort) {
      void this.compilerService.setupEnvironment(replyPort)
    }
  }
  handleCompilerCreateBuildDirectory = (_ev: IpcMainInvokeEvent, pathToUserProject: string) =>
    this.compilerService.createBuildDirectoryIfNotExist(pathToUserProject)
  handleCompilerExportProjectXml = (
    _ev: IpcMainInvokeEvent,
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
    parseTo: 'old-editor' | 'codesys',
  ) => this.compilerService.createXmlFile(pathToUserProject, dataToCreateXml, parseTo)
  handleCompilerBuildXmlFile = (
    _ev: IpcMainInvokeEvent,
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
  ) => this.compilerService.buildXmlFile(pathToUserProject, dataToCreateXml)
  handleCompilerBuildStProgram = (event: IpcMainEvent, pathToXMLFile: string) => {
    const replyPort = Array.isArray(event.ports) && event.ports.length > 0 ? event.ports[0] : undefined
    if (replyPort) {
      this.compilerService.compileSTProgram(pathToXMLFile, replyPort)
    }
  }
  handleCompilerGenerateCFiles = (event: IpcMainEvent, pathToStProgram: string) => {
    const replyPort = Array.isArray(event.ports) && event.ports.length > 0 ? event.ports[0] : undefined
    if (replyPort) {
      this.compilerService.generateCFiles(pathToStProgram, replyPort)
    }
  }

  // Window controls handlers
  handleWindowControlsClose = () => this.mainWindow?.close()
  handleWindowControlsClosed = () => this.mainWindow?.destroy()
  handleWindowControlsHide = () => this.mainWindow?.hide()
  handleWindowControlsMinimize = () => this.mainWindow?.minimize()
  handleWindowControlsMaximize = () => {
    if (this.mainWindow?.isMaximized()) {
      this.mainWindow?.restore()
    } else {
      this.mainWindow?.maximize()
    }
  }
  handleWindowReload = () => this.mainWindow?.webContents.reload()
  handleWindowRebuildMenu = () => void this.menuBuilder.buildMenu()

  // Hardware handlers
  handleHardwareGetAvailableCommunicationPorts = async () => {
    try {
      const response = await this.hardwareService.getAvailableSerialPorts()
      return response
    } catch (error) {
      logger.error('Error getting available communication ports:', error)
      return []
    }
  }
  handleHardwareGetAvailableBoards = async () => {
    try {
      const response = await this.hardwareService.getAvailableBoards()
      return response
    } catch (error) {
      logger.error('Error getting available boards:', error)
      return []
    }
  }
  handleHardwareRefreshCommunicationPorts = async () => this.hardwareService.getAvailableSerialPorts()
  handleHardwareRefreshAvailableBoards = async () => this.hardwareService.getAvailableBoards()

  // Utility handlers
  handleUtilGetPreviewImage = async (_event: IpcMainInvokeEvent, image: string) => {
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
  }
  handleUtilLog = (_: IpcMainEvent, { level, message }: { level: 'info' | 'error'; message: string }) => {
    logger[level](message)
  }

  // ===================== EVENT HANDLERS =====================
  mainIpcEventHandlers = {
    handleUpdateTheme: () => {
      nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'
    },
    createPou: () => this.mainWindow?.webContents.send('pou:createPou', { ok: true }),
  }
}

export default MainProcessBridge
