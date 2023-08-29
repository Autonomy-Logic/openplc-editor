import { CONSTANTS } from '@shared/constants'

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
  createWindow: () => mainWindow?.webContents.send(get.CREATE_POU_WINDOW),
}
