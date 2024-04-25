import { BrowserWindow, Event, IpcMain } from 'electron/main'

import { ProjectService } from '../../../../services'
import { ProjectDto } from '../../services/project.service'
import { TStoreType } from '../store'

export type MainIpcModule = {
  ipcMain: IpcMain
  mainWindow: InstanceType<typeof BrowserWindow> | null
  projectService: InstanceType<typeof ProjectService>
  store: TStoreType
  setupMainIpcListener: () => void
  mainIpcEventHandlers: {
    createPou: () => void
    saveProject: (event: Event, arg: ProjectDto) => { ok: boolean; reason: { title: string; description: string } }
  }
}

export type MainIpcModuleConstructor = {
  ipcMain: IpcMain
  mainWindow: InstanceType<typeof BrowserWindow> | null
  projectService: InstanceType<typeof ProjectService>
  store: TStoreType
}
