import { CONSTANTS } from '@shared/constants'
import { ipcMain } from 'electron'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { createProjectController, getProjectController } from '../controllers'
import { mainWindow } from '../main'

const {
  channels: { get, set },
} = CONSTANTS

type GetProjectToSaveData = {
  xmlSerializedAsObject: XMLSerializedAsObject
  filePath: string
}

export const project = {
  send: async (filePath: string) => {
    const response = await getProjectController.handle(filePath)

    mainWindow?.webContents.send(get.PROJECT, {
      ...response,
      data: { ...response.data, filePath },
    })
  },
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

export const projectIpc = () => {
  ipcMain.handle(get.PROJECT, async (_event, filePath: string) => {
    const response = await getProjectController.handle(filePath)
    return response
  })

  ipcMain.handle(set.CREATE_PROJECT_FROM_TOOLBAR, async () => {
    const response = await createProjectController.handle()
    return response
  })
}
