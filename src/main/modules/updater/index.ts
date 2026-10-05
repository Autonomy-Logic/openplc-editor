import { createHash } from 'crypto'
import { app, type BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import log from 'electron-log'
import { chmod, open, rename, rm } from 'fs/promises'
import { basename, join } from 'path'
import { z } from 'zod'

import { store } from '../store'
import type { Release, ReleaseAsset } from './release-assets'
import { createUpdateService, type DownloadedFile, type UpdateService } from './update-service'
import { compareVersions } from './version-order'

export type { UpdateService } from './update-service'

const RELEASES_API = 'https://api.github.com/repos/Autonomy-Logic/openplc-editor/releases'

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

/** Saves the asset in Downloads, hashing it on the way; a partial file never keeps the final name. */
async function download(asset: ReleaseAsset, progress: (fraction: number) => void): Promise<DownloadedFile> {
  // The name comes from the network: it must stay a file name inside Downloads.
  if (basename(asset.name) !== asset.name) throw new Error(`unexpected asset name ${asset.name}`)
  const path = join(app.getPath('downloads'), asset.name)
  const partial = `${path}.part`
  const response = await net.fetch(asset.url)
  if (!response.ok || !response.body) throw new Error(`download answered ${response.status}`)

  const hash = createHash('sha256')
  let received = 0
  const reader = response.body.getReader()
  const file = await open(partial, 'w')
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      await file.write(value)
      received += value.byteLength
      if (asset.size > 0) progress(received / asset.size)
    }
  } catch (error: unknown) {
    await file.close()
    await rm(partial, { force: true })
    throw error
  }
  await file.close()
  await rename(partial, path)
  // An AppImage is the program itself; it has to be executable to be opened.
  if (process.platform === 'linux') await chmod(path, 0o755)
  return { path, sha256: hash.digest('hex') }
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
 * The status bar's side of the service: `app-update:get-status` answers what a
 * renderer that just loaded should show, `app-update:status` pushes changes to
 * the window, and `app-update:download` is the "Update" button.
 */
function registerUpdateIpc(service: UpdateService, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('app-update:get-status', () => service.getStatus())
  ipcMain.on('app-update:download', () => void service.downloadAndOpen())
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
    arch: process.arch,
    currentVersion: app.getVersion(),
    fetchLatestRelease,
    download,
    discard: (path) => {
      void rm(path, { force: true }).catch((error: unknown) =>
        log.warn(`[updater] could not delete ${path}: ${String(error)}`),
      )
    },
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
