import { getProjectPath } from '@root/main/utils'
import { CreateProjectFileProps } from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { app, nativeTheme, shell } from 'electron'
import type { IncomingMessage } from 'http'
import https from 'https'
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
  menuBuilder
  compilerModule
  hardwareModule

  constructor({
    ipcMain,
    mainWindow,
    projectService,
    store,
    menuBuilder,
    compilerModule,
    hardwareModule,
  }: MainIpcModuleConstructor) {
    this.ipcMain = ipcMain
    this.mainWindow = mainWindow
    this.projectService = projectService
    this.store = store
    this.menuBuilder = menuBuilder
    this.compilerModule = compilerModule
    this.hardwareModule = hardwareModule
  }

  // ===================== RUNTIME API HANDLERS =====================
  private readonly RUNTIME_API_PORT = 8443

  handleRuntimeGetUsersInfo = async (_event: IpcMainInvokeEvent, ipAddress: string) => {
    try {
      const url = `https://${ipAddress}:${this.RUNTIME_API_PORT}/api/get-users-info`

      return new Promise((resolve) => {
        const req = https.get(
          url,
          {
            rejectUnauthorized: false,
          },
          (res: IncomingMessage) => {
            let data = ''
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString()
            })
            res.on('end', () => {
              if (res.statusCode === 404) {
                resolve({ hasUsers: false })
              } else if (res.statusCode === 200) {
                resolve({ hasUsers: true })
              } else {
                resolve({ hasUsers: false, error: data || `Unexpected status: ${res.statusCode}` })
              }
            })
          },
        )
        req.on('error', (error: Error) => {
          resolve({ hasUsers: false, error: error.message })
        })
        req.end()
      })
    } catch (error) {
      return { hasUsers: false, error: String(error) }
    }
  }

  handleRuntimeCreateUser = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    username: string,
    password: string,
  ) => {
    try {
      const postData = JSON.stringify({ username, password, role: 'user' })

      return new Promise((resolve) => {
        const req = https.request(
          {
            hostname: ipAddress,
            port: this.RUNTIME_API_PORT,
            path: '/api/create-user',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            },
            rejectUnauthorized: false,
          },
          (res: IncomingMessage) => {
            let data = ''
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString()
            })
            res.on('end', () => {
              if (res.statusCode === 201) {
                resolve({ success: true })
              } else {
                resolve({ success: false, error: data })
              }
            })
          },
        )
        req.on('error', (error: Error) => {
          resolve({ success: false, error: error.message })
        })
        req.write(postData)
        req.end()
      })
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  handleRuntimeLogin = async (_event: IpcMainInvokeEvent, ipAddress: string, username: string, password: string) => {
    try {
      const postData = JSON.stringify({ username, password })

      return new Promise((resolve) => {
        const req = https.request(
          {
            hostname: ipAddress,
            port: this.RUNTIME_API_PORT,
            path: '/api/login',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            },
            rejectUnauthorized: false,
          },
          (res: IncomingMessage) => {
            let data = ''
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString()
            })
            res.on('end', () => {
              if (res.statusCode === 200) {
                try {
                  const response = JSON.parse(data) as { access_token: string }
                  resolve({ success: true, accessToken: response.access_token })
                } catch {
                  resolve({ success: false, error: 'Invalid response format' })
                }
              } else {
                resolve({ success: false, error: data })
              }
            })
          },
        )
        req.on('error', (error: Error) => {
          resolve({ success: false, error: error.message })
        })
        req.write(postData)
        req.end()
      })
    } catch (error) {
      return { success: false, error: String(error) }
    }
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
    // TODO: This handle should be refactored to use MessagePortMain for better performance.
    this.ipcMain.handle('compiler:export-project-xml', this.handleCompilerExportProjectXml)
    this.ipcMain.on('compiler:run-compile-program', this.handleRunCompileProgram)

    // +++ !! Deprecated: These handlers are outdated and should be removed. +++

    // this.ipcMain.on('compiler:setup-environment', this.handleCompilerSetupEnvironment)
    // this.ipcMain.handle('compiler:create-build-directory', this.handleCompilerCreateBuildDirectory)
    // this.ipcMain.handle('compiler:build-xml-file', this.handleCompilerBuildXmlFile)
    // this.ipcMain.on('compiler:build-st-program', this.handleCompilerBuildStProgram)
    // this.ipcMain.on('compiler:generate-c-files', this.handleCompilerGenerateCFiles)

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

    // ===================== RUNTIME API =====================
    this.ipcMain.handle('runtime:get-users-info', this.handleRuntimeGetUsersInfo)
    this.ipcMain.handle('runtime:create-user', this.handleRuntimeCreateUser)
    this.ipcMain.handle('runtime:login', this.handleRuntimeLogin)
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
  // TODO: This handle should be refactored to use a new approach on module implementation.
  handleCompilerExportProjectXml = (
    _ev: IpcMainInvokeEvent,
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
    xmlFormatTarget: 'old-editor' | 'codesys',
  ) => this.compilerModule.createXmlFile(pathToUserProject, dataToCreateXml, xmlFormatTarget)

  handleRunCompileProgram = (event: IpcMainEvent, args: Array<string | ProjectState['data']>) => {
    const mainProcessPort = event.ports[0]
    void this.compilerModule.compileProgram(args, mainProcessPort)
  }

  // TODO: These handlers are outdated and should be removed.
  // handleCompilerSetupEnvironment = (event: IpcMainEvent) => {
  //   const replyPort = Array.isArray(event.ports) && event.ports.length > 0 ? event.ports[0] : undefined
  //   if (replyPort) {
  //     void this.compilerService.setupEnvironment(replyPort)
  //   }
  // }
  // handleCompilerCreateBuildDirectory = (_ev: IpcMainInvokeEvent, pathToUserProject: string) =>
  //   this.compilerService.createBuildDirectoryIfNotExist(pathToUserProject)
  // handleCompilerBuildXmlFile = (
  //   _ev: IpcMainInvokeEvent,
  //   pathToUserProject: string,
  //   dataToCreateXml: ProjectState['data'],
  // ) => this.compilerService.buildXmlFile(pathToUserProject, dataToCreateXml)
  // handleCompilerBuildStProgram = (event: IpcMainEvent, pathToXMLFile: string) => {
  //   const replyPort = Array.isArray(event.ports) && event.ports.length > 0 ? event.ports[0] : undefined
  //   if (replyPort) {
  //     this.compilerService.compileSTProgram(pathToXMLFile, replyPort)
  //   }
  // }
  // handleCompilerGenerateCFiles = (event: IpcMainEvent, pathToStProgram: string) => {
  //   const replyPort = Array.isArray(event.ports) && event.ports.length > 0 ? event.ports[0] : undefined
  //   if (replyPort) {
  //     this.compilerService.generateCFiles(pathToStProgram, replyPort)
  //   }
  // }

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
  handleHardwareGetAvailableCommunicationPorts = async () => this.hardwareModule.getAvailableSerialPorts()
  handleHardwareGetAvailableBoards = async () => this.hardwareModule.getAvailableBoards()
  handleHardwareRefreshCommunicationPorts = async () => this.hardwareModule.getAvailableSerialPorts()
  handleHardwareRefreshAvailableBoards = async () => this.hardwareModule.getAvailableBoards()

  // Utility handlers
  handleUtilGetPreviewImage = async (_event: IpcMainInvokeEvent, image: string) =>
    this.hardwareModule.getBoardImagePreview(image)
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
