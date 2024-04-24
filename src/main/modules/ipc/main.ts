import { Event, nativeTheme } from 'electron'
import { arch, platform } from 'process'

import { MainIpcModule, MainIpcModuleConstructor } from '../../contracts/types/modules/ipc/main'
import { ToastProps, ToastSchema } from '../../contracts/types/modules/ipc/toast'
import { ProjectDto } from '../../contracts/types/services/project.service'

class MainProcessBridge implements MainIpcModule {
  ipcMain
  mainWindow
  projectService
  store
  constructor({ ipcMain, mainWindow, projectService, store }: MainIpcModuleConstructor) {
    this.ipcMain = ipcMain
    this.mainWindow = mainWindow
    this.projectService = projectService
    this.store = store
  }

  handleThemeToggle() {
    const currentTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    nativeTheme.themeSource = currentTheme === 'dark' ? 'light' : 'dark'
    return nativeTheme.shouldUseDarkColors
  }
  setupMainIpcListener() {
    this.ipcMain.handle('app:toggle-theme', this.handleThemeToggle.bind(this))
    this.ipcMain.handle('app-preferences:get-theme', () => {
      return nativeTheme.shouldUseDarkColors
    })
    this.ipcMain.handle('start-screen/project:create', async () => {
      const response = await this.projectService.createProject()
      return response
    })

    this.ipcMain.handle('start-screen/project:open', async () => {
      const response = await this.projectService.openProject()
      return response
    })

    this.ipcMain.on('project:save-response', (_event, data: ProjectDto) => this.projectService.saveProject(data))
    /**
     * Send the OS information to the renderer process
     * Refactor: This can be optimized.
     */
    this.ipcMain.handle('system:get-system-info', () => {
      return {
        OS: platform,
        architecture: arch,
        prefersDarkMode: nativeTheme.shouldUseDarkColors,
      }
    })
    this.ipcMain.on('window-controls:close', () => this.mainWindow?.close())
    this.ipcMain.on('window-controls:minimize', () => this.mainWindow?.minimize())
    this.ipcMain.on('window-controls:maximize', () => {
      if (this.mainWindow?.isMaximized()) {
        this.mainWindow?.restore()
      } else {
        this.mainWindow?.maximize()
      }
    })
    this.ipcMain.on('window:reload', () => this.mainWindow?.webContents.reload())
    // Wip: From here
  }

  mainIpcEventHandlers = {
    createPou: () => this.mainWindow?.webContents.send('pou:createPou', { ok: true }),
    saveProject: (_: Event, arg: ProjectDto) => {
      const response = this.projectService.saveProject(arg)
      return response
    },
    sendToast: (arg: ToastProps) => {
      const message = ToastSchema.parse(arg)
      this.mainWindow?.webContents.send('get-toast', message)
    },
  }
}

export default MainProcessBridge
