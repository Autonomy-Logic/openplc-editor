import MenuBuilder from '../../../../../../main/menu'
import { CompilerModule } from '../../../../compiler'
import { HardwareModule } from '../../../../hardware'
import { BrowserWindow, IpcMain } from 'electron/main'

import { PouService, ProjectService } from '../../../../services'
import { TStoreType } from '../store'

export type MainIpcModule = {
  ipcMain: IpcMain
  mainWindow: InstanceType<typeof BrowserWindow> | null
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
  pouService: InstanceType<typeof PouService>
  projectService: InstanceType<typeof ProjectService>
  store: TStoreType
  menuBuilder: InstanceType<typeof MenuBuilder>
  compilerModule: InstanceType<typeof CompilerModule>
  hardwareModule: InstanceType<typeof HardwareModule>
}
