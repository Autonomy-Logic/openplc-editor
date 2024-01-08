import { BrowserWindow, Event, IpcMain } from 'electron/main'

import { ProjectService } from '../../../../services'
import { ThemeDto } from '../../../dtos/theme.dto'
import { ProjectDto } from '../../services/project.service'
import { TStoreType } from '../store'
import { ToastProps } from './toast'

export type MainIpcModule = {
	ipcMain: IpcMain
	mainWindow: InstanceType<typeof BrowserWindow> | null
	projectService: InstanceType<typeof ProjectService>
	store: TStoreType
	setupMainIpcListener: () => void
	mainIpcEventHandlers: {
		createPou: () => void
		getTheme: () => ThemeDto
		setTheme: (event: Event, arg: ThemeDto) => void
		saveProject: (_event: Event, arg: ProjectDto) => void
		sendToast: (arg: ToastProps) => void
	}
}

export type MainIpcModuleConstructor = {
	ipcMain: IpcMain
	mainWindow: InstanceType<typeof BrowserWindow> | null
	projectService: InstanceType<typeof ProjectService>
	store: TStoreType
}
