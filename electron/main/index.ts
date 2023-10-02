import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'

import { setupTitlebar } from 'custom-electron-titlebar/main'
import { app, BrowserWindow } from 'electron'

import { ipc } from '../ipc'
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

const userDataPath = app.getPath('userData')
const workspaceDataPath = join(userDataPath, '/User/workspaceStorage')
const workspaceFile = join(workspaceDataPath, 'workspace.json')

// Function to ensure the folder and file exist
const ensureWorkspaceFileExists = () => {
  try {
    // Create the user data folder if it doesn't exist
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }
    // Create the workspace data folder if it doesn't exist
    if (!existsSync(workspaceDataPath)) {
      mkdirSync(workspaceDataPath, { recursive: true })
    }
    // Create the workspace file if it doesn't exist
    if (!existsSync(workspaceFile)) {
      writeFileSync(
        workspaceFile,
        JSON.stringify(workspaceStorage, null, 2),
        'utf-8',
      )
    }
  } catch (error) {
    // Handle any errors that may occur during file/folder creation
    console.error('Error creating config file:', error)
  }
}

// Load the workspace file at app startup
let workspaceStorage: { folder: string }

try {
  const data = readFileSync(workspaceFile, 'utf-8')
  workspaceStorage = JSON.parse(data)
} catch (error) {
  // If the file doesn't exist or is corrupted, use default settings
  workspaceStorage = {
    folder: '',
  }
  ensureWorkspaceFileExists()
}

// Function to save configuration
const setWorkspace = (arg: any) => {
  writeFileSync(workspaceFile, JSON.stringify(arg, null, 2), 'utf-8')
}

// Set the workspace folder
setWorkspace(workspaceStorage)

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
  ipc.menu.createMenu()
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

// Set up IPC listeners
ipc.setupListeners()
