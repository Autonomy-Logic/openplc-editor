/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { release } from 'os';
import {
  setupTitlebar,
  attachTitlebarToWindow,
} from 'custom-electron-titlebar/main';
import { MainIpcModuleConstructor } from '../types/main/modules/ipc/main';
import { resolveHtmlPath } from '../utils/resolveHtmlPath';
import MenuBuilder from './menu';
import MainProcessBridge from './modules/ipc/main';
import { ProjectService } from './services';
import { store } from './store';

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

// eslint-disable-next-line import/prefer-default-export, import/no-mutable-exports
export let mainWindow: BrowserWindow | null = null;

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

// Set up the custom title bar;
setupTitlebar();

const createWindow = async () => {
  // Check if the application is on debug method, install the extensions
  if (isDebug) {
    await installExtensions();
  }
  // Create a string with the resources folder path based on app environment;
  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  // Create a function that return the asset that the name was given;
  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1280,
    minWidth: 1280,
    height: 800,
    minHeight: 800,
    icon: getAssetPath('icon.png'),
    frame: false,
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  // Send a message to the renderer process when the content finishes loading;
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send(
      'main-process-message',
      new Date().toLocaleString(),
    );
  });

  // Load the Url or index.html file;
  mainWindow.loadURL(resolveHtmlPath('index.html'));

  // Open devtools if the app is not packaged;
  if (isDebug) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      // Attach the custom titlebar to the window;
      attachTitlebarToWindow(mainWindow);

      // Show the created window;
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Handles the creation of the menu
  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Remove this if your app does not use auto updates;
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

// Disable GPU Acceleration for Windows 7;
if (release().startsWith('6.1')) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications;
if (process.platform === 'win32') app.setAppUserModelId(app.getName());

// Ensure only one instance of the application is running;
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Quit the app when all windows are closed;
app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle second instance of the app;
app.on('second-instance', () => {
  if (mainWindow) {
    // Focus on the main window if the user tried to open another
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Create the main window when the app is ready;
app
  .whenReady()
  .then(() => {
    createWindow();

    // Handle the app activation event;
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });

    // Refactor: This should work in a most efficient way
    if (mainWindow) {
      // New project service instance
      const projectService = new ProjectService(mainWindow);

      // New main ipc instance
      const mainIpcModule = new MainProcessBridge({
        mainWindow,
        ipcMain,
        projectService,
        store,
      } as unknown as MainIpcModuleConstructor);

      mainIpcModule.setupMainIpcListener();
    }
  })
  .catch(console.log);
