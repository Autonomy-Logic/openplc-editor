import { CONSTANTS } from '@shared/constants'
import { ipcMain } from 'electron'

import { mainWindow } from '../main'

const {
  channels: { get },
} = CONSTANTS

/**
 * Provides methods related to interacting with Program Organization Units (POUs).
 */
export const pou = {
  /**
   * Creates a new window for Program Organization Units.
   * Sends a message to the main window to trigger the action.
   */
  createWindow: () => {
    try {
      mainWindow?.webContents.send(get.CREATE_POU_WINDOW)
      return {
        ok: true,
        message: 'POU Window Created',
      }
    } catch (error: any) {
      return {
        ok: false,
        message: error.message,
      }
    }
  },
}

export const pouIpc = () => {
  ipcMain.handle(get.CREATE_POU_WINDOW, () => pou.createWindow())
}
