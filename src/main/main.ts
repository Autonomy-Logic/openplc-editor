/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import { release, platform } from 'os'
import path from 'path'
import {
	type BrowserWindowConstructorOptions,
	BrowserWindow,
	app,
	ipcMain,
	nativeTheme,
	shell,
	webContents,
} from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'

import { resolveHtmlPath } from '../utils/resolveHtmlPath'
// TODO: Refactor this type declaration
import { MainIpcModuleConstructor } from './contracts/types/modules/ipc/main'
import MenuBuilder from './menu'
import MainProcessBridge from './modules/ipc/main'
import { store } from './modules/store'
import { ProjectService } from './services'

class AppUpdater {
	constructor() {
		log.transports.file.level = 'info'
		autoUpdater.logger = log
		autoUpdater.checkForUpdatesAndNotify()
	}
}

export let mainWindow: BrowserWindow | null = null
export let splash: BrowserWindow | null = null

if (process.env.NODE_ENV === 'production') {
	const sourceMapSupport = require('source-map-support')
	sourceMapSupport.install()
}

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

const titlebarStyles =
	titlebarOptionsMap[systemInfo] || titlebarOptionsMap.default

const isDebug =
	process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'

if (isDebug) {
	require('electron-debug')()
}

const installExtensions = async () => {
	const installer = require('electron-devtools-installer')
	const forceDownload = !!process.env.UPGRADE_EXTENSIONS
	const extensions = ['REACT_DEVELOPER_TOOLS']

	return installer
		.default(
			extensions.map((name) => installer[name]),
			forceDownload
		)
		.catch(console.log)
}

const createSplashWindow = () => {
	splash = new BrowserWindow({
		width: 580,
		height: 366,
		resizable: false,
		frame: false,
		alwaysOnTop: true,
		webPreferences: {
			sandbox: false,
		},
	})

	splash.loadURL(
		`file://${path.join(
			__dirname,
			'./modules/preload/scripts/loading/splash.html'
		)}`
	)
}

const createWindow = async () => {
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
	const getAssetPath = (...paths: string[]): string =>
		path.join(RESOURCES_PATH, ...paths)

	/**
	 * Get the window bounds from the store.
	 */
	const { bounds } = store.get('window')

	// Create a new browser window for the splash screen
	// splash = new BrowserWindow({
	// 	width: 580,
	// 	height: 366,
	// 	resizable: false,
	// 	frame: false,
	// 	alwaysOnTop: true,
	// 	webPreferences: {
	// 		sandbox: false,
	// 	},
	// })

	// splash
	// 	.loadURL(
	// 		`file://${path.join(
	// 			__dirname,
	// 			'./modules/preload/scripts/loading/splash.html'
	// 		)}`
	// 	)
	// 	.then(() => console.log('Splash screen loaded successfully'))
	// 	.catch((error) => console.error('Error loading splash screen:', error))

	// Create the main window instance.
	mainWindow = new BrowserWindow({
		minWidth: 1124,
		minHeight: 768,
		...bounds,
		show: false,
		icon: getAssetPath('icon.png'),
		...titlebarStyles,
		webPreferences: {
			sandbox: false,
			preload: app.isPackaged
				? path.join(__dirname, 'preload.js')
				: path.join(__dirname, '../../configs/dll/preload.js'),
		},
	})

	mainWindow.webContents.on('did-finish-load', () => {
		if (!splash) {
			createSplashWindow()
			setTimeout(() => {
				splash?.close()
				mainWindow?.show()
			},4500)
		}
	})

	// splash.setIgnoreMouseEvents(false)
	// Save window bounds on resize, close, and move events
	const saveBounds = () => {
		store.set('window.bounds', mainWindow?.getBounds())
	}
	mainWindow.on('resize', saveBounds)
	mainWindow.on('close', saveBounds)
	mainWindow.on('move', saveBounds)

	// Maximize the window if bounds are not set
	if (!bounds) {
		mainWindow.maximize()
	}

	// Load the Url or index.html file;
	mainWindow.loadURL(resolveHtmlPath(''))

	// Open devtools if the app is not packaged;
	// if (isDebug) {
	// 	mainWindow.webContents.openDevTools()
	// }

	mainWindow.on('ready-to-show', () => {
		if (!mainWindow) {
			throw new Error('"mainWindow" is not defined')
		}
		if (process.env.START_MINIMIZED) {
			mainWindow.minimize()
		}
	})

	mainWindow.on('closed', () => {
		mainWindow = null
	})

	// Open urls in the user's browser
	mainWindow.webContents.setWindowOpenHandler((edata) => {
		shell.openExternal(edata.url)
		return { action: 'deny' }
	})

	/**
	 * Add event listeners...
	 */

	// Handles the creation of the menu
	const menuBuilder = new MenuBuilder(mainWindow)
	menuBuilder.buildMenu()

	const projectService = new ProjectService(mainWindow)

	const mainIpcModule = new MainProcessBridge({
		mainWindow,
		ipcMain,
		projectService,
		store,
	} as unknown as MainIpcModuleConstructor)
	mainIpcModule.setupMainIpcListener()
	// Remove this if your app does not use auto updates;
	// eslint-disable-next-line
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
		createWindow()
		// Handle the app activation event;
		app.on('activate', () => {
			// On macOS it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open.
			if (mainWindow === null) createWindow()
		})
	})
	.catch(console.log)
