import { CompilerService } from '@root/main/services/compiler-service'
import { BrowserWindow, IpcMain } from 'electron/main'

import { ProjectService } from '../../../../services'
import { TStoreType } from '../store'

export type MainIpcModule = {
  ipcMain: IpcMain
  mainWindow: InstanceType<typeof BrowserWindow> | null
  compilerService: typeof CompilerService
  projectService: InstanceType<typeof ProjectService>
  store: TStoreType
  setupMainIpcListener: () => void
  mainIpcEventHandlers: {
    handleUpdateTheme: () => void
    createPou: () => void
  }
}

export type MainIpcModuleConstructor = {
  ipcMain: IpcMain
  mainWindow: InstanceType<typeof BrowserWindow> | null
  compilerService: typeof CompilerService
  projectService: InstanceType<typeof ProjectService>
  store: TStoreType
}
