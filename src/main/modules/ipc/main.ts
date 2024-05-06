import { TStoreType } from '@root/main/contracts/types/modules/store'
import { Event, nativeTheme } from 'electron'
import { platform } from 'process'

import { IProject } from '../../../types/PLC'
import { MainIpcModule, MainIpcModuleConstructor } from '../../contracts/types/modules/ipc/main'

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
  setupMainIpcListener() {
    this.ipcMain.handle('start-screen/project:create', async () => {
      const response = await this.projectService.createProject()
      return response
    })

    this.ipcMain.handle('start-screen/project:open', async () => {
      const response = await this.projectService.openProject()
      return response
    })
    this.ipcMain.handle('app:store-get', this.mainIpcEventHandlers.getStoreValue)
    // this.ipcMain.on('project:save-response', (_event, data: ProjectDto) => this.projectService.saveProject(data))
    /**
     * Send the OS information to the renderer process
     * Refactor: This can be optimized.
     */
    this.ipcMain.handle('system:get-system-info', () => {
      return { OS: platform, architecture: 'x64', prefersDarkMode: nativeTheme.shouldUseDarkColors }
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
    this.ipcMain.on('system:update-theme', () => this.mainIpcEventHandlers.handleUpdateTheme())
    this.ipcMain.handle(
      'project:save/write-data',
      (_event, { projectPath, projectData }: { projectPath: string; projectData: IProject }) =>
        this.projectService.saveProject({ projectPath, projectData }),
    )

    // Wip: From here
  }

  mainIpcEventHandlers = {
    handleUpdateTheme: () => {
      nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'
    },
    getStoreValue: (_: Event, key: keyof typeof this.store) => {
      const response = this.store.get(key)
      console.log(response)
      return response as unknown as TStoreType
    },
    createPou: () => this.mainWindow?.webContents.send('pou:createPou', { ok: true }),
    // saveProject: (_: Event, arg: ProjectDto) => {
    //   const response = this.projectService.saveProject(arg)
    //   return response
    // },
  }
}

export default MainProcessBridge
