import { CONSTANTS } from '@shared/constants'
import { ipcMain } from 'electron'

import { createProjectController, getProjectController } from '../controllers'
import { mainWindow } from '../main'

const {
  channels: { get, set },
} = CONSTANTS

export const project = {
  send: async (path: string) => {
    const response = await getProjectController.handle(path)
    mainWindow?.webContents.send(get.PROJECT, response)
  },
}

export const projectIpc = () => {
  ipcMain.handle(get.PROJECT, async (_event, path) => {
    const response = await getProjectController.handle(path)
    return response
  })

  ipcMain.handle(set.CREATE_PROJECT_FROM_TOOLBAR, async () => {
    const response = await createProjectController.handle()
    return response
  })
}
