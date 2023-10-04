import { release } from 'node:os'
import { join } from 'node:path'

import { setupTitlebar } from 'custom-electron-titlebar/main'
import { app, BrowserWindow } from 'electron'

import { bridge } from '../ipc'
import { createWindow } from './createWindow'

// Set environment variables for paths
process.env.DIST_ELECTRON = join(__dirname, '../')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')
process.env.PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

// Ensure only one instance of the application is running
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// Load the user's initial configurations; if they don't exist, create them.
bridge.userConfigIpc.setInitialWorkspaceConfigs()

// Remove electron security warnings
// This warning only shows in development mode
// Read more on https://www.electronjs.org/docs/latest/tutorial/security
// process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'
// console.log(app.getPath('userData'))

// Initialize the main window instance
export let mainWindow: BrowserWindow | null = null

// Set up the custom title bar
setupTitlebar()

// Create the main window when the app is ready
app.whenReady().then(() => {
  mainWindow = createWindow()
  bridge.menu.createMenu()
})

// Quit the app when all windows are closed
app.on('window-all-closed', () => {
  mainWindow = null
  if (process.platform !== 'darwin') app.quit()
})

// Handle second instance of the app
app.on('second-instance', () => {
  if (mainWindow) {
    // Focus on the main window if the user tried to open another
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// Handle the app activation event
app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})
