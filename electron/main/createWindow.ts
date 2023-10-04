import { join } from 'node:path'

import { attachTitlebarToWindow } from 'custom-electron-titlebar/main'
import { BrowserWindow, shell } from 'electron'

import { appConfig } from '../../shared/app.config'
import { store } from '../store'
import { update } from './update'

/**
 * Creates a new browser window instance.
 * @returns The created browser window.
 */
export const createWindow = () => {
  const preload = join(__dirname, '../preload/index.js')
  const url = process.env.VITE_DEV_SERVER_URL
  const indexHtml = join(process.env.DIST, 'index.html')
  const { bounds } = store.get('window')
  const { title } = appConfig

  const window = new BrowserWindow({
    title,
    icon: join(process.env.PUBLIC, 'favicon.ico'),
    minHeight: 800,
    minWidth: 1280,
    width: 480,
    height: 300,
    ...bounds,
    show: false,
    // titleBarStyle: 'hidden',
    // transparent: true,
    frame: false,
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Send a message to the renderer process when the content finishes loading
  window.webContents.on('did-finish-load', () => {
    window.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Save window bounds on resize, close, and move events
  const saveBounds = () => {
    store.set('window.bounds', window?.getBounds())
  }
  window.on('resize', saveBounds)
  window.on('close', saveBounds)
  window.on('move', saveBounds)

  // Maximize the window if bounds are not set
  if (!bounds) {
    window.maximize()
  }

  if (url) {
    // Load the URL during development
    // electron-vite-react
    window.loadURL(url)
    // Open devTool if the app is not packaged
    window.webContents.openDevTools()
  } else {
    // Load the index.html file in the packaged app
    window.loadFile(indexHtml)
  }

  // Open external links in the system's default browser
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Apply electron-updater
  update(window)

  // Attach the custom titlebar to the window
  attachTitlebarToWindow(window)

  window.show()

  // Show the window
  return window
}
