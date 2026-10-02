/**
 * The desktop editor's self-update (DOPE-486): one check each time the editor
 * opens, a background download, and the install on quit or from the "Update"
 * button in the status bar, on macOS and on Linux AppImage.
 *
 * A downloaded update is announced by that button, not by a dialog: the
 * renderer reads `getStatus` / `onStatusChange` over IPC. Dialogs are kept for
 * a manual "Check for Updates", which always answers.
 *
 * Every Electron and filesystem call comes in through `UpdateServiceDeps`, so
 * the rules below are tested without Electron; `index.ts` wires the real ones.
 *
 * The rules that shape this file, each learned from electron-updater 6.3.2:
 *
 *   - Downloading is decided here, not by `autoDownload`. A location the user
 *     cannot write to would fail at install time after a full download, and a
 *     version that already failed to install must not be fetched again.
 *   - On macOS the update is ready only when Squirrel says so. electron-updater
 *     reports `update-downloaded` before it hands the file to Squirrel, and a
 *     `quitAndInstall` before Squirrel is ready waits with the window gone.
 *   - On Linux the install must not launch the new AppImage. The default
 *     `quitAndInstall` spawns it before this process exits, the single-instance
 *     lock makes it quit on the spot, and the user is left with no editor. So
 *     it installs silently and `relaunch` reopens it after this process is gone.
 *   - Install failures never reach the app: macOS installs after the process
 *     has exited, and on Linux the error fires while quitting. They are inferred
 *     on the next start instead, from the version still running.
 *
 */

import type { QuitIntent } from '../lifecycle/quit-coordinator'
import { compareVersions, isNewer } from './version-order'

/** The slice of an update descriptor this service reads. */
export interface UpdateInfoLike {
  version: string
}

/** The slice of electron-updater's `AppUpdater` this service drives. */
export interface UpdaterEngine {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(
    event: 'update-available' | 'update-not-available' | 'update-downloaded',
    listener: (info: UpdateInfoLike) => void,
  ): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'appimage-filename-updated', listener: (path: string) => void): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'appimage-filename-updated', listener: (path: string) => void): unknown
}

/** Electron's own `autoUpdater` (Squirrel.Mac), which says when an install can actually happen. */
export interface NativeUpdater {
  on(event: 'update-downloaded', listener: () => void): unknown
}

/** What persists across runs. The auto-check preference lives beside it, in its own key. */
export interface UpdateState {
  /** Last version the user was told could not be installed here, so it is said once. */
  notifiedVersion?: string
  /** Version downloaded and waiting to be installed. */
  pendingVersion?: string
  /** Starts seen while still older than `pendingVersion`. */
  installAttempts?: number
  /** Version that did not install after two starts; never offered again. */
  failedVersion?: string
}

export interface DialogRequest {
  message: string
  detail: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
  type?: 'info' | 'warning' | 'error'
}

export type UpdateSupport =
  | { kind: 'supported'; installDir: string }
  | { kind: 'development' }
  | { kind: 'windows' }
  | { kind: 'not-appimage' }
  | { kind: 'unstable-location' }

export interface UpdateServiceDeps {
  engine: UpdaterEngine
  /** Present on macOS only. */
  nativeUpdater: NativeUpdater | null
  platform: NodeJS.Platform
  currentVersion: string
  support: UpdateSupport
  /** The AppImage file this process runs from (Linux). */
  appImagePath: string | undefined
  isWritable(dir: string): boolean
  readAutoCheck(): boolean
  writeAutoCheck(enabled: boolean): void
  readState(): UpdateState
  writeState(state: UpdateState): void
  /** Resolves to the index of the button pressed. */
  showDialog(request: DialogRequest): Promise<number>
  openExternal(url: string): void
  requestQuit(intent: QuitIntent): void
  relaunch(execPath: string): void
  quit(): void
  /** Runs `callback` once after `ms`; the returned function cancels it. */
  after(ms: number, callback: () => void): () => void
  log(level: 'info' | 'warn' | 'error', message: string): void
}

export const RELEASES_URL = 'https://github.com/Autonomy-Logic/openplc-editor/releases/latest'
/**
 * The one automatic check per launch runs this long after start, so it never
 * competes with the editor opening. There is no periodic check: an editor left
 * open picks the update up the next time it is opened, or from the menu.
 */
export const FIRST_CHECK_DELAY_MS = 60_000
/** Past this, a macOS install that has not quit the app is given up on. */
export const MAC_INSTALL_WATCHDOG_MS = 30_000
/** Starts on the old version after which a downloaded update counts as failed. */
export const FAILED_AFTER_STARTS = 2

type Phase = 'idle' | 'checking' | 'downloading' | 'downloaded'

/** What the status bar shows. `ready` only once an install would act at once. */
export type UpdateStatus = { state: 'none' } | { state: 'ready'; version: string }

export interface UpdateService {
  start(): void
  /** The menu's "Check for Updates". */
  checkNow(): Promise<void>
  isAutoCheckEnabled(): boolean
  setAutoCheck(enabled: boolean): void
  getStatus(): UpdateStatus
  /** The returned function unsubscribes. */
  onStatusChange(listener: (status: UpdateStatus) => void): () => void
  /** The status bar's "Update" button: the same quit request as "Restart Now". */
  requestInstall(): void
  /** Runs as the quit coordinator's `quitApp('install-update')`, after the user confirmed the quit. */
  installAndRestart(): void
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  const { engine } = deps
  let phase: Phase = 'idle'
  let manual = false
  let downloadedVersion: string | null = null
  /** On macOS, Squirrel has the update and `quitAndInstall` will act at once. */
  let installReady = false
  let pendingFailureNotice: string | null = null
  let status: UpdateStatus = { state: 'none' }
  const statusListeners = new Set<(status: UpdateStatus) => void>()

  const readyVersion = (of: UpdateStatus) => (of.state === 'ready' ? of.version : null)

  const setStatus = (next: UpdateStatus) => {
    if (readyVersion(next) === readyVersion(status)) return
    status = next
    for (const listener of statusListeners) listener(next)
  }

  const updateState = (patch: Partial<UpdateState>) => {
    const next: UpdateState = { ...deps.readState(), ...patch }
    for (const key of Object.keys(next) as (keyof UpdateState)[]) {
      if (next[key] === undefined) delete next[key]
    }
    deps.writeState(next)
  }

  const showDownloadNotice = async (message: string, detail: string) => {
    const pressed = await deps.showDialog({
      type: 'info',
      message,
      detail,
      buttons: ['Open Download Page', 'Close'],
      defaultId: 0,
      cancelId: 1,
    })
    if (pressed === 0) deps.openExternal(RELEASES_URL)
  }

  const noticeFailed = (version: string) =>
    showDownloadNotice(
      `OpenPLC Editor ${version} could not be installed`,
      'The automatic update did not complete. Download it from the releases page and install it manually.',
    )

  /** Only from a manual check; an automatic one leaves it to the status bar. */
  const promptReady = async (version: string) => {
    const pressed = await deps.showDialog({
      type: 'info',
      message: `OpenPLC Editor ${version} is ready to install`,
      detail: 'Restart now to update, or it will be installed the next time you quit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    if (pressed === 0) deps.requestQuit('install-update')
  }

  const isReadyToInstall = () =>
    phase === 'downloaded' && downloadedVersion !== null && (deps.platform !== 'darwin' || installReady)

  /** The download was started by a manual check, which said it would ask. */
  let promptWhenReady = false

  const announceReady = () => {
    if (!isReadyToInstall() || !downloadedVersion) return
    setStatus({ state: 'ready', version: downloadedVersion })
    if (promptWhenReady) {
      promptWhenReady = false
      void promptReady(downloadedVersion)
    }
  }

  const onAvailable = (info: UpdateInfoLike) => {
    const wasManual = manual
    const { failedVersion, notifiedVersion } = deps.readState()

    if (failedVersion === info.version) {
      phase = 'idle'
      if (wasManual) void noticeFailed(info.version)
      return
    }

    const support = deps.support
    if (support.kind !== 'supported') {
      phase = 'idle'
      return
    }
    if (!deps.isWritable(support.installDir)) {
      phase = 'idle'
      if (wasManual || notifiedVersion !== info.version) {
        updateState({ notifiedVersion: info.version })
        void showDownloadNotice(
          `OpenPLC Editor ${info.version} is available`,
          `It cannot be installed automatically because OpenPLC Editor is in a folder you cannot write to (${support.installDir}). Download it from the releases page.`,
        )
      }
      return
    }

    phase = 'downloading'
    if (wasManual) {
      promptWhenReady = true
      void deps.showDialog({
        type: 'info',
        message: `Downloading OpenPLC Editor ${info.version}`,
        detail: 'You will be asked to restart when it is ready. You can keep working meanwhile.',
        buttons: ['OK'],
      })
    }
    deps.engine.downloadUpdate().catch((error: unknown) => {
      phase = 'idle'
      promptWhenReady = false
      deps.log('warn', `[updater] download failed: ${String(error)}`)
    })
  }

  const onNotAvailable = (info: UpdateInfoLike) => {
    phase = 'idle'
    if (!manual) return
    // A staged release answers "not available" to everyone outside the stage,
    // even though a newer version exists. Saying "up to date" would be false.
    const message = isNewer(info.version, deps.currentVersion)
      ? {
          message: `OpenPLC Editor ${info.version} is being rolled out`,
          detail: `It is released to a growing share of users at a time and will reach this computer soon. You are on ${deps.currentVersion}.`,
        }
      : {
          message: 'OpenPLC Editor is up to date',
          detail: `Version ${deps.currentVersion} is the latest version.`,
        }
    void deps.showDialog({ type: 'info', ...message, buttons: ['OK'] })
  }

  const onDownloaded = (info: UpdateInfoLike) => {
    phase = 'downloaded'
    downloadedVersion = info.version
    const { pendingVersion } = deps.readState()
    if (pendingVersion !== info.version) updateState({ pendingVersion: info.version, installAttempts: 0 })
    announceReady()
  }

  const onNativeDownloaded = () => {
    installReady = true
    announceReady()
  }

  const onError = (error: Error) => {
    if (phase !== 'downloaded') phase = 'idle'
    deps.log('warn', `[updater] ${error.message}`)
  }

  const check = async (isManual: boolean) => {
    if (phase === 'checking') {
      // The automatic check is under way: let it answer as a manual one would.
      if (isManual) manual = true
      return
    }
    if (phase === 'downloading') {
      if (isManual) {
        void deps.showDialog({
          type: 'info',
          message: 'An update is already being downloaded',
          detail: 'You will be asked to restart when it is ready.',
          buttons: ['OK'],
        })
        promptWhenReady = true
      }
      return
    }
    if (phase === 'downloaded') {
      if (!isManual || !downloadedVersion) return
      if (!isReadyToInstall()) {
        // macOS: downloaded, but Squirrel is still preparing it.
        void deps.showDialog({
          type: 'info',
          message: `OpenPLC Editor ${downloadedVersion} is being prepared`,
          detail: 'You will be asked to restart when it is ready.',
          buttons: ['OK'],
        })
        promptWhenReady = true
        return
      }
      await promptReady(downloadedVersion)
      return
    }

    phase = 'checking'
    manual = isManual
    try {
      await engine.checkForUpdates()
    } catch (error: unknown) {
      phase = 'idle'
      deps.log('warn', `[updater] check failed: ${String(error)}`)
      if (manual) {
        void showDownloadNotice(
          'Could not check for updates',
          'OpenPLC Editor could not reach the update server. You can download the latest version from the releases page.',
        )
      }
    } finally {
      manual = false
      if (phase === 'checking') phase = 'idle'
    }
  }

  /** Did the last downloaded update fail to install? Read once per start. */
  const reconcilePending = () => {
    const { pendingVersion, installAttempts } = deps.readState()
    if (!pendingVersion) return
    const order = compareVersions(deps.currentVersion, pendingVersion)
    if (order === null || order >= 0) {
      updateState({ pendingVersion: undefined, installAttempts: undefined })
      return
    }
    const attempts = (installAttempts ?? 0) + 1
    if (attempts < FAILED_AFTER_STARTS) {
      updateState({ installAttempts: attempts })
      return
    }
    // Two starts on the old version: one could be a crash (no install is tried
    // on a non-zero exit), two is an install that does not work here.
    updateState({ pendingVersion: undefined, installAttempts: undefined, failedVersion: pendingVersion })
    pendingFailureNotice = pendingVersion
  }

  return {
    start() {
      if (deps.support.kind !== 'supported') {
        deps.log('info', `[updater] automatic updates off: ${deps.support.kind}`)
        return
      }
      engine.autoDownload = false
      engine.autoInstallOnAppQuit = true
      engine.allowDowngrade = false
      engine.on('update-available', onAvailable)
      engine.on('update-not-available', onNotAvailable)
      engine.on('update-downloaded', onDownloaded)
      engine.on('error', onError)
      deps.nativeUpdater?.on('update-downloaded', onNativeDownloaded)

      reconcilePending()
      if (pendingFailureNotice) {
        const version = pendingFailureNotice
        pendingFailureNotice = null
        deps.after(FIRST_CHECK_DELAY_MS, () => void noticeFailed(version))
      }
      // One check per launch, and none when the user turned automatic checks off.
      if (deps.readAutoCheck()) deps.after(FIRST_CHECK_DELAY_MS, () => void check(false))
    },

    async checkNow() {
      switch (deps.support.kind) {
        case 'supported':
          return check(true)
        case 'windows':
          deps.openExternal(RELEASES_URL)
          return
        case 'development':
          await deps.showDialog({
            type: 'info',
            message: 'Updates are disabled in development builds',
            detail: 'Only a packaged OpenPLC Editor updates itself.',
            buttons: ['OK'],
          })
          return
        case 'not-appimage':
          return showDownloadNotice(
            'Automatic updates need the AppImage',
            'This copy of OpenPLC Editor was not started from its AppImage, so it cannot update itself. Download the latest version from the releases page.',
          )
        case 'unstable-location':
          await deps.showDialog({
            type: 'info',
            message: 'Move OpenPLC Editor to Applications to receive updates',
            detail:
              'OpenPLC Editor is running from a disk image or a temporary location, where it cannot update itself. Drag it into your Applications folder and open it from there.',
            buttons: ['OK'],
          })
          return
        default: {
          const unreachable: never = deps.support
          return unreachable
        }
      }
    },

    isAutoCheckEnabled: () => deps.readAutoCheck(),

    getStatus: () => status,

    onStatusChange(listener) {
      statusListeners.add(listener)
      return () => {
        statusListeners.delete(listener)
      }
    },

    requestInstall() {
      if (isReadyToInstall()) deps.requestQuit('install-update')
    },

    // Applies from the next launch: the one automatic check of this launch has
    // either run already or is about to, and the menu checks on demand.
    setAutoCheck(enabled) {
      deps.writeAutoCheck(enabled)
    },

    installAndRestart() {
      // Runs while the window still exists (the coordinator destroys it right
      // after), so every plain quit from here is deferred until it is gone.
      const quitSoon = () => deps.after(0, () => deps.quit())

      if (!isReadyToInstall()) {
        quitSoon()
        return
      }

      if (deps.platform === 'darwin') {
        engine.quitAndInstall()
        deps.after(MAC_INSTALL_WATCHDOG_MS, () => {
          deps.log('warn', '[updater] install did not quit the app; quitting')
          deps.quit()
        })
        return
      }

      const current = deps.appImagePath
      let destination = current
      let installFailed = false
      const onRenamed = (path: string) => {
        destination = path
      }
      const onInstallError = () => {
        installFailed = true
      }
      engine.on('appimage-filename-updated', onRenamed)
      engine.on('error', onInstallError)
      try {
        // Silent and without launching: the install runs synchronously, then the
        // updater schedules app.quit(). The new version is opened by relaunch,
        // after this process has exited and released the single-instance lock.
        engine.quitAndInstall(true, false)
      } finally {
        engine.removeListener('appimage-filename-updated', onRenamed)
        engine.removeListener('error', onInstallError)
      }

      if (installFailed) {
        // The old AppImage is removed only after the new one is in place, so a
        // failed install leaves it where it was: reopen that one.
        if (downloadedVersion)
          updateState({ pendingVersion: undefined, installAttempts: undefined, failedVersion: downloadedVersion })
        setStatus({ state: 'none' })
        if (current) deps.relaunch(current)
        quitSoon()
        return
      }
      if (destination) deps.relaunch(destination)
    },
  }
}
