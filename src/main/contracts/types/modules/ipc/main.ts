import MenuBuilder from '@root/main/menu'
import { CompilerService } from '@root/main/services/compiler-service'
import { BrowserWindow, IpcMain } from 'electron/main'

import { HardwareService, PouService, ProjectService } from '../../../../services'
import { TStoreType } from '../store'

export type MainIpcModule = {
  ipcMain: IpcMain
  mainWindow: InstanceType<typeof BrowserWindow> | null
  compilerService: InstanceType<typeof CompilerService>
  projectService: InstanceType<typeof ProjectService>
  store: TStoreType
  setupMainIpcListener: () => void
  hardwareService: InstanceType<typeof HardwareService>
  mainIpcEventHandlers: {
    handleUpdateTheme: () => void
    createPou: () => void
  }
}

export type MainIpcModuleConstructor = {
  ipcMain: IpcMain
  mainWindow: InstanceType<typeof BrowserWindow> | null
  compilerService: InstanceType<typeof CompilerService>
  projectService: InstanceType<typeof ProjectService>
  store: TStoreType
  menuBuilder: InstanceType<typeof MenuBuilder>
  hardwareService: InstanceType<typeof HardwareService>
  pouService: InstanceType<typeof PouService>
}
