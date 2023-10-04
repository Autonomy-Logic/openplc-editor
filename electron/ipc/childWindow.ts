import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'

import { CONSTANTS } from '../../shared/constants'
import {
  ChildWindowProps,
  childWindowSchema,
} from '../../shared/types/childWindow'
import { mainWindow } from '../main'

const {
  channels: { set },
} = CONSTANTS

/**
 * Sets up IPC event handling for creating child windows.
 * @returns A status object indicating successful setup.
 */
export const childWindowIpc = () => {
  ipcMain.handle(set.CREATE_CHILD_WINDOW, (_, arg: ChildWindowProps) => {
    // Extract necessary properties from the argument and validate them
    const { path, hideMenuBar, ...newWindow } = childWindowSchema.parse(arg)
    const url = process.env.VITE_DEV_SERVER_URL
    const indexHtml = join(process.env.DIST, 'index.html')

    // Create a new BrowserWindow instance
    const childWindow = new BrowserWindow({
      icon: join(process.env.PUBLIC, 'favicon.ico'),
      parent: mainWindow as BrowserWindow,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      ...newWindow,
    })

    // Hide the menu bar if specified
    if (hideMenuBar) childWindow.setMenu(null)

    // Load the URL based on the environment
    if (process.env.VITE_DEV_SERVER_URL) {
      childWindow.loadURL(`${url}${path}`)
    } else {
      childWindow.loadFile(indexHtml, { hash: path })
    }
  })

  // Return a status object indicating successful setup
  return { ok: true }
}
