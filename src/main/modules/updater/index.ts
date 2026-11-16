import { createHash } from 'crypto'
import { app, type BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import log from 'electron-log'
import { access, chmod, open, rename, rm } from 'fs/promises'
import { basename, join } from 'path'
import { z } from 'zod'

import { store } from '../store'
import { installerArchs, type Release, type ReleaseAsset } from './release-assets'
import { createUpdateService, type DownloadedFile, type UpdateService } from './update-service'
import { compareVersions } from './version-order'

export type { UpdateService } from './update-service'

const RELEASES_API = 'https://api.github.com/repos/Autonomy-Logic/openplc-editor/releases'
const STALL_TIMEOUT_MS = 30_000

const GitHubRelease = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.string(),
      size: z.number(),
      digest: z.string().nullish(),
    }),
  ),
})
type GitHubRelease = z.infer<typeof GitHubRelease>

function toRelease(release: GitHubRelease): Release {
  return {
    version: release.tag_name.replace(/^v/, ''),
    assets: release.assets.map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      digest: asset.digest ?? undefined,
    })),
  }
}

async function getJson(url: string): Promise<unknown> {
  // net.fetch goes through Chromium's network stack, so the system proxy applies.
  const response = await net.fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `OpenPLC-Editor/${app.getVersion()}` },
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}`)
  return response.json()
}

/**
 * Stable builds ask for the latest release, which GitHub never answers with a
 * prerelease. An rc build also hears of newer rcs, so it reads the recent list.
 */
async function fetchLatestRelease(includePrereleases: boolean): Promise<Release | null> {
  if (!includePrereleases) return toRelease(GitHubRelease.parse(await getJson(`${RELEASES_API}/latest`)))

  const releases = z
    .array(GitHubRelease)
    .parse(await getJson(`${RELEASES_API}?per_page=20`))
    .filter((release) => !release.draft)
    .map(toRelease)
  let newest: Release | null = null
  for (const release of releases) {
    if (!newest || (compareVersions(release.version, newest.version) ?? 0) > 0) newest = release
  }
  return newest
}

/**
 * The Downloads folder, under the release's file name. On Linux the user picks
 * where the new AppImage goes, since that is where they will run it from.
 */
async function chooseDestination(asset: ReleaseAsset, window: BrowserWindow | null): Promise<string | null> {
  // The name comes from the network: it must stay a file name.
  if (basename(asset.name) !== asset.name) throw new Error(`unexpected asset name ${asset.name}`)
  const suggested = join(app.getPath('downloads'), asset.name)
  if (process.platform !== 'linux') return suggested

  const options = {
    title: 'Save the new OpenPLC Editor',
    defaultPath: suggested,
    buttonLabel: 'Save',
    filters: [{ name: 'AppImage', extensions: ['AppImage'] }],
  }
  const result =
    window && !window.isDestroyed()
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

/** Saves the asset at `path`, hashing it on the way; a partial file never keeps the final name. */
async function download(
  asset: ReleaseAsset,
  path: string,
  progress: (fraction: number) => void,
): Promise<DownloadedFile> {
  const partial = `${path}.part`
  const stalled = new AbortController()
  const stallError = new Error(`no data for ${STALL_TIMEOUT_MS / 1000} s`)
  let timer: NodeJS.Timeout | undefined
  const keepAlive = () => {
    clearTimeout(timer)
    timer = setTimeout(() => stalled.abort(stallError), STALL_TIMEOUT_MS)
  }

  const aborted = new Promise<never>((_, reject) =>
    stalled.signal.addEventListener('abort', () => reject(stallError), { once: true }),
  )
  aborted.catch(() => undefined)

  keepAlive()
  try {
    const response = await net.fetch(asset.url, { signal: stalled.signal })
    if (!response.ok || !response.body) throw new Error(`download answered ${response.status}`)

    const hash = createHash('sha256')
    let received = 0
    const reader = response.body.getReader()
    const file = await open(partial, 'w')
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted])
        if (done) break
        keepAlive()
        hash.update(value)
        await file.write(value)
        received += value.byteLength
        if (asset.size > 0) progress(received / asset.size)
      }
    } catch (error: unknown) {
      void reader.cancel().catch(() => undefined)
      await file.close()
      await rm(partial, { force: true })
      throw error
    }
    await file.close()
    await rename(partial, path)
    // An AppImage is the program itself; it has to be executable to be opened.
    if (process.platform === 'linux') await chmod(path, 0o755)
    return { path, sha256: hash.digest('hex') }
  } finally {
    clearTimeout(timer)
  }
}

async function openInstaller(path: string): Promise<void> {
  // Linux: running the new AppImage now would only meet this editor's
  // single-instance lock and exit, so it is shown in its folder instead.
  if (process.platform === 'linux') {
    shell.showItemInFolder(path)
    return
  }
  const error = await shell.openPath(path)
  if (error) throw new Error(error)
}

/**
 * The banner's side of the service: `app-update:get-status` answers what a
 * renderer that just loaded should show, `app-update:status` pushes changes to
 * the window, `app-update:download` is the Update button and
 * `app-update:dismiss` its X. `app-update:check` and the auto-check pair are
 * the in-app File menu's items, which Windows shows instead of the native menu.
 */
function registerUpdateIpc(service: UpdateService, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('app-update:get-status', () => service.getStatus())
  ipcMain.on('app-update:download', () => void service.downloadAndOpen())
  ipcMain.on('app-update:dismiss', () => service.dismiss())
  ipcMain.on('app-update:check', () => void service.checkNow())
  ipcMain.handle('app-update:get-auto-check', () => service.isAutoCheckEnabled())
  ipcMain.on('app-update:set-auto-check', (_event, enabled: unknown) => {
    if (typeof enabled === 'boolean') service.setAutoCheck(enabled)
  })
  service.onStatusChange((status) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('app-update:status', status)
  })
}

/** The one update service of this process, wired to Electron and the GitHub releases API. */
export function createElectronUpdateService({
  getWindow,
  requestQuit,
}: {
  getWindow: () => BrowserWindow | null
  requestQuit: () => void
}): UpdateService {
  const service = createUpdateService({
    isPackaged: app.isPackaged,
    platform: process.platform,
    archs: installerArchs(process.platform, process.arch, app.runningUnderARM64Translation),
    currentVersion: app.getVersion(),
    fetchLatestRelease,
    chooseDestination: (asset) => chooseDestination(asset, getWindow()),
    download,
    discard: (path) => {
      void rm(path, { force: true }).catch((error: unknown) =>
        log.warn(`[updater] could not delete ${path}: ${String(error)}`),
      )
    },
    fileExists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    openInstaller,
    readAutoCheck: () => store.get('auto_update_check'),
    writeAutoCheck: (enabled) => store.set('auto_update_check', enabled),
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
    after: (ms, callback) => {
      setTimeout(callback, ms)
    },
    log: (level, message) => log[level](message),
  })
  registerUpdateIpc(service, getWindow)
  return service
}
