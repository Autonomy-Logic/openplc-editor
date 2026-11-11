import { hasOpenEditSessions, releaseAllEditSessions } from '@root/backend/editor/edge-edit-sessions'
import { isWebUrl } from '@root/backend/editor/utils/is-web-url'
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import Installer from 'electron-devtools-installer'
import log from 'electron-log'
import { enableMapSet } from 'immer'
import { homedir, platform, release } from 'os'
import { join, resolve } from 'path'

import { ensureCliShimInstalled, shimStatePath } from '../backend/editor/cli-shim/first-run'
import { CompilerModule } from '../backend/editor/compiler'
import { MainIpcModuleConstructor } from '../backend/editor/contracts/types/modules/ipc/main'
import { adoptProviderTokens } from '../backend/editor/edge-account/edge-account-service'
import { edgeOAuthProviderFromUrl, runOAuthFlow } from '../backend/editor/edge-account/oauth-browser-flow'
import { HardwareModule } from '../backend/editor/hardware'
import { PackageManagerModule } from '../backend/editor/package-manager'
import {
  type ArduinoDependencyServices,
  createArduinoDependencyServices,
} from '../backend/editor/package-manager/vpp-dependency-service'
import { clearCloudBuildRoot } from '../backend/editor/project/cloud-build-workspace'
import { logger, PouService, ProjectService, UserService } from '../backend/editor/services'
import { resolveHtmlPath } from '../backend/editor/utils'
import { getErrorMessage } from '../frontend/utils/get-error-message'
import type { EdgeOAuthProviderId } from '../middleware/shared/ports/edge-account-port'
import { VENDOR_DOCUMENT_SCHEME } from '../middleware/shared/vendor-document/document-url'
import MenuBuilder from './menu'
import MainProcessBridge from './modules/ipc/main'
import { createQuitCoordinator } from './modules/lifecycle/quit-coordinator'
import { createDesktopRuntimeProvisioningService, registerRuntimeProvisioning } from './modules/runtime-provisioning'
import { store } from './modules/store'
import { createElectronUpdateService } from './modules/updater'
import { createVendorDocumentHandler, leavesVendorDocument } from './modules/vendor-document/serve'

enableMapSet()

protocol.registerSchemesAsPrivileged([
  { scheme: VENDOR_DOCUMENT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

Menu.setApplicationMenu(null)

export let mainWindow: BrowserWindow | null = null
export let splash: BrowserWindow | null = null

let mainIpcModule: MainProcessBridge | undefined
let packageManager: PackageManagerModule | undefined
let arduinoDependencies: ArduinoDependencyServices | undefined
// One per process, not per window: macOS re-creates the window on activate.
const updateService = createElectronUpdateService({
  getWindow: () => mainWindow,
  requestQuit: () => quitCoordinator.requestQuit(),
})
const quitCoordinator = createQuitCoordinator({
  platform: process.platform,
  getWindow: () => mainWindow,
  quitApp: () => app.quit(),
  stopSimulator: () => mainIpcModule?.stopSimulator(),
  canPrompt: () => mainIpcModule?.canPromptQuit() ?? false,
})
registerRuntimeProvisioning({
  ipcMain,
  app,
  service: createDesktopRuntimeProvisioningService(app.getPath('userData')),
})

if (process.env.NODE_ENV === 'production') {
  async function loadSourceMapSupport(): Promise<void> {
    const sourceMapSupport = await import('source-map-support')
    sourceMapSupport.install()
  }

  void loadSourceMapSupport()
}

const userService = new UserService()

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
  default: {
    titleBarStyle: 'default',
    titlebarOverlay: true,
    frame: true,
  },
}

const titlebarStyles = titlebarOptionsMap[systemInfo] || titlebarOptionsMap.default

const isDebug = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'

if (isDebug) {
  void import('electron-debug')
}

const installExtensions = async () => {
  const installer = await import('electron-devtools-installer')
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS
  const extensions = ['REACT_DEVELOPER_TOOLS']

  try {
    return await installer.default(
      extensions.map((name) => installer[name as keyof typeof Installer]),
      forceDownload,
    )
  } catch (error) {
    logger.warn(`Skipping development extension installation: ${getErrorMessage(error)}`)
    return []
  }
}

/** Brings the main window back to the front. */
function bringMainWindowToFront(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
  app.focus({ steal: true })
}

/**
 * Handles a provider sign-in that lands from the system browser: adopts the tokens and tells the renderer there is a
 * session to read.
 */
async function completeProviderSignIn(provider: EdgeOAuthProviderId): Promise<void> {
  try {
    const outcome = await runOAuthFlow(provider)

    if (outcome.status !== 'tokens') {
      if (outcome.status === 'failed') {
        log.warn(`[edge-account] provider sign-in did not finish: ${outcome.reason ?? 'unknown'}`)
      }

      return
    }

    const signIn = await adoptProviderTokens({ accessToken: outcome.accessToken, refreshToken: outcome.refreshToken })

    if (signIn.status !== 'signed-in') {
      log.warn(`[edge-account] provider tokens arrived but the session could not be read: ${signIn.status}`)

      return
    }

    mainWindow?.webContents.send('edge-account:signed-in')
    bringMainWindowToFront()
  } catch (error: unknown) {
    log.error(`[edge-account] provider sign-in failed: ${getErrorMessage(error)}`)
  }
}

const createMainWindow = async () => {
  if (isDebug) {
    await installExtensions()
  }
  const RESOURCES_PATH = app.isPackaged ? join(process.resourcesPath, 'assets') : join(__dirname, '../../assets')

  const getAssetPath = (...paths: string[]): string => join(RESOURCES_PATH, ...paths)

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
    .then(() => logger.info('Splash screen loaded successfully'))
    .catch((error: unknown) => logger.error('Error loading splash screen: ' + getErrorMessage(error)))

  splash.setIgnoreMouseEvents(false)

  splash.once('ready-to-show', () => {
    splash?.show()
  })

  splash.on('closed', () => (splash = null))

  mainWindow = new BrowserWindow({
    minWidth: 1124,
    minHeight: 628,
    show: false,
    icon: getAssetPath('icon.png'),
    ...titlebarStyles,
    webPreferences: {
      sandbox: true,
      preload: app.isPackaged ? join(__dirname, 'preload.js') : join(__dirname, '../../configs/dll/preload.js'),
    },
  })

  void mainWindow.loadURL(resolveHtmlPath('index.html'))

  const saveBounds = () => {
    store.set('window.bounds', mainWindow?.getBounds())
  }

  const isMaximizedWindow = () => {
    mainWindow?.webContents.send('window-controls:toggle-maximized')
  }

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined')
    }
    mainWindow.maximize()
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

  mainWindow.on('close', saveBounds)
  mainWindow.on('close', (event) => {
    logger.info('mainWindow close')
    quitCoordinator.handleWindowClose(event)
    if (process.platform !== 'darwin') mainWindow?.webContents.send('window-controls:is-closing')
  })

  mainWindow.on('closed', () => {
    logger.info('mainWindow closed')
    mainWindow = null
  })

  mainWindow.on('move', saveBounds)

  mainWindow.on('maximize', () => {
    isMaximizedWindow()
  })

  mainWindow.on('unmaximize', () => {
    isMaximizedWindow()
  })

  mainWindow.on('resize', saveBounds)

  if (!bounds) {
    mainWindow.maximize()
  }

  if (isDebug) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.webContents.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame && leavesVendorDocument(details.frame?.url, details.url)) details.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler((edata) => {
    const provider = edgeOAuthProviderFromUrl(edata.url)

    if (provider) {
      void completeProviderSignIn(provider)

      return { action: 'deny' }
    }

    if (isWebUrl(edata.url)) {
      void shell.openExternal(edata.url)
    } else {
      log.warn(`[main] refused to open external URL with scheme ${edata.url.split(':')[0] || '(none)'}`)
    }

    return { action: 'deny' }
  })

  const menuBuilder = new MenuBuilder(mainWindow, updateService)
  void menuBuilder.buildMenu()

  const projectService = new ProjectService(mainWindow)

  const pouService = new PouService()

  const compilerModule = new CompilerModule()

  const hardwareModule = new HardwareModule()

  const firstWindow = arduinoDependencies === undefined
  const packages = (packageManager ??= new PackageManagerModule())
  arduinoDependencies ??= createArduinoDependencyServices(packages, (args) => compilerModule.spawnArduinoCli(args))

  mainIpcModule = new MainProcessBridge({
    mainWindow,
    ipcMain,
    projectService,
    store,
    menuBuilder,
    pouService,
    compilerModule,
    hardwareModule,
    quitCoordinator,
    packageManagerModule: packages,
    arduinoDependencies,
  } as unknown as MainIpcModuleConstructor)
  mainIpcModule.setupMainIpcListener()
  if (firstWindow) arduinoDependencies.startup.start(userService.initialize())
}

if (release().startsWith('6.1')) app.disableHardwareAcceleration()

if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

app.on('activate', () => {
  if (mainWindow === null) {
    void createMainWindow()
  } else {
    mainWindow.show()
  }
})

app.on('before-quit', (event) => {
  logger.info('before-quit')
  quitCoordinator.handleBeforeQuit(event)
})

const EDIT_SESSION_RELEASE_BUDGET_MS = 1500
let editSessionsReleased = false

app.on('will-quit', (event) => {
  logger.info('will-quit')
  if (editSessionsReleased || !hasOpenEditSessions()) {
    return
  }
  editSessionsReleased = true
  event.preventDefault()
  void Promise.race([
    releaseAllEditSessions(),
    new Promise<void>((resolve) => setTimeout(resolve, EDIT_SESSION_RELEASE_BUDGET_MS)),
  ]).finally(() => app.quit())
})

app.on('quit', () => {
  logger.info('quit')
})

app.on('window-all-closed', () => {
  logger.info('window-all-closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app
  .whenReady()
  .then(() => {
    const packages = new PackageManagerModule()
    packageManager = packages
    protocol.handle(
      VENDOR_DOCUMENT_SCHEME,
      createVendorDocumentHandler({ listPackages: () => packages.listInstalled() }),
    )
    void createMainWindow()
    void clearCloudBuildRoot().catch((error: unknown) =>
      logger.warn('Could not clear the cloud build scratch directory: ' + getErrorMessage(error)),
    )
    void installCliShimOnFirstRun()
    updateService.start()
    app.on('activate', () => {
      if (mainWindow === null) void createMainWindow()
    })
  })
  .catch((err: unknown) => logger.error(getErrorMessage(err)))

/**
 * Install the `openplc-cli` shim on first run. Only the disk-image / translocation case is shown to the user;
 * everything else goes to the log.
 */
async function installCliShimOnFirstRun(): Promise<void> {
  if (!app.isPackaged) return

  try {
    const outcome = await ensureCliShimInstalled({
      statePath: shimStatePath(app.getPath('userData')),
      appBinaryPath: process.execPath,
      leadingArgs: ['--cli'],
      environment: {
        platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
        home: homedir(),
        pathVariable: process.env.PATH ?? '',
        localAppData: process.env.LOCALAPPDATA,
        appImagePath: process.env.APPIMAGE,
      },
      warn: (message) => {
        logger.info(`[cli-shim] ${message}`)
        void dialog.showMessageBox({
          type: 'info',
          title: 'Command line tool not installed',
          message: 'The openplc-cli command could not be installed',
          detail: message,
          buttons: ['OK'],
        })
      },
      onDiagnostic: (message) => logger.info(`[cli-shim] ${message}`),
    })
    logger.info(`[cli-shim] ${outcome.status}`)
    if ('hint' in outcome && outcome.hint) logger.info(`[cli-shim] ${outcome.hint}`)
  } catch (error) {
    logger.error(`[cli-shim] install failed: ${getErrorMessage(error)}`)
  }
}
