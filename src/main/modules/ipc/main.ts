import { TStoreType } from '@root/main/contracts/types/modules/store'
import { Event, nativeTheme } from 'electron'
import { platform } from 'process'

import { PLCProjectData } from '../../../types/PLC/test'
import { MainIpcModule, MainIpcModuleConstructor } from '../../contracts/types/modules/ipc/main'

type IDataToWrite = {
  projectPath: string
  projectData: PLCProjectData
}

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
    this.ipcMain.handle('project:create', async () => {
      const response = await this.projectService.createProject()
      return response
    })
    this.ipcMain.handle('project:open', async () => {
      const response = await this.projectService.openProject()
      return response
    })

    this.ipcMain.handle('project:save', (_event, { projectPath, projectData }: IDataToWrite) =>
      this.projectService.saveProject({ projectPath, projectData }),
    )

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
    this.ipcMain.handle('app:store-get', this.mainIpcEventHandlers.getStoreValue)
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
