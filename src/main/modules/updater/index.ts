import { spawn } from 'child_process'
import { app, autoUpdater as squirrelUpdater, type BrowserWindow, dialog, ipcMain, shell } from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import { accessSync, constants } from 'fs'

import type { QuitIntent } from '../lifecycle/quit-coordinator'
import { store } from '../store'
import { createUpdateService, type UpdateService } from './update-service'
import { detectUpdateSupport } from './update-support'

export type { UpdateService } from './update-service'

/** Longest the relaunch waits for this process to exit before giving up (0.2 s steps). */
const RELAUNCH_WAIT_STEPS = 300

/**
 * Open `execPath` once this process has exited.
 *
 * Not `app.relaunch`: its helper process is started from this binary, which on
 * Linux lives inside the AppImage's FUSE mount, and the AppImage runtime takes
 * that mount down as soon as this process exits — the helper goes with it and
 * nothing is reopened (verified on a packaged build). A detached `/bin/sh`
 * runs from outside the image. It waits for this PID to be gone, so the new
 * editor never meets the single-instance lock of the old one.
 */
function relaunchAfterExit(execPath: string): void {
  const script = 'i=0; while kill -0 "$0" 2>/dev/null && [ "$i" -lt "$1" ]; do sleep 0.2; i=$((i+1)); done; exec "$2"'
  const child = spawn('/bin/sh', ['-c', script, String(process.pid), String(RELAUNCH_WAIT_STEPS), execPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', (error) => log.warn(`[updater] could not schedule the relaunch: ${error.message}`))
  child.unref()
}

function isWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The status bar's side of the service: `app-update:get-status` answers what a
 * renderer that just loaded should show, `app-update:status` pushes changes to
 * the window, and `app-update:install` is the "Update" button.
 */
function registerUpdateIpc(service: UpdateService, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('app-update:get-status', () => service.getStatus())
  ipcMain.on('app-update:install', () => service.requestInstall())
  service.onStatusChange((status) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('app-update:status', status)
  })
}

/** The one update service of this process, wired to Electron and electron-updater. */
export function createElectronUpdateService({
  getWindow,
  requestQuit,
}: {
  getWindow: () => BrowserWindow | null
  requestQuit: (intent: QuitIntent) => void
}): UpdateService {
  log.transports.file.level = 'info'
  autoUpdater.logger = log

  const service = createUpdateService({
    engine: autoUpdater,
    nativeUpdater: process.platform === 'darwin' ? squirrelUpdater : null,
    platform: process.platform,
    currentVersion: app.getVersion(),
    support: detectUpdateSupport({
      isPackaged: app.isPackaged,
      platform: process.platform,
      execPath: process.execPath,
      appImagePath: process.env.APPIMAGE,
    }),
    appImagePath: process.env.APPIMAGE,
    isWritable,
    readAutoCheck: () => store.get('auto_update_check'),
    writeAutoCheck: (enabled) => store.set('auto_update_check', enabled),
    readState: () => store.get('update_state'),
    writeState: (state) => store.set('update_state', state),
    showDialog: async (request) => {
      const window = getWindow()
      const options = { ...request, noLink: true }
      const result =
        window && !window.isDestroyed()
          ? await dialog.showMessageBox(window, options)
          : await dialog.showMessageBox(options)
      return result.response
    },
    openExternal: (url) => {
      void shell
        .openExternal(url)
        .catch((error: unknown) => log.warn(`[updater] could not open ${url}: ${String(error)}`))
    },
    requestQuit,
    relaunch: relaunchAfterExit,
    quit: () => app.quit(),
    after: (ms, callback) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
    log: (level, message) => log[level](message),
  })
  registerUpdateIpc(service, getWindow)
  return service
}
