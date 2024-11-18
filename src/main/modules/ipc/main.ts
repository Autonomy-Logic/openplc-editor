import {TStoreType} from '@root/main/contracts/types/modules/store'
import {app, Event, MessageChannelMain, nativeTheme, shell} from 'electron'
import {join} from 'path'
import {platform} from 'process'

import {PLCProject} from '../../../types/PLC/open-plc'
import {MainIpcModule, MainIpcModuleConstructor} from '../../contracts/types/modules/ipc/main'
import {CreateProjectFile, GetProjectPath} from '../../services/project-service/utils'

type IDataToWrite = {
    projectPath: string
    projectData: PLCProject
}
type CreateProjectFileProps = {
    language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
    time: string
    type: 'plc-project' | 'plc-library'
    name: string
    path: string
}

class MainProcessBridge implements MainIpcModule {
    ipcMain
    mainWindow
    projectService
    store
    compilerService

    constructor({ipcMain, mainWindow, projectService, store, compilerService}: MainIpcModuleConstructor) {
        this.ipcMain = ipcMain
        this.mainWindow = mainWindow
        this.projectService = projectService
        this.compilerService = compilerService
        this.store = store
    }

    setupMainIpcListener() {
        this.ipcMain.handle('open-external-link', async (_event, url: string) => {
            console.log('Opening external link:', url)
            try {
                console.log('Opening external link:', url)
                await shell.openExternal(url)
                return {success: true}
            } catch (error) {
                console.log('Opening external link:', url)
                console.error('Error opening external link:', error)
                return {success: false, error}
            }
        })

        this.ipcMain.handle('project:create', async () => {
            const response = await this.projectService.createProject()
            return response
        })
        this.ipcMain.handle('project:open', async () => {
            const response = await this.projectService.openProject()
            return response
        })

        /**
         * BAD CODE!!!!
         * We define two handles for one flow
         */

        this.ipcMain.handle('project:path-picker', async (_event) => {
            const windowManager = this.mainWindow
            try {
                if (windowManager) {
                    const res = await GetProjectPath(windowManager)
                    return res
                }
                console.log('Window object not defined')
            } catch (error) {
                console.error('Error getting project path:', error)
            }
        })
        this.ipcMain.handle('project:create-project-file', (_event, dataToCreateProjectFile: CreateProjectFileProps) => {
            const res = CreateProjectFile(dataToCreateProjectFile)
            if (res.success) {
                void this.projectService.updateProjectHistory(dataToCreateProjectFile.path + `${platform === 'win32' ? '\\' : '/'}project.json`)
            }
            return res
        })

        this.ipcMain.handle('project:save', (_event, {projectPath, projectData}: IDataToWrite) =>
            this.projectService.saveProject({projectPath, projectData}),
        )

        this.ipcMain.handle('system:get-system-info', () => {
            return {
                OS: platform,
                architecture: 'x64',
                prefersDarkMode: nativeTheme.shouldUseDarkColors,
                isWindowMaximized: this.mainWindow?.isMaximized(),
            }
        })
        this.ipcMain.handle('project:open-by-path', async (_event, projectPath: string) => {
            try {
                const response = await this.projectService.openProjectByPath(projectPath)
                console.log(response)
                return response
            } catch (error) {
                console.error('Error opening project:', error)
                return {
                    success: false,
                    error: {
                        title: 'Errror opening project',
                        description: 'Please try again',
                    },
                }
            }
        })
        this.ipcMain.handle('app:store-retrieve-recents', async () => {
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

        /**
         * Compiler Service
         */
        this.ipcMain.handle('compiler:write-xml-file', (_event, arg: {
            path: string;
            data: string;
            fileName: string
        }) => {
            return this.compilerService.writeXMLFile(arg.path, arg.data, arg.fileName)
        })

        /**
         * This is a mock implementation to be used as a presentation.
         * !! Do not use this on production !!
         */
        this.ipcMain.on('compiler:compile-st-program', (_event, pathToXMLFile: string) => {

            const {port1, port2} = new MessageChannelMain()

            // Pass one port to the compiler service
            this.compilerService.compileSTProgram(pathToXMLFile, port1)

            // return the second port to the renderer process
            _event.sender.postMessage('port', null, [port2])
        })
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
        createPou: () => this.mainWindow?.webContents.send('pou:createPou', {ok: true}),
        // saveProject: (_: Event, arg: ProjectDto) => {
        //   const response = this.projectService.saveProject(arg)
        //   return response
        // },
    }
}

export default MainProcessBridge
