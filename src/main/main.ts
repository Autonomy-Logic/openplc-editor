/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import Installer from 'electron-devtools-installer'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import { platform, release } from 'os'
import path, { resolve } from 'path'

// TODO: Refactor this type declaration
import { MainIpcModuleConstructor } from './contracts/types/modules/ipc/main'
import MenuBuilder from './menu'
import MainProcessBridge from './modules/ipc/main'
import { store } from './modules/store'
import { ProjectService, UserService } from './services'
import { CompilerService } from './services/compiler-service'
import { resolveHtmlPath } from './utils'

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info'
    autoUpdater.logger = log
    void autoUpdater.checkForUpdatesAndNotify()
  }
}

export let mainWindow: BrowserWindow | null = null
export let splash: BrowserWindow | null = null

if (process.env.NODE_ENV === 'production') {
  async function loadSourceMapSupport(): Promise<void> {
    const sourceMapSupport = await import('source-map-support')
    sourceMapSupport.install()
  }

  void loadSourceMapSupport()
}

void UserService.checkIfUserBaseSettingsExists()
void UserService.checkIfUserHistoryFolderExists()
// Retrieves the system information
const systemInfo = platform()
// The options to use when creating the titlebar. Type comes from electron.
type OptTitlebar = {
  titleBarStyle?: 'hidden' | 'default' | 'hiddenInset' | 'customButtonsOnHover'
  titlebarOverlay: boolean
  frame: boolean
}

const titlebarOptionsMap: Record<string, OptTitlebar> = {
  darwin: {
    titleBarStyle: 'hidden',
    titlebarOverlay: true,
    frame: false,
  },
  win32: {
    titleBarStyle: 'hidden',
    titlebarOverlay: false,
    frame: false,
  },
  // Default for everything else (including other Unix variants)
  default: {
    titleBarStyle: 'default',
    titlebarOverlay: true,
    frame: true,
  },
}

const titlebarStyles = titlebarOptionsMap[systemInfo] || titlebarOptionsMap.default

const isDebug = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'

if (isDebug) {
  import('electron-debug')
}

const installExtensions = async () => {
  const installer = await import('electron-devtools-installer')
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS
  const extensions = ['REACT_DEVELOPER_TOOLS']

  return installer
    .default(
      extensions.map((name) => installer[name as keyof typeof Installer]),
      forceDownload,
    )
    .catch(console.log)
}

const createMainWindow = async () => {
  // Check if the application is on debug method, install the extensions
  if (isDebug) {
    await installExtensions()
  }
  // Create a string with the resources folder path based on app environment;
  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets')

  /**
   * Create a function that return the asset that the name was given;
   */
  const getAssetPath = (...paths: string[]): string => path.join(RESOURCES_PATH, ...paths)

  /**
   * Get the window bounds from the store.
   */
  const { bounds } = store.get('window')

  splash = new BrowserWindow({
    width: 580,
    height: 366,
    resizable: false,
    frame: false,
    show: false,
    webPreferences: {
      sandbox: true,
    },
  })

  const splashPath = app.isPackaged
    ? resolve(__dirname, '../main/splash.html')
    : 'src/main/modules/preload/splash-screen/splash.html'
  splash
    .loadFile(splashPath)
    .then(() => console.log('Splash screen loaded successfully'))
    .catch((error) => console.error('Error loading splash screen:', error))

  splash.setIgnoreMouseEvents(false)

  splash.once('ready-to-show', () => {
    splash?.show()
  })

  // Create the main window instance.
  mainWindow = new BrowserWindow({
    minWidth: 1124,
    minHeight: 628,
    ...bounds,
    show: false,
    icon: getAssetPath('icon.png'),
    ...titlebarStyles,
    webPreferences: {
      sandbox: true,
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../configs/dll/preload.js'),
    },
  })

  // Load the Url or index.html file;
  void mainWindow.loadURL(resolveHtmlPath('index.html'))

  // Save window bounds on resize, close, and move events
  const saveBounds = () => {
    store.set('window.bounds', mainWindow?.getBounds())
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('close', saveBounds)
  mainWindow.on('move', saveBounds)

  const isMaximizedWindow = () => {
    mainWindow?.webContents.send('window-controls:toggle-maximized')
  }
  mainWindow.on('maximize', () => {
    isMaximizedWindow()
  })
  mainWindow.on('unmaximize', () => {
    isMaximizedWindow()
  })

  // Maximize the window if bounds are not set
  if (!bounds) {
    mainWindow.maximize()
  }

  // Open devtools if the app is not packaged;
  if (isDebug) {
    mainWindow.webContents.openDevTools()
  }

  splash.on('closed', () => (splash = null))

  // Listen to the ready event to show the window gracefully;
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined')
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize()
    }
    setTimeout(() => {
      if (splash === null) {
        mainWindow?.destroy()
        return
      }
      splash.close()
      mainWindow?.show()
    }, 3000)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    void shell.openExternal(edata.url)
    return { action: 'deny' }
  })

  /**
   * Add event listeners...
   */

  // mainWindow.webContents.send('editor:getBaseTypes', _editorService.getBaseTypes())

  // Handles the creation of the menu
  const menuBuilder = new MenuBuilder(mainWindow)
  menuBuilder.buildMenu()

  const projectService = new ProjectService(mainWindow)

  const mainIpcModule = new MainProcessBridge({
    mainWindow,
    ipcMain,
    projectService,
    compilerService: CompilerService,
    store,
  } as unknown as MainIpcModuleConstructor)
  mainIpcModule.setupMainIpcListener()
  // Remove this if your app does not use auto updates;

  new AppUpdater()
}

// Disable GPU Acceleration for Windows 7;
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications;
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

// Ensure only one instance of the application is running;
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// Quit the app when all windows are closed;
app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Handle second instance of the app;
app.on('second-instance', () => {
  if (mainWindow) {
    // Focus on the main window if the user tried to open another
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// Create the main window when the app is ready;
app
  .whenReady()
  .then(() => {
    void createMainWindow()
    // Handle the app activation event;
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) void createMainWindow()
    })
  })
  .catch(console.log)
