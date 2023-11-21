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

  const { bounds } = store.get('window');

  mainWindow = new BrowserWindow({
    minWidth: 1280,
    minHeight: 800,
    width: 1280,
    height: 800,
    ...bounds,
    show: false,
    icon: getAssetPath('icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: true,
    frame: false,
    webPreferences: {
      sandbox: false,
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.oplc/dll/preload.js'),
    },
  });

  // Send a message to the renderer process when the content finishes loading;
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send(
      'main-process-message',
      new Date().toLocaleString(),
    );
  });

  // Save window bounds on resize, close, and move events
  const saveBounds = () => {
    store.set('window.bounds', mainWindow?.getBounds());
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('close', saveBounds);
  mainWindow.on('move', saveBounds);

  // // Apply the top position to the container in the fullscreen mode
  // mainWindow.on('enter-full-screen', () => {
  //   const containerIterator = Array.from(
  //     document.getElementsByClassName('cet-container'),
  //   );
  //   const [container] = containerIterator;
  //   container.classList.replace('!top-16', '!top-0');
  // });

  // // Apply the top position to the container when leaving the fullscreen mode
  // mainWindow.on('leave-full-screen', () => {
  //   const containerIterator = Array.from(
  //     document.getElementsByClassName('cet-container'),
  //   );
  //   const [container] = containerIterator;
  //   container.classList.add('!top-16');
  //   container.classList.replace('!top-0', '!top-16');
  // });

  // Maximize the window if bounds are not set
  if (!bounds) {
    mainWindow.maximize();
  }

  // Load the Url or index.html file;
  mainWindow.loadURL(resolveHtmlPath(''));

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

  // Create an instance of the project service to be used by the main process.
  const projectService = new ProjectService(mainWindow);

  // Handles the creation of the menu
  const menuBuilder = new MenuBuilder(mainWindow, projectService);
  menuBuilder.buildMenu();

  const mainIpcModule = new MainProcessBridge({
    mainWindow,
    ipcMain,
    projectService,
    store,
  } as unknown as MainIpcModuleConstructor);
  mainIpcModule.setupMainIpcListener();
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
  })
  .catch(console.log);
