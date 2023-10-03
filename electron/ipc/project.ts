// import { createProjectController, getProjectController } from '../controllers'
// Wip: Using service directly on ipc
import { ProjectService } from '@electron/services'
import { store } from '@electron/store'
import { CONSTANTS } from '@shared/constants'
import { ipcMain } from 'electron'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { getWorkspace, mainWindow } from '../main'

const {
  channels: { get, set },
} = CONSTANTS

type GetProjectToSaveData = {
  xmlSerializedAsObject: XMLSerializedAsObject
  filePath: string
}

/**
 * Represents actions related to project data and IPC communication.
 */
export const project = {
  /**
   * Sends project data to the main window.
   * @param filePath - The path to the project file.
   */
  send: async (filePath: string) => {
    const response = await ProjectService.getProject(filePath)

    mainWindow?.webContents.send(get.PROJECT, {
      ...response,
      data: { ...response.data, filePath },
    })
  },
  /**
   * Returns a response listener for getting project data to save.
   * @returns A response listener function.
   */
  getProjectToSave: () => {
    mainWindow?.webContents.send(get.SAVE_PROJECT)
    const responseListener = (
      callback: (data?: GetProjectToSaveData) => void,
    ) => {
      ipcMain.handle(
        set.SAVE_PROJECT,
        async (_event, data: GetProjectToSaveData) => {
          callback(data)
          ipcMain.removeHandler(set.SAVE_PROJECT)
        },
      )
    }
    return responseListener
  },
}

/**
 * Sets up IPC event handling related to project actions.
 */
export const projectIpc = () => {
  ipcMain.handle(get.PROJECT, async (_event, filePath: string) => {
    const response = await ProjectService.getProject(filePath)
    return response
  })

  ipcMain.handle('info:workspace', () => {
    const response = getWorkspace()
    return response
  })

  ipcMain.handle(set.CREATE_PROJECT_FROM_TOOLBAR, async () => {
    const response = await ProjectService.createProject()
    return response
  })
}
