/**
 * Tells the user that a newer OpenPLC Editor is out, and on request downloads
 * its installer and opens it (DOPE-486). The same on Windows, macOS and Linux.
 *
 * Nothing is installed by the editor itself: the user runs the installer, as
 * they would after downloading it from the website. So no update metadata is
 * published, and no unsigned Windows installer is ever run without the user.
 *
 * Every Electron, network and filesystem call comes in through
 * `UpdateServiceDeps`, so the rules below are tested without Electron;
 * `index.ts` wires the real ones.
 */

import { pickInstaller, type Release, type ReleaseAsset, sha256Of } from './release-assets'
import { isNewer } from './version-order'

export interface DialogRequest {
  message: string
  detail: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
  type?: 'info' | 'warning' | 'error'
}

export interface DownloadedFile {
  path: string
  /** Hex sha256 of what was written. */
  sha256: string
}

export interface UpdateServiceDeps {
  isPackaged: boolean
  platform: NodeJS.Platform
  /** Architectures whose installer to offer, best first (see `installerArchs`). */
  archs: string[]
  currentVersion: string
  /** The newest release this build should hear about; null when there is none. */
  fetchLatestRelease(includePrereleases: boolean): Promise<Release | null>
  /** Saves the asset in the user's Downloads folder. `progress` goes from 0 to 1. */
  download(asset: ReleaseAsset, progress: (fraction: number) => void): Promise<DownloadedFile>
  discard(path: string): void
  /** Opens the installer (Windows, macOS) or shows the new AppImage in its folder (Linux). */
  openInstaller(path: string): Promise<void>
  readAutoCheck(): boolean
  writeAutoCheck(enabled: boolean): void
  /** Resolves to the index of the button pressed. */
  showDialog(request: DialogRequest): Promise<number>
  openExternal(url: string): void
  /** An ordinary quit, through the unsaved-project prompt. */
  requestQuit(): void
  /** Runs `callback` once after `ms`. */
  after(ms: number, callback: () => void): void
  log(level: 'info' | 'warn' | 'error', message: string): void
}

export const RELEASES_URL = 'https://github.com/Autonomy-Logic/openplc-editor/releases/latest'
/**
 * The one automatic check per launch runs this long after start, so it never
 * competes with the editor opening. There is no periodic check: an editor left
 * open hears of a new version the next time it is opened, or from the menu.
 */
export const FIRST_CHECK_DELAY_MS = 60_000

/** What the status bar shows. */
export type UpdateStatus =
  | { state: 'none' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }

export interface UpdateService {
  start(): void
  /** The menu's "Check for Updates". */
  checkNow(): Promise<void>
  isAutoCheckEnabled(): boolean
  setAutoCheck(enabled: boolean): void
  getStatus(): UpdateStatus
  /** The returned function unsubscribes. */
  onStatusChange(listener: (status: UpdateStatus) => void): () => void
  /** The status bar's button: download the installer (once) and open it. */
  downloadAndOpen(): Promise<void>
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  let status: UpdateStatus = { state: 'none' }
  let available: { version: string; installer: ReleaseAsset } | null = null
  let downloaded: { version: string; path: string } | null = null
  let checking = false
  const listeners = new Set<(status: UpdateStatus) => void>()

  const setStatus = (next: UpdateStatus) => {
    if (JSON.stringify(next) === JSON.stringify(status)) return
    status = next
    for (const listener of listeners) listener(next)
  }

  const isPrerelease = () => deps.currentVersion.includes('-')

  const pickFirst = (assets: ReleaseAsset[]) => {
    for (const arch of deps.archs) {
      const installer = pickInstaller(assets, deps.platform, arch)
      if (installer) return installer
    }
    return null
  }

  const showDownloadPage = async (message: string, detail: string) => {
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

  /** What to do once the installer is open, in this platform's words. */
  const afterOpening = async (version: string, path: string) => {
    const detail =
      deps.platform === 'darwin'
        ? 'Quit OpenPLC Editor, then drag the new version into Applications to replace this one.'
        : deps.platform === 'win32'
          ? 'Quit OpenPLC Editor so the installer can replace this version.'
          : `The new AppImage was saved to ${path}. Quit this version and open the new file from now on.`
    const pressed = await deps.showDialog({
      type: 'info',
      message:
        deps.platform === 'linux'
          ? `OpenPLC Editor ${version} is downloaded`
          : `The OpenPLC Editor ${version} installer is open`,
      detail,
      buttons: ['Quit Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    if (pressed === 0) deps.requestQuit()
  }

  const check = async (manual: boolean) => {
    if (checking) return
    if (status.state === 'downloading') {
      if (manual) {
        await deps.showDialog({
          type: 'info',
          message: `OpenPLC Editor ${status.version} is being downloaded`,
          detail: 'Its installer opens when the download finishes.',
          buttons: ['OK'],
        })
      }
      return
    }

    checking = true
    let release: Release | null
    try {
      release = await deps.fetchLatestRelease(isPrerelease())
    } catch (error: unknown) {
      deps.log('warn', `[updater] check failed: ${String(error)}`)
      if (manual) {
        await showDownloadPage(
          'Could not check for updates',
          'OpenPLC Editor could not reach GitHub. You can download the latest version from the releases page.',
        )
      }
      return
    } finally {
      checking = false
    }

    const installer = release ? pickFirst(release.assets) : null
    if (!release || !isNewer(release.version, deps.currentVersion) || !installer) {
      if (release && installer === null && isNewer(release.version, deps.currentVersion)) {
        deps.log('warn', `[updater] ${release.version} has no installer for ${deps.platform} ${deps.archs.join('/')}`)
      }
      if (manual) {
        await deps.showDialog({
          type: 'info',
          message: 'OpenPLC Editor is up to date',
          detail: `Version ${deps.currentVersion} is the latest version.`,
          buttons: ['OK'],
        })
      }
      return
    }

    if (available?.version !== release.version) {
      available = { version: release.version, installer }
      if (downloaded?.version !== release.version) downloaded = null
    }
    setStatus(
      downloaded ? { state: 'downloaded', version: release.version } : { state: 'available', version: release.version },
    )

    if (manual) {
      const pressed = await deps.showDialog({
        type: 'info',
        message: `OpenPLC Editor ${release.version} is available`,
        detail: `You are on ${deps.currentVersion}. Download the new version and open its installer?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      if (pressed === 0) await downloadAndOpen()
    }
  }

  const downloadAndOpen = async () => {
    if (!available || status.state === 'downloading') return
    const { version, installer } = available

    if (!downloaded || downloaded.version !== version) {
      const expected = sha256Of(installer.digest)
      if (!expected) {
        deps.log('warn', `[updater] ${installer.name} has no sha256 digest; not downloading it`)
        await showDownloadPage(
          `OpenPLC Editor ${version} could not be verified`,
          'The release does not say what the installer should contain, so it was not downloaded. Download it from the releases page.',
        )
        return
      }

      setStatus({ state: 'downloading', version, percent: 0 })
      let file: DownloadedFile
      try {
        file = await deps.download(installer, (fraction) =>
          setStatus({ state: 'downloading', version, percent: Math.min(100, Math.floor(fraction * 100)) }),
        )
      } catch (error: unknown) {
        deps.log('warn', `[updater] download failed: ${String(error)}`)
        setStatus({ state: 'available', version })
        await showDownloadPage(
          `OpenPLC Editor ${version} could not be downloaded`,
          'Check your connection and try again, or download it from the releases page.',
        )
        return
      }

      if (file.sha256 !== expected) {
        deps.log('error', `[updater] ${installer.name}: sha256 ${file.sha256} does not match ${expected}`)
        deps.discard(file.path)
        setStatus({ state: 'available', version })
        await showDownloadPage(
          `OpenPLC Editor ${version} could not be verified`,
          'The downloaded file does not match the release, so it was deleted. Download it from the releases page.',
        )
        return
      }
      downloaded = { version, path: file.path }
    }

    setStatus({ state: 'downloaded', version })
    try {
      await deps.openInstaller(downloaded.path)
    } catch (error: unknown) {
      deps.log('warn', `[updater] could not open ${downloaded.path}: ${String(error)}`)
    }
    await afterOpening(version, downloaded.path)
  }

  return {
    start() {
      if (!deps.isPackaged) {
        deps.log('info', '[updater] no update checks in development builds')
        return
      }
      // One check per launch, and none when the user turned automatic checks off.
      if (deps.readAutoCheck()) deps.after(FIRST_CHECK_DELAY_MS, () => void check(false))
    },

    async checkNow() {
      if (!deps.isPackaged) {
        await deps.showDialog({
          type: 'info',
          message: 'Updates are disabled in development builds',
          detail: 'Only a packaged OpenPLC Editor checks for new versions.',
          buttons: ['OK'],
        })
        return
      }
      await check(true)
    },

    isAutoCheckEnabled: () => deps.readAutoCheck(),

    // Applies from the next launch: the one automatic check of this launch has
    // either run already or is about to, and the menu checks on demand.
    setAutoCheck(enabled) {
      deps.writeAutoCheck(enabled)
    },

    getStatus: () => status,

    onStatusChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    downloadAndOpen,
  }
}
